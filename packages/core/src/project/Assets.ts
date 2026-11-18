import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AssetClash, AssetFile, AssetList, AssetSection } from "@retrofuturagui/roux-protocol";
import { InvalidParamsError } from "../JsonRpcServer.js";

//The Assets tab (Roux plan, section 12): the pictures in the project's asset folders and in RetroFuturaGUI's premade
//Resources, and files added to the project's

//What SceneLoader::AddAsset loads a file as, by its extension. A file of another kind (a video, a sound) loads when its
//widget asks for it
export type AssetKind = "Texture" | "Svg" | "Model";
export const assetKinds: Readonly<Record<string, AssetKind>> = { ".png": "Texture", ".jpg": "Texture", ".jpeg": "Texture", ".bmp": "Texture", ".tga": "Texture", ".gif": "Texture", ".hdr": "Texture", ".psd": "Texture", ".svg": "Svg", ".obj": "Model", ".fbx": "Model", ".gltf": "Model", ".glb": "Model", ".dae": "Model", ".3ds": "Model", ".blend": "Model" };

//The pictures the tab shows and takes: what the library loads as a texture or an SVG.
export const pictureExtensions: readonly string[] = Object.entries(assetKinds).filter(([, kind]) => "Model" !== kind).map(([extension]) => extension);

//The pictures a page can show itself, by their MIME type. The others (.tga, .psd, .hdr) show their extension instead
const previewTypes: Readonly<Record<string, string>> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp", ".svg": "image/svg+xml" };

const libraryFolder = "RetroFuturaGUI/Resources";
const maximumPreviewBytes = 4 * 1024 * 1024; //a bigger picture shows its extension, so a page isn't sent megabytes per tile
const maximumChunkBytes = 768 * 1024; //a piece of an upload, decoded; the UI sends 512 KiB, which stays under roux serve's 1 MiB per request
const maximumUploadBytes = 256 * 1024 * 1024;
const isName = (text: string) => /^[A-Za-z_]\w*$/.test(text);

interface Upload
{
    readonly temporaryFile: string;
    readonly target: string;   //absolute
    readonly savedAs: string;  //relative to the project, with /
    received: number;
}

export class AssetSession
{
    private readonly _folder: string;
    private readonly _assetFolders: () => Promise<readonly string[]>;
    private readonly _uploads = new Map<string, Upload>();

    //assetFolders: the project's, as Project.bechaml lists them now
    constructor(folder: string, assetFolders: () => Promise<readonly string[]>)
    {
        this._folder = folder;
        this._assetFolders = assetFolders;
    }

    async list(): Promise<AssetList>
    {
        const projectFolders = await this._assetFolders();
        const sections: AssetSection[] = [];

        for (const folder of projectFolders)
            sections.push({ folder: folder, isReadOnly: false, files: await this.files(folder, "Assets") });

        if (await isDirectory(path.join(this._folder, libraryFolder)))
            sections.push({ folder: libraryFolder, isReadOnly: true, files: await this.files(libraryFolder, "RetroFuturaGUI") });

        return { sections: sections, destination: await this.destination(), extensions: [...pictureExtensions] };
    }

    //The picture as a data: URL, or "" when a page can't show it (a .tga) or it's too big to send for a tile
    async preview(folder: string, file: string): Promise<{ dataUrl: string }>
    {
        const absolute = await this.listedFile(folder, file);
        const type = previewTypes[path.extname(absolute).toLowerCase()];

        if (!type || maximumPreviewBytes < (await stat(absolute)).size)
            return { dataUrl: "" };

        return { dataUrl: "data:" + type + ";base64," + (await readFile(absolute)).toString("base64") };
    }

    //The names already taken in the destination, so the UI can ask before sending a file
    async clashes(names: readonly string[]): Promise<{ clashes: string[] }>
    {
        const destination = await this.destination();

        if (!destination)
            return { clashes: [] };

        const taken: string[] = [];

        for (const name of names)
        {
            if (await isFile(path.join(this._folder, destination, name)))
                taken.push(name);
        }

        return { clashes: taken };
    }

    async uploadStart(name: string, onClash: AssetClash): Promise<{ uploadId: string; savedAs: string }>
    {
        const destination = await this.destination();

        if (!destination)
            throw new InvalidParamsError("The project names no asset folder: add one in the Project tab first.");

        if (name !== path.basename(name) || name.startsWith(".") || /[\\/:*?"<>|]/.test(name))
            throw new InvalidParamsError(name + " isn't a file name.");

        if (!pictureExtensions.includes(path.extname(name).toLowerCase()))
            throw new InvalidParamsError(name + " isn't a picture the library loads: " + pictureExtensions.join(", ") + ".");

        await mkdir(path.join(this._folder, destination), { recursive: true });
        const savedName = "replace" === onClash ? name : await this.freeName(destination, name);
        const uploadId = randomUUID();
        const temporaryFile = path.join(os.tmpdir(), "roux-upload-" + uploadId);
        await writeFile(temporaryFile, Buffer.alloc(0));
        this._uploads.set(uploadId, { temporaryFile: temporaryFile, target: path.join(this._folder, destination, savedName), savedAs: destination + "/" + savedName, received: 0 });
        return { uploadId: uploadId, savedAs: destination + "/" + savedName };
    }

    async uploadChunk(uploadId: string, data: string): Promise<{ received: number }>
    {
        const upload = this.upload(uploadId);
        const bytes = Buffer.from(data, "base64");

        if (maximumChunkBytes < bytes.length)
            throw new InvalidParamsError("A piece of an upload holds " + maximumChunkBytes + " bytes at most.");

        if (maximumUploadBytes < upload.received + bytes.length)
        {
            await this.abandon(uploadId);
            throw new InvalidParamsError("A file holds " + maximumUploadBytes / 1024 / 1024 + " MiB at most.");
        }

        await appendFile(upload.temporaryFile, bytes);
        upload.received += bytes.length;
        return { received: upload.received };
    }

    //Puts the file in place only once all of it arrived, so a broken upload never leaves half a picture in the folder
    async uploadEnd(uploadId: string): Promise<{ savedAs: string }>
    {
        const upload = this.upload(uploadId);
        await copyFile(upload.temporaryFile, upload.target);
        await this.abandon(uploadId);
        return { savedAs: upload.savedAs };
    }

    //Removes the uploads that never ended.
    async close(): Promise<void>
    {
        await Promise.all([...this._uploads.keys()].map(uploadId => this.abandon(uploadId)));
    }

    //Where added files go: Images/ in the project's first asset folder, as the .bechaml plan lays asset folders out
    private async destination(): Promise<string>
    {
        const first = (await this._assetFolders())[0];
        return first ? first.replace(/\\/g, "/").replace(/\/+$/, "") + "/Images" : "";
    }

    //Logo.png, else Logo 2.png, Logo 3.png and on: the first name not taken.
    private async freeName(destination: string, name: string): Promise<string>
    {
        const extension = path.extname(name);
        const stem = name.slice(0, name.length - extension.length);

        for (let number = 1; ; ++number)
        {
            const candidate = 1 === number ? name : stem + " " + number + extension;

            if (!(await isFile(path.join(this._folder, destination, candidate))))
                return candidate;
        }
    }

    //Every picture in the folder and the folders inside it, with the reference markup names it by
    private async files(folder: string, referenceRoot: string): Promise<AssetFile[]>
    {
        const found: AssetFile[] = [];
        const root = path.join(this._folder, folder);

        const walk = async (directory: string) =>
        {
            const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

            for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name)))
            {
                if (entry.name.startsWith("."))
                    continue;

                const absolute = path.join(directory, entry.name);

                if (entry.isDirectory())
                    await walk(absolute);
                else if (entry.isFile() && pictureExtensions.includes(path.extname(entry.name).toLowerCase()))
                {
                    const relative = path.relative(root, absolute).split(path.sep).join("/");
                    const status = await stat(absolute);
                    found.push({ path: relative, size: status.size, modified: Math.trunc(status.mtimeMs), reference: reference(referenceRoot, relative) });
                }
            }
        };

        await walk(root);
        return found;
    }

    //A file the list shows, by its folder and path there. Anything else is refused, so a request can't read the computer
    private async listedFile(folder: string, file: string): Promise<string>
    {
        const folders = [...(await this._assetFolders()), libraryFolder];

        if (!folders.includes(folder) || path.isAbsolute(file) || file.replace(/\\/g, "/").split("/").includes(".."))
            throw new InvalidParamsError(folder + "/" + file + " isn't in an asset folder.");

        const absolute = path.join(this._folder, folder, file);

        if (!pictureExtensions.includes(path.extname(absolute).toLowerCase()) || !(await isFile(absolute)))
            throw new InvalidParamsError(folder + "/" + file + " isn't a picture in an asset folder.");

        return absolute;
    }

    private upload(uploadId: string): Upload
    {
        const upload = this._uploads.get(uploadId);

        if (!upload)
            throw new InvalidParamsError("There is no upload " + uploadId + ".");

        return upload;
    }

    private async abandon(uploadId: string): Promise<void>
    {
        const upload = this._uploads.get(uploadId);
        this._uploads.delete(uploadId);

        if (upload)
            await rm(upload.temporaryFile, { force: true });
    }
}

//Assets.Images.Logo.png when every folder, the name and the extension are names, else the quoted path, which markup
//looks up in the project's asset folders first, then in RetroFuturaGUI's
export function reference(root: string, relative: string): string
{
    const folders = relative.split("/");
    const file = folders.pop() ?? "";
    const dot = file.lastIndexOf(".");
    const parts = [...folders, file.slice(0, dot), file.slice(dot + 1)];
    return 0 < dot && parts.every(isName) ? [root, ...parts].join(".") : JSON.stringify(relative);
}

async function isFile(file: string): Promise<boolean>
{
    return (await stat(file).catch(() => undefined))?.isFile() ?? false;
}

async function isDirectory(folder: string): Promise<boolean>
{
    return (await stat(folder).catch(() => undefined))?.isDirectory() ?? false;
}
