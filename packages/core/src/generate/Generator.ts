import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectEdit, ProjectValues } from "@retrofuturagui/roux-protocol";
import { findChild } from "../bechaml/Editor.js";
import { LineMap } from "../bechaml/LineMap.js";
import { parseBechaml } from "../bechaml/Parser.js";
import type { Document } from "../bechaml/Syntax.js";
import { projectEditMistake, projectFileName, readProject } from "../project/ProjectFile.js";
import { newCMakeListsText, updateRegions } from "./CMakeRegions.js";
import { schemaVersion, type Schema } from "../schema/Schema.js";
import { headersHash, schemaFileName } from "../schema/SchemaFile.js";
import { cmakeRegions, headerExtensions, projectCMakePath, projectCMakeText, skippedFolders, sourceExtensions, type ProjectFiles } from "./ProjectCMake.js";
import { generatedMark } from "./MarkupGenerator.js";
import { generatePrefab, generatedPrefabsFolder, prefabName, type PrefabModel, type PrefabProject } from "./PrefabGenerator.js";
import { generateScene, generatedSceneBase, sceneName, type SceneInput } from "./SceneGenerator.js";
import { generatedWindowBase, generateWindow, startFiles } from "./WindowGenerator.js";
import { generateFlavors, stylesFiles, type FlavorsInput } from "./StylesGenerator.js";

export interface GenerateProblem
{
    readonly file: string; //Absolute
    readonly line: number;
    readonly column: number;
    readonly severity: "error" | "warning";
    readonly message: string;
}

export interface GenerateResult
{
    readonly hasProject: boolean; //False without a Project.bechaml: then nothing is generated
    readonly problems: readonly GenerateProblem[];
    readonly written: readonly string[]; //Absolute; files whose text didn't change aren't written
    readonly removed: readonly string[]; //Absolute: files Roux wrote before and no longer writes, such as a renamed scene's
}

//Whether Generate has to run: without a Project.bechaml there's nothing to generate; otherwise it runs when a file it
//reads changed since it last ran, or a file it writes is gone
export type GenerateNeed = "noProject" | "changed" | "unchanged";

const generatedFolder = "source/generated";

//What Generate read when it last ran, by each file's hash. A hidden file, so it isn't taken for source.
const inputsPath = generatedFolder + "/.roux-inputs.json";

//The files Generate always reads. CMakeLists.txt is one too: the project's own lines in it may have broken a marker.
const inputFiles = [projectFileName, "CMakeLists.txt", "RetroFuturaGUI/" + schemaFileName];

//Where the project's .bechaml files and the classes Roux makes next to them live.
const codeFolder = "source/code";

//Raised whenever Roux writes other text from the same files, so a newer Roux generates again.
const generatorRevision = 3;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export async function generateNeed(folder: string): Promise<GenerateNeed>
{
    if (undefined === await readText(path.join(folder, projectFileName)))
        return "noProject";

    const remembered = await readText(path.join(folder, ...inputsPath.split("/")));
    const current = await inputsText(folder);

    if (current !== remembered || !await isFile(path.join(folder, ...projectCMakePath.split("/"))))
        return "changed";

    return "unchanged";
}

//The inputs' hashes as Generate keeps them: the fixed ones, every .bechaml file in source/code/ and the .hpp and .cpp
//next to each, since Roux looks into those for slots.
async function inputsText(folder: string): Promise<string>
{
    const hashes: Record<string, string> = {};
    const markup = (await markupFiles(folder)).map(file => path.relative(folder, file).split(path.sep).join("/"));
    const companions = markup.flatMap(file => [".hpp", ".cpp"].map(extension => file.replace(/\.bechaml$/, extension)));

    const libraryPrefabs = (await libraryPrefabFiles(path.join(folder, "RetroFuturaGUI"))).map(file => path.relative(folder, file).split(path.sep).join("/"));

    for (const file of [...inputFiles, ...markup, ...companions, ...libraryPrefabs])
    {
        const bytes = await readFile(path.join(folder, ...file.split("/"))).catch(() => undefined);
        hashes[file] = bytes ? createHash("sha256").update(bytes).digest("hex") : "";
    }

    return JSON.stringify({ revision: generatorRevision, files: hashes }, undefined, 4) + "\n";
}

async function markupFiles(folder: string): Promise<string[]>
{
    return (await filesUnder(path.join(folder, ...codeFolder.split("/")))).filter(file => ".bechaml" === path.extname(file).toLowerCase());
}

//The scenes' and windows' files and the start function (Roux plan, 6.2.1): every .bechaml in source/code/ whose root is
//<Scene> or <Window>, generated with Schema.json, and Start.cpp when Project.bechaml names a start window. Files with
//another root are other kinds, read by later steps. startWindow is reported at <StartWindow>.
async function markupOutputs(folder: string, namespace: string, startWindow: string, assetFolders: readonly string[], startWindowMistake: (message: string) => void, problems: GenerateProblem[]): Promise<Map<string, string>>
{
    const outputs = new Map<string, string>();
    const scenes: { file: string; text: string; document: Document }[] = [];
    const windows: { file: string; text: string; document: Document }[] = [];
    const projectPrefabs: SceneInput[] = [];
    const flavorFiles: FlavorsInput[] = [];

    for (const file of await markupFiles(folder))
    {
        const text = await readText(file);

        if (!text)
            continue;

        const document = parseBechaml(text);

        if ("Scene" === document.root?.name)
            scenes.push({ file: file, text: text, document: document });
        else if ("Window" === document.root?.name)
            windows.push({ file: file, text: text, document: document });
        else if ("Prefab" === document.root?.name)
            projectPrefabs.push({ file: file, text: text, document: document });
        else if ("Flavors" === document.root?.name)
            flavorFiles.push({ file: file, text: text, document: document });
    }

    if (0 === scenes.length + windows.length + projectPrefabs.length + flavorFiles.length)
    {
        if (startWindow)
            startWindowMistake("<StartWindow> names " + startWindow + ", which isn't a window file.");

        return outputs;
    }

    const first = ([...scenes, ...windows, ...projectPrefabs, ...flavorFiles][0] as { file: string }).file;
    const schemaFile = path.join(folder, "RetroFuturaGUI", schemaFileName);
    const schemaText = await readText(schemaFile);
    const schema = schemaText ? JSON.parse(schemaText) as Schema : undefined;

    if (!schema || schemaVersion !== schema.schemaVersion)
    {
        const message = schema ? "RetroFuturaGUI/Schema.json was made by another Roux: run roux schema." : "Scenes and windows are generated with RetroFuturaGUI/Schema.json, which is missing: run roux schema.";
        problems.push({ file: schema ? schemaFile : first, line: 1, column: 1, severity: "error", message: message });
        return outputs;
    }

    if (!/^[A-Za-z_]\w*$/.test(namespace))
    {
        problems.push({ file: path.join(folder, projectFileName), line: 1, column: 1, severity: "error", message: "The project's Name " + namespace + " can't name the C++ namespace of its scenes and windows." });
        return outputs;
    }

    //The flavors first, so every scene, prefab and window can check the ones it names. A name is the project's once
    const flavorNames = new Map<string, string>();
    const registerFunctions: string[] = [];

    for (const flavorFile of flavorFiles)
    {
        const result = generateFlavors(flavorFile, folder, namespace, schema, assetFolders);
        problems.push(...result.problems);
        result.outputs.forEach((text, file) => outputs.set(file, text));

        if (result.registerFunction)
            registerFunctions.push(result.registerFunction);

        for (const { name } of result.names)
        {
            const other = flavorNames.get(name);

            if (undefined !== other)
                problems.push({ file: flavorFile.file, line: 1, column: 1, severity: "error", message: "Another Flavors file names a flavor " + name + " already: " + other + "." });
            else
                flavorNames.set(name, path.relative(folder, flavorFile.file));
        }
    }

    const prefabs = await prefabModels(folder, namespace, schema, assetFolders, projectPrefabs, problems, outputs);
    const names = new Map<string, string>();

    for (const scene of scenes)
    {
        const name = sceneName(scene.document);

        if (name && names.has(name))
            problems.push({ file: scene.file, line: 1, column: 1, severity: "error", message: "Another scene is named " + name + " already: " + names.get(name) + "." });
        else if (name)
            names.set(name, path.relative(folder, scene.file));
    }

    //The user's class files beside a .bechaml, as they are now; undefined when one isn't UTF-8.
    const userClass = async (file: string) =>
    {
        const stem = file.replace(/\.bechaml$/i, "");
        const userHeader = await readText(stem + ".hpp");
        const userSource = await readText(stem + ".cpp");

        if (null !== userHeader && null !== userSource)
            return { userHeader: userHeader, userSource: userSource };

        problems.push({ file: stem + (null === userHeader ? ".hpp" : ".cpp"), line: 1, column: 1, severity: "error", message: "The file isn't UTF-8." });
        return undefined;
    };

    const loads = new Map<string, readonly string[]>();

    for (const scene of scenes)
    {
        const user = await userClass(scene.file);

        if (!user)
            continue;

        const result = generateScene(scene, { folder: folder, namespace: namespace, schema: schema, sceneNames: new Set(names.keys()), assetFolders: assetFolders, prefabs: prefabs, flavorNames: new Set(flavorNames.keys()), ...user });
        problems.push(...result.problems);
        result.outputs.forEach((text, file) => outputs.set(file, text));

        if (result.name)
            loads.set(result.name, result.loads);
    }

    //Every scene is built by the one window listing it, as SceneLoader takes each scene's name once.
    const windowNames = new Map<string, string>();
    const listedBy = new Map<string, string>();

    for (const window of windows)
    {
        const user = await userClass(window.file);

        if (!user)
            continue;

        const result = generateWindow(window, { folder: folder, namespace: namespace, schema: schema, scenes: loads, assetFolders: assetFolders, flavorNames: new Set(flavorNames.keys()), ...user });
        problems.push(...result.problems);
        result.outputs.forEach((text, file) => outputs.set(file, text));

        if (!result.name)
            continue;

        if (windowNames.has(result.name))
            problems.push({ file: window.file, line: 1, column: 1, severity: "error", message: "Another window is named " + result.name + " already: " + windowNames.get(result.name) + "." });

        windowNames.set(result.name, window.file);

        for (const scene of result.scenes)
        {
            const other = listedBy.get(scene.name);

            if (other && other !== result.name)
                problems.push({ file: window.file, line: 1, column: 1, severity: "error", message: scene.name + " is listed by " + other + " already; a scene is shown by one window." });

            listedBy.set(scene.name, result.name);
        }
    }

    if (0 < scenes.length)
        generatedSceneBase(folder, namespace).forEach((text, file) => outputs.set(file, text));

    if (0 < windows.length)
        generatedWindowBase(folder, namespace).forEach((text, file) => outputs.set(file, text));

    if (startWindow)
    {
        const startFile = path.resolve(folder, startWindow);
        const start = [...windowNames].find(([, file]) => file === startFile)?.[0];

        if (start)
            startFiles(folder, namespace, start, projectFileName).forEach((text, file) => outputs.set(file, text));
        else
            startWindowMistake("<StartWindow> names " + startWindow + ", which isn't a window file that could be generated.");
    }
    //Start calls RegisterStyles, and every Flavors file's source is declared in Styles.hpp
    if (startWindow || 0 < flavorFiles.length)
        stylesFiles(folder, namespace, registerFunctions).forEach((text, file) => outputs.set(file, text));

    const generated = path.join(folder, ...generatedFolder.split("/")) + path.sep;

    //A file there that Roux didn't write is someone's work: it stays, and Generate stops.
    for (const file of outputs.keys())
    {
        const existing = await readText(file);

        if (file.startsWith(generated) && "string" === typeof existing && !existing.startsWith(generatedMark))
            problems.push({ file: file, line: 1, column: 1, severity: "error", message: "Roux didn't write this file, so it doesn't overwrite it: move it away, or rename the scene." });
    }

    return outputs;
}

//RetroFuturaGUI's predefined prefabs: source/Prefabs/<Name>/<Name>.bechaml, each in a folder of its own
async function libraryPrefabFiles(libraryFolder: string): Promise<string[]>
{
    const prefabsFolder = path.join(libraryFolder, "source", "Prefabs");
    const entries = await readdir(prefabsFolder, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];

    for (const entry of entries.filter(candidate => candidate.isDirectory()).sort((left, right) => byName(left.name, right.name)))
    {
        const file = path.join(prefabsFolder, entry.name, entry.name + ".bechaml");

        if (await isFile(file))
            files.push(file);
    }

    return files;
}

async function readInputs(files: readonly string[], problems: GenerateProblem[]): Promise<SceneInput[]>
{
    const inputs: SceneInput[] = [];

    for (const file of files)
    {
        const text = await readText(file);

        if (null === text)
            problems.push({ file: file, line: 1, column: 1, severity: "error", message: "The file isn't UTF-8." });
        else if (undefined !== text)
            inputs.push({ file: file, text: text, document: parseBechaml(text) });
    }

    return inputs;
}

//What the library's predefined prefabs generate: their code goes to their own folder's generated/, as RetroFuturaGUI
//compiles it. The folder is the project's (the one holding RetroFuturaGUI), so their files read the same from Generate
//and from GeneratePrefabs.
async function libraryPrefabProject(folder: string, schema: Schema, input: SceneInput, problems: GenerateProblem[]): Promise<PrefabProject>
{
    const prefabFolder = path.dirname(input.file);
    return { folder: folder, namespace: "RetroFuturaGUI::Prefabs", schema: schema, assetFolders: [], outputFolder: path.join(prefabFolder, "generated"), isLibrary: true, ...await prefabCode(path.join(prefabFolder, "code"), input, problems) };
}

//Where a prefab's own code class goes, and its files as they are now: undefined while one doesn't exist yet. A file that
//isn't UTF-8 is reported and left alone.
async function prefabCode(codeFolder: string, input: SceneInput, problems: GenerateProblem[]): Promise<{ codeFolder: string; userHeader: string | undefined; userSource: string | undefined }>
{
    const name = prefabName(input.document.root) ?? path.basename(input.file, ".bechaml");
    const read = async (file: string) =>
    {
        const text = await readText(file);

        if (null === text)
            problems.push({ file: file, line: 1, column: 1, severity: "error", message: "The file isn't UTF-8." });

        return text ?? undefined;
    };

    return { codeFolder: codeFolder, userHeader: await read(path.join(codeFolder, name + "Code.hpp")), userSource: await read(path.join(codeFolder, name + "Code.cpp")) };
}

//Every prefab a scene may place, by name: RetroFuturaGUI's, whose code GeneratePrefabs writes into the library, so a stale
//copy is only reported, and the project's, whose code goes to source/generated/Prefabs/ with the scenes'.
async function prefabModels(folder: string, namespace: string, schema: Schema, assetFolders: readonly string[], projectPrefabs: readonly SceneInput[], problems: GenerateProblem[], outputs: Map<string, string>): Promise<Map<string, PrefabModel>>
{
    const models = new Map<string, PrefabModel>();
    const files = new Map<string, string>();
    const add = (model: PrefabModel, file: string) =>
    {
        if (models.has(model.name))
            problems.push({ file: file, line: 1, column: 1, severity: "error", message: "Another prefab is named " + model.name + " already: " + path.relative(folder, files.get(model.name) ?? "") + "." });

        models.set(model.name, model);
        files.set(model.name, file);
    };

    for (const input of await readInputs(await libraryPrefabFiles(path.join(folder, "RetroFuturaGUI")), problems))
    {
        const result = generatePrefab(input, await libraryPrefabProject(folder, schema, input, problems));
        problems.push(...result.problems);

        if (!result.model)
            continue;

        for (const [file, text] of result.outputs)
        {
            if (text === await readText(file))
                continue;

            problems.push({ file: input.file, line: 1, column: 1, severity: "warning", message: "RetroFuturaGUI's generated code of the " + result.model.name + " prefab is out of date: run its GeneratePrefabs." });
            break;
        }

        add(result.model, input.file);
    }

    for (const input of projectPrefabs)
    {
        const code = await prefabCode(path.dirname(input.file), input, problems);
        const result = generatePrefab(input, { folder: folder, namespace: namespace + "::Prefabs", schema: schema, assetFolders: assetFolders, outputFolder: path.join(folder, ...generatedPrefabsFolder.split("/")), isLibrary: false, ...code });
        problems.push(...result.problems);
        result.outputs.forEach((text, file) => outputs.set(file, text));

        if (result.model)
            add(result.model, input.file);
    }

    return models;
}

//GeneratePrefabs (roux prefabs --library): RetroFuturaGUI's predefined prefabs become their C++ in source/Prefabs/<Name>/
//generated/, with the library's Schema.json. Nothing is written while one has an error, and an unchanged file isn't written.
export async function generateLibraryPrefabs(libraryFolder: string): Promise<{ problems: GenerateProblem[]; written: string[] }>
{
    const problems: GenerateProblem[] = [];
    const schemaFile = path.join(libraryFolder, schemaFileName);
    const schemaText = await readText(schemaFile);
    const schema = schemaText ? JSON.parse(schemaText) as Schema : undefined;

    if (!schema || schemaVersion !== schema.schemaVersion)
    {
        problems.push({ file: schemaFile, line: 1, column: 1, severity: "error", message: schema ? "Schema.json was made by another Roux: run roux schema." : "Schema.json is missing: run roux schema." });
        return { problems: problems, written: [] };
    }

    const folder = path.dirname(path.resolve(libraryFolder));
    const outputs = new Map<string, string>();

    for (const input of await readInputs(await libraryPrefabFiles(libraryFolder), problems))
    {
        const result = generatePrefab(input, await libraryPrefabProject(folder, schema, input, problems));
        problems.push(...result.problems);
        result.outputs.forEach((text, file) => outputs.set(file, text));
    }

    //A file in generated/ that Roux didn't write is someone's work: it stays, and nothing is written. The code class in code/
    //is the prefab author's, which Roux only gives the slots it lacks.
    for (const file of outputs.keys())
    {
        const existing = await readText(file);

        if ("generated" === path.basename(path.dirname(file)) && "string" === typeof existing && !existing.startsWith(generatedMark))
            problems.push({ file: file, line: 1, column: 1, severity: "error", message: "Roux didn't write this file, so it doesn't overwrite it: move it away." });
    }

    if (problems.some(problem => "error" === problem.severity))
        return { problems: problems, written: [] };

    const written: string[] = [];

    for (const [file, text] of outputs)
    {
        if (text === await readText(file))
            continue;

        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, text, "utf8");
        written.push(file);
    }

    return { problems: problems, written: written };
}

//Generate's first part (Roux plan, 6.1 and 6.2): Project.bechaml becomes source/generated/Project.cmake and Roux's
//regions in CMakeLists.txt. Nothing is written while anything has an error, and an unchanged file isn't written.
export async function generateProject(folder: string): Promise<GenerateResult>
{
    const projectFile = path.join(folder, projectFileName);
    const projectText = await readText(projectFile);

    if (undefined === projectText)
        return { hasProject: false, problems: [], written: [], removed: [] };

    const problems: GenerateProblem[] = [];

    if (null === projectText)
        return { hasProject: true, problems: [{ file: projectFile, line: 1, column: 1, severity: "error", message: "The file isn't UTF-8." }], written: [], removed: [] };

    const document = parseBechaml(projectText);
    const lineMap = new LineMap(projectText);
    const at = (offset: number, severity: GenerateProblem["severity"], message: string) =>
    {
        const position = lineMap.position(offset);
        problems.push({ file: projectFile, line: position.line, column: position.column, severity: severity, message: message });
    };

    for (const diagnostic of document.diagnostics)
        at(diagnostic.start, "error", diagnostic.message);

    if (0 < problems.length)
        return { hasProject: true, problems: problems, written: [], removed: [] };

    const { values, problems: valueProblems } = readProject(document);

    for (const problem of valueProblems)
        at(problem.start, "error", problem.message);

    for (const mistake of valueMistakes(values, document))
        at(mistake.offset, "error", mistake.message);

    if (0 < problems.length)
        return { hasProject: true, problems: problems, written: [], removed: [] };

    const staleSchema = await schemaStaleness(folder);

    if (staleSchema)
        problems.push({ file: staleSchema, line: 1, column: 1, severity: "warning", message: "RetroFuturaGUI's headers changed since Schema.json was made: run roux schema." });

    const outputs = await markupOutputs(folder, values.name, values.startWindow, values.assets, message => at(elementOffset(document, "StartWindow"), "error", message), problems);
    const stale = await staleFiles(folder, outputs);
    const files = await projectFiles(folder, values, [...outputs.keys()], stale);

    for (const missing of values.assets.filter(asset => !files.assetFolders.includes(asset)))
        at(elementOffset(document, "Assets"), "warning", "The asset folder " + missing + " doesn't exist, so the build copies nothing from it.");

    outputs.set(path.join(folder, ...projectCMakePath.split("/")), projectCMakeText(values, files));

    const cmakeListsFile = path.join(folder, "CMakeLists.txt");
    const cmakeLists = await readText(cmakeListsFile);
    const regions = cmakeRegions(values, files);

    if (null === cmakeLists)
    {
        problems.push({ file: cmakeListsFile, line: 1, column: 1, severity: "error", message: "The file isn't UTF-8." });
    }
    else if (undefined === cmakeLists)
    {
        outputs.set(cmakeListsFile, newCMakeListsText(regions));
    }
    else
    {
        const update = updateRegions(cmakeLists, regions, "CMakeLists.txt");

        for (const problem of update.problems)
            problems.push({ file: cmakeListsFile, line: problem.line, column: 1, severity: problem.severity, message: problem.message });

        if (undefined !== update.text)
            outputs.set(cmakeListsFile, update.text);
    }

    if (problems.some(problem => "error" === problem.severity))
        return { hasProject: true, problems: problems, written: [], removed: [] };

    const written: string[] = [];

    for (const [file, text] of outputs)
    {
        if (text === await readText(file))
            continue;

        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, text, "utf8");
        written.push(file);
    }

    for (const file of stale)
        await rm(file, { force: true });

    //Kept after the writes, so it holds CMakeLists.txt as Roux left it. It isn't reported: it's Roux's own bookkeeping.
    const inputsFile = path.join(folder, ...inputsPath.split("/"));
    const inputs = await inputsText(folder);

    if (inputs !== await readText(inputsFile))
        await writeFile(inputsFile, inputs, "utf8");

    return { hasProject: true, problems: problems, written: written, removed: stale };
}

//Values that read fine but can't be generated from, such as a version written by hand that isn't one. The Project tab
//never writes them; a hand edit can.
function valueMistakes(values: ProjectValues, document: Document): { offset: number; message: string }[]
{
    const checks: [ProjectEdit, string][] =
    [
        [{ key: "name", value: values.name }, "Name"],
        [{ key: "version", value: values.version }, "Version"],
        [{ key: "cmakeVersion", value: values.cmakeVersion }, "CMakeVersion"],
        [{ key: "platforms", value: values.platforms }, "Platforms"],
        [{ key: "features", value: values.features }, "Features"],
        [{ key: "assets", value: values.assets }, "Assets"]
    ];

    const mistakes: { offset: number; message: string }[] = [];

    for (const [edit, element] of checks)
    {
        const mistake = projectEditMistake(edit);

        if (mistake)
            mistakes.push({ offset: elementOffset(document, element), message: "<" + element + ">: " + mistake });
    }

    if (0 === values.platforms.length)
        mistakes.push({ offset: elementOffset(document, "Platforms"), message: "<Platforms> lists no platform, so there's nothing to build." });

    for (const platform of values.platforms)
    {
        const settings = values.platformSettings[platform];
        const mistake = settings ? projectEditMistake({ key: "platform", platform: platform, value: settings }) : "";

        if (mistake)
            mistakes.push({ offset: elementOffset(document, platform), message: "<" + platform + ">: " + mistake });
    }

    return mistakes;
}

function elementOffset(document: Document, name: string): number
{
    const root = document.root;
    return (root && findChild(root, { name: name }))?.start ?? root?.start ?? 0;
}

//Roux's C++ files and the folders holding its headers, in a fixed order so Project.cmake only changes with them: those
//in source/generated/ now and those this Generate writes there. The user's files in source/code/ are found by CMake
//while building.
async function projectFiles(folder: string, values: ProjectValues, planned: readonly string[], stale: readonly string[]): Promise<ProjectFiles>
{
    const sources: string[] = [];
    const includeDirectories = ["source", generatedFolder, "source/code"];
    const generated = path.join(folder, ...generatedFolder.split("/"));
    const present = (await filesUnder(generated)).filter(file => !stale.includes(file));
    const all = [...new Set([...present, ...planned.filter(file => file.startsWith(generated + path.sep))])].sort(byName);

    for (const file of all)
    {
        const relative = path.relative(folder, file).split(path.sep).join("/");
        const extension = path.extname(file).toLowerCase();

        if (sourceExtensions.includes(extension))
            sources.push(relative);

        const directory = path.posix.dirname(relative);

        if (headerExtensions.includes(extension) && !includeDirectories.includes(directory))
            includeDirectories.push(directory);
    }

    const assetFolders: string[] = [];

    for (const asset of values.assets)
    {
        if (await isDirectory(path.join(folder, ...asset.split("/"))))
            assetFolders.push(asset);
    }

    return { sources: sources, includeDirectories: includeDirectories, assetFolders: assetFolders };
}

//Every file under the folder, sorted, skipping hidden folders and other tools' output; none when it doesn't exist.
async function filesUnder(folder: string): Promise<string[]>
{
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];

    for (const entry of [...entries].sort((first, second) => byName(first.name, second.name)))
    {
        const full = path.join(folder, entry.name);

        if (entry.isDirectory())
        {
            if (!entry.name.startsWith(".") && !skippedFolders.includes(entry.name))
                files.push(...await filesUnder(full));
        }
        else if (entry.isFile())
        {
            files.push(full);
        }
    }

    return files;
}

//Files in source/generated/ that Roux wrote (they start with its mark) and this Generate doesn't write any more, such as a
//renamed scene's: they go, so they're neither compiled nor left behind. A file without the mark stays.
async function staleFiles(folder: string, outputs: ReadonlyMap<string, string>): Promise<string[]>
{
    const stale: string[] = [];

    for (const file of await filesUnder(path.join(folder, ...generatedFolder.split("/"))))
    {
        if (outputs.has(file))
            continue;

        const text = await readText(file);

        if ("string" === typeof text && text.startsWith(generatedMark))
            stale.push(file);
    }

    return stale;
}

function byName(first: string, second: string): number
{
    return first < second ? -1 : first > second ? 1 : 0;
}

async function isDirectory(folder: string): Promise<boolean>
{
    return (await stat(folder).catch(() => undefined))?.isDirectory() ?? false;
}

//A missing file is undefined; a file that isn't UTF-8 is null.
async function readText(file: string): Promise<string | undefined | null>
{
    const bytes = await readFile(file).catch(() => undefined);

    if (!bytes)
        return undefined;

    try
    {
        return decoder.decode(bytes);
    }
    catch
    {
        return null;
    }
}

async function isFile(file: string): Promise<boolean>
{
    return (await stat(file).catch(() => undefined))?.isFile() ?? false;
}

//RetroFuturaGUI/Schema.json when the library's headers no longer match the hash it was made from; undefined when they
//do, or when there's no Schema.json to compare.
async function schemaStaleness(folder: string): Promise<string | undefined>
{
    const libraryFolder = path.join(folder, "RetroFuturaGUI");
    const file = path.join(libraryFolder, schemaFileName);
    const text = await readText(file);

    if (!text)
        return undefined;

    const madeFrom = (JSON.parse(text) as { headersHash?: string }).headersHash;
    return madeFrom === await headersHash(path.join(libraryFolder, "source")) ? undefined : file;
}
