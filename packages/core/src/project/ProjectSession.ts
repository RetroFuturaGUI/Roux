import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppEdit, AppValues, EditAnswer, ProjectEdit, ProjectSnapshot, ProjectValues, SettingsFile } from "@retrofuturagui/roux-protocol";
import { parseBechaml } from "../bechaml/Parser.js";
import type { Diagnostic, Document } from "../bechaml/Syntax.js";
import { editAppSettings, newAppSettingsText, readAppSettings } from "./AppSettingsFile.js";
import { editProject, newProjectText, projectFileName, readProject } from "./ProjectFile.js";
import { toFileProblems } from "./Values.js";

//What a file holds when it can be read: its text, parsed, and the values the tab shows.
interface ReadFile<V>
{
    state: SettingsFile<V>;
    document?: Document;
}

//A missing file is undefined; a file that isn't UTF-8 is null.
type FileText = string | undefined | null;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

//The project the Project and App tabs edit: Project.bechaml in its folder, and the App Settings file it names. Every
//request reads the files again, so an edit always starts from what's on disk. Requests run one after another, so two
//edits never write over each other. Changes made outside Roux are reported through onOutsideChange.
export class ProjectSession
{
    readonly folder: string;
    private readonly _platform: string;
    private readonly _onOutsideChange: (snapshot: ProjectSnapshot) => void;
    //The text each file had when Roux last read or wrote it, so Roux's own writes aren't taken for outside changes.
    private readonly _knownTexts = new Map<string, FileText>();
    private readonly _watchers = new Map<string, FSWatcher>();
    private _queue: Promise<unknown> = Promise.resolve();
    private _changeTimer: NodeJS.Timeout | undefined;
    private _isWatching = false;

    constructor(folder: string, platform: string, onOutsideChange: (snapshot: ProjectSnapshot) => void)
    {
        this.folder = path.resolve(folder);
        this._platform = platform;
        this._onOutsideChange = onOutsideChange;
    }

    //Also starts watching the files, from the first load on.
    load(): Promise<ProjectSnapshot>
    {
        this._isWatching = true;
        return this.serialized(async () => (await this.readAll()).snapshot);
    }

    createProject(): Promise<ProjectSnapshot>
    {
        return this.serialized(async () =>
        {
            const file = this.projectPath();

            if (undefined === await readText(file))
                await this.write(file, newProjectText(path.basename(this.folder), this._platform));

            return (await this.readAll()).snapshot;
        });
    }

    createApp(): Promise<ProjectSnapshot>
    {
        return this.serialized(async () =>
        {
            const read = await this.readAll();
            const app = read.snapshot.app;

            if (app && !app.exists && "" !== app.relativePath)
            {
                await mkdir(path.dirname(app.path), { recursive: true });
                await this.write(app.path, newAppSettingsText(read.project.state.values?.name ?? "App"));
            }

            return (await this.readAll()).snapshot;
        });
    }

    editProject(edit: ProjectEdit): Promise<EditAnswer>
    {
        return this.serialized(async () =>
        {
            const read = await this.readAll();
            const document = read.project.document;

            if (!document || !read.project.state.values)
                return answer(false, projectFileName + " can't be edited: " + unreadableReason(read.project.state), read.snapshot);

            const result = editProject(document, edit);
            return this.writeResult(read.project.state.path, result, read.snapshot);
        });
    }

    editApp(edit: AppEdit): Promise<EditAnswer>
    {
        return this.serialized(async () =>
        {
            const read = await this.readAll();
            const app = read.app;

            if (!app?.document || !app.state.values)
                return answer(false, "The App Settings can't be edited: " + (app ? unreadableReason(app.state) : projectFileName + " can't be read."), read.snapshot);

            const result = editAppSettings(app.document, app.state.values, edit);
            return this.writeResult(app.state.path, result, read.snapshot);
        });
    }

    close(): void
    {
        this._isWatching = false;
        clearTimeout(this._changeTimer);

        for (const watcher of this._watchers.values())
            watcher.close();

        this._watchers.clear();
    }

    private async writeResult(file: string, result: { text: string } | { message: string }, before: ProjectSnapshot): Promise<EditAnswer>
    {
        if ("message" in result)
            return answer(false, result.message, before);

        try
        {
            await this.write(file, result.text);
        }
        catch (error)
        {
            return answer(false, "Can't write " + path.basename(file) + ": " + (error instanceof Error ? error.message : String(error)), before);
        }

        return answer(true, "", (await this.readAll()).snapshot);
    }

    private async write(file: string, text: string): Promise<void>
    {
        this._knownTexts.set(file, text);
        await writeFile(file, text, "utf8");
    }

    private async readAll(): Promise<{ snapshot: ProjectSnapshot; project: ReadFile<ProjectValues>; app?: ReadFile<AppValues> }>
    {
        const projectPath = this.projectPath();
        const project = this.readSettings(projectPath, await this.readKnown(projectPath), document => readProject(document));
        let app: ReadFile<AppValues> | undefined;

        const relativeApp = project.state.values?.appSettings;

        if (undefined !== relativeApp)
        {
            if ("" === relativeApp)
            {
                app = { state: { path: "", relativePath: "", exists: false, problems: [{ line: 0, column: 0, message: projectFileName + " names no App Settings file. Set one in the Project tab." }] } };
            }
            else
            {
                const appPath = path.resolve(this.folder, relativeApp);
                app = this.readSettings(appPath, await this.readKnown(appPath), document => readAppSettings(document, path.basename(appPath)));
            }
        }

        if (this._isWatching)
            this.watchFolders([this.folder, ...(app?.state.path ? [path.dirname(app.state.path)] : [])]);

        return { snapshot: { folder: this.folder, project: project.state, app: app?.state }, project: project, app: app };
    }

    private async readKnown(file: string): Promise<FileText>
    {
        const text = await readText(file);
        this._knownTexts.set(file, text);
        return text;
    }

    private readSettings<V>(file: string, text: FileText, read: (document: Document) => { values: V; problems: Diagnostic[] }): ReadFile<V>
    {
        const state: SettingsFile<V> = { path: file, relativePath: path.relative(this.folder, file).split(path.sep).join("/"), exists: undefined !== text, problems: [] };

        if (undefined === text)
            return { state: state };

        if (null === text)
        {
            state.problems.push({ line: 0, column: 0, message: "The file isn't UTF-8." });
            return { state: state };
        }

        const document = parseBechaml(text);
        //Values are only read from a file without syntax errors, and only shown when they are all of the right kind.
        const typed = 0 === document.diagnostics.length ? read(document) : undefined;
        state.problems = toFileProblems(text, typed ? typed.problems : document.diagnostics);

        if (typed && 0 === typed.problems.length)
            state.values = typed.values;

        return { state: state, document: document };
    }

    private projectPath(): string
    {
        return path.join(this.folder, projectFileName);
    }

    //Watches the folders that hold the files, since editors often save by replacing a file. Folders that don't exist yet
    //are tried again on the next read.
    private watchFolders(folders: string[]): void
    {
        for (const [folder, watcher] of this._watchers)
        {
            if (!folders.includes(folder))
            {
                watcher.close();
                this._watchers.delete(folder);
            }
        }

        for (const folder of folders)
        {
            if (this._watchers.has(folder))
                continue;

            try
            {
                const watcher = watch(folder, () => this.scheduleChangeCheck());
                watcher.on("error", () => this._watchers.delete(folder));
                watcher.unref();
                this._watchers.set(folder, watcher);
            }
            catch
            {
                //The folder isn't there (yet).
            }
        }
    }

    //Waits for a burst of file events to end, then reports the files if their text changed.
    private scheduleChangeCheck(): void
    {
        clearTimeout(this._changeTimer);

        this._changeTimer = setTimeout(() =>
        {
            void this.serialized(async () =>
            {
                const files = [...this._knownTexts.keys()];
                const before = files.map(file => this._knownTexts.get(file));
                const texts = await Promise.all(files.map(readText));

                if (texts.every((text, index) => text === before[index]))
                    return;

                const read = await this.readAll();

                if (this._isWatching)
                    this._onOutsideChange(read.snapshot);
            });
        }, 150);

        this._changeTimer.unref();
    }

    private serialized<T>(task: () => Promise<T>): Promise<T>
    {
        const result = this._queue.then(task);
        this._queue = result.catch(() => undefined);
        return result;
    }
}

function answer(isWritten: boolean, message: string, snapshot: ProjectSnapshot): EditAnswer
{
    return { isWritten: isWritten, message: message, snapshot: snapshot };
}

function unreadableReason(state: SettingsFile<unknown>): string
{
    if (!state.exists)
        return "it doesn't exist.";

    const first = state.problems[0];
    return first ? "line " + first.line + ": " + first.message : "it can't be read.";
}

async function readText(file: string): Promise<FileText>
{
    try
    {
        if (!(await stat(file)).isFile())
            return undefined;

        return decoder.decode(await readFile(file));
    }
    catch (error)
    {
        return error instanceof TypeError ? null : undefined;
    }
}

//The folder of the project to open from start: the nearest one up with a Project.bechaml, else the nearest one up with a
//CMakeLists.txt, else start itself.
export async function findProjectFolder(start: string): Promise<string>
{
    const folders: string[] = [];

    for (let folder = path.resolve(start); ; folder = path.dirname(folder))
    {
        folders.push(folder);

        if (path.dirname(folder) === folder)
            break;
    }

    for (const marker of [projectFileName, "CMakeLists.txt"])
    {
        for (const folder of folders)
        {
            if (await stat(path.join(folder, marker)).then(info => info.isFile(), () => false))
                return folder;
        }
    }

    return path.resolve(start);
}
