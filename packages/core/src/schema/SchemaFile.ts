import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { schemaVersion, type Schema } from "./Schema.js";
import { bridgeNamespace, buildSchema, type AstNode } from "./SchemaBuilder.js";

export const schemaFileName = "Schema.json";

//The library's folders whose headers the schema reads; every class the generator may call is declared in them.
const schemaFolders = ["Widgets", "Scenes", "Styling"];

export interface SchemaRequest
{
    libraryFolder: string; //RetroFuturaGUI, holding source/.
    compileCommandsFile: string; //a configured build's compile_commands.json, for the library's includes and defines.
    clang: string; //clang-cl on Windows, clang elsewhere.
}

export interface SchemaResult
{
    file: string;
    isWritten: boolean; //false when the file already held the same schema.
    classCount: number;
    enumCount: number;
    problems: string[]; //what the headers' @bechaml tags got wrong; the schema is written anyway.
    error?: string; //why no schema was made.
}

//roux schema: dumps the library's declarations through Clang and writes RetroFuturaGUI/Schema.json (Roux plan, 2.5).
export async function makeSchema(request: SchemaRequest): Promise<SchemaResult>
{
    const sourceFolder = path.join(request.libraryFolder, "source");
    const file = path.join(request.libraryFolder, schemaFileName);
    const failed = (error: string): SchemaResult => ({ file: file, isWritten: false, classCount: 0, enumCount: 0, problems: [], error: error });

    const flags = await libraryFlags(request.compileCommandsFile, sourceFolder);

    if (!flags)
        return failed(request.compileCommandsFile + " has no command for a file of " + sourceFolder + ": configure a build first.");

    const headers: string[] = [];

    for (const folder of schemaFolders)
        headers.push(...await filesUnder(path.join(sourceFolder, folder), ".hpp"));

    const workFolder = await mkdtemp(path.join(os.tmpdir(), "roux-schema-"));

    try
    {
        const probe = path.join(workFolder, "Schema.cpp");
        await writeFile(probe, headers.map(header => "#include \"" + header.split(path.sep).join("/") + "\"").join("\n") + "\n", "utf8");

        //Only the library's declarations come out, not the standard library's: one object per match, one after another.
        //PlatformBridge's follow, for the enums the library's setters take from it.
        const isClangCl = /clang-cl(\.exe)?$/i.test(request.clang);
        const syntaxOnly = isClangCl ? ["/EHsc", "/Zs"] : ["-fsyntax-only"];
        const roots: AstNode[] = [];

        for (const filter of ["RetroFuturaGUI", bridgeNamespace])
        {
            const dump = await runClang(request.clang, [...flags.args, ...syntaxOnly, "-Xclang", "-ast-dump=json", "-Xclang", "-ast-dump-filter=" + filter, probe], flags.directory);

            if (0 !== dump.code)
                return failed("Clang couldn't read the headers:\n" + dump.errors.slice(0, 20).join("\n"));

            roots.push(...splitDump(dump.output));
        }

        const built = buildSchema(roots, sourceFolder);
        const schema: Schema = { schemaVersion: schemaVersion, headersHash: await headersHash(sourceFolder), enums: built.enums, classes: built.classes };
        const text = JSON.stringify(schema, undefined, 4) + "\n";
        const isWritten = text !== await readFile(file, "utf8").catch(() => undefined);

        if (isWritten)
            await writeFile(file, text, "utf8");

        return { file: file, isWritten: isWritten, classCount: Object.keys(built.classes).length, enumCount: Object.keys(built.enums).length, problems: [...new Set(built.problems)] };
    }
    finally
    {
        await rm(workFolder, { recursive: true, force: true });
    }
}

//Clang's dump with -ast-dump-filter: one pretty-printed object per matching declaration, the next starting where the
//last closed at the start of a line.
export function splitDump(text: string): AstNode[]
{
    const parts = text.split(/\r?\n}\r?\n(?=\{)/);
    return parts.filter(part => "" !== part.trim()).map((part, index) => JSON.parse(index < parts.length - 1 ? part + "\n}" : part) as AstNode);
}

//sha256 over every header of the source folder, path and text, so a change to any of them shows.
export async function headersHash(sourceFolder: string): Promise<string>
{
    const hash = createHash("sha256");

    //The predefined prefabs' code is generated from Schema.json, so it never makes Schema.json stale
    const isPrefab = (header: string) => path.relative(sourceFolder, header).split(path.sep)[0] === "Prefabs";

    for (const header of (await filesUnder(sourceFolder, ".hpp")).filter(header => !isPrefab(header)))
    {
        hash.update(path.relative(sourceFolder, header).split(path.sep).join("/") + "\n");
        hash.update(await readFile(header));
    }

    return hash.digest("hex");
}

//The include paths, defines and standard a configured build compiled the library with, and the folder it ran in.
async function libraryFlags(compileCommandsFile: string, sourceFolder: string): Promise<{ args: string[]; directory: string } | undefined>
{
    const commands = JSON.parse(await readFile(compileCommandsFile, "utf8").catch(() => "[]")) as { directory: string; command?: string; arguments?: string[]; file: string }[];
    const inSource = (file: string) => path.resolve(file).toLowerCase().startsWith(path.resolve(sourceFolder).toLowerCase() + path.sep);
    const entry = commands.find(command => inSource(command.file) && command.file.endsWith(".cpp"));

    if (!entry)
        return undefined;

    const words = entry.arguments ?? (entry.command ?? "").match(/(?:"[^"]*"|\S)+/g) ?? [];
    const args = words.map(word => word.replace(/"/g, "")).filter(word => /^[-/](I|D|external:I|std[:=])|^-isystem/.test(word));
    return { args: args, directory: entry.directory };
}

function runClang(clang: string, args: string[], cwd: string): Promise<{ code: number | null; output: string; errors: string[] }>
{
    return new Promise(resolve =>
    {
        const chunks: Buffer[] = [];
        let errorText = "";

        try
        {
            const child = spawn(clang, args, { cwd: cwd, windowsHide: true });
            child.stdin.end();
            child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
            child.stderr.on("data", (chunk: Buffer) => { errorText += chunk.toString("utf8"); });
            child.on("error", error => resolve({ code: -1, output: "", errors: [error.message] }));
            child.on("close", code => resolve({ code: code, output: Buffer.concat(chunks).toString("utf8"), errors: errorText.split(/\r?\n/).filter(line => /error/i.test(line)) }));
        }
        catch (error)
        {
            resolve({ code: -1, output: "", errors: [error instanceof Error ? error.message : String(error)] });
        }
    });
}

async function filesUnder(folder: string, extension: string): Promise<string[]>
{
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];

    for (const entry of [...entries].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    {
        const full = path.join(folder, entry.name);

        if (entry.isDirectory())
            files.push(...await filesUnder(full, extension));
        else if (entry.isFile() && entry.name.endsWith(extension))
            files.push(full);
    }

    return files;
}
