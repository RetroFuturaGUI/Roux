import type { PlatformSettings, ProjectEdit, ProjectValues, RemovedSlots } from "@retrofuturagui/roux-protocol";
import { formatBool, formatList, formatString } from "../bechaml/Edit.js";
import { BechamlEditor, findChild, stringAttribute, type ElementPath } from "../bechaml/Editor.js";
import type { Diagnostic, Document } from "../bechaml/Syntax.js";
import { compareVersions } from "../setup/Version.js";
import { compilerFlags, featureNames, languageStandards, platformCompilers, platformLanguages, platformNames } from "./Catalog.js";
import { duplicate, isStringList, relativePathMistake, ValueReader } from "./Values.js";

export const projectFileName = "Project.bechaml";
export const defaultAppSettingsPath = "App/App.bechaml";

//RetroFuturaGUI's own cmake_minimum_required
export const minimumCMakeVersion = "3.16";

type TextKey = "name" | "identifier" | "version" | "cmakeVersion" | "appSettings" | "startWindow" | "license" | "removedSlots";
type ListKey = "platforms" | "features" | "assets" | "authors";

const textElements: Record<TextKey, string> =
{
    name: "Name",
    identifier: "Identifier",
    version: "Version",
    cmakeVersion: "CMakeVersion",
    appSettings: "AppSettings",
    startWindow: "StartWindow",
    license: "License",
    removedSlots: "RemovedSlots"
};

const listElements: Record<ListKey, string> =
{
    platforms: "Platforms",
    features: "Features",
    assets: "Assets",
    authors: "Authors"
};

//A platform's block is named after it: <Windows>. A new one goes after the other platforms' blocks.
function platformPath(platform: string): ElementPath
{
    return [{ name: platform, after: platformNames }];
}

const otherElements = ["AllowNonRoyaltyFreeCodecs"];

//An element at the top that's no setting and no platform, such as a misspelled <Windws>.
function isUnknownElement(name: string): boolean
{
    return !Object.values(textElements).includes(name) && !Object.values(listElements).includes(name) && !otherElements.includes(name) && !platformNames.includes(name);
}

export function readProject(document: Document): { values: ProjectValues; problems: Diagnostic[] }
{
    const root = document.root;
    const reader = new ValueReader();
    reader.rootIs(root, "Project", projectFileName);

    const text = (key: TextKey, example: string) => reader.string(root && findChild(root, { name: textElements[key] }), example);
    const list = (key: ListKey, example: string) => reader.strings(root && findChild(root, { name: listElements[key] }), example);

    const platformSettings: Record<string, PlatformSettings> = {};

    for (const block of root?.elements ?? [])
    {
        if (isUnknownElement(block.name))
            reader.problems.push({ start: (block.nameToken ?? block).start, end: (block.nameToken ?? block).end, message: "<" + block.name + "> is neither a setting nor a platform. The platforms are " + platformNames.join(", ") + "." });

        if (!platformNames.includes(block.name))
            continue;

        const language = findChild(block, { name: "Language" });

        platformSettings[block.name] =
        {
            language: language ? stringAttribute(language, "Name") ?? "" : "",
            standard: language ? stringAttribute(language, "Standard") ?? "" : "",
            compiler: reader.string(findChild(block, { name: "Compiler" }), "\"MSVC\""),
            compilerFlags: reader.strings(findChild(block, { name: "CompilerFlags" }), "{ \"Wall\", \"Werror\" }")
        };
    }

    const removedSlots = text("removedSlots", "\"CommentOut\"");

    const values: ProjectValues =
    {
        name: text("name", "\"TestProject\""),
        identifier: text("identifier", "\"com.example.app\""),
        version: text("version", "\"0.1.0\""),
        cmakeVersion: text("cmakeVersion", "\"3.16\""),
        platforms: list("platforms", "{ \"Windows\" }"),
        platformSettings: platformSettings,
        allowNonRoyaltyFreeCodecs: reader.bool(root && findChild(root, { name: "AllowNonRoyaltyFreeCodecs" })),
        features: list("features", "{ \"Video\" }"),
        appSettings: text("appSettings", "\"App/App.bechaml\""),
        startWindow: text("startWindow", "\"source/code/Windows/MainWindow.bechaml\""),
        assets: list("assets", "{ \"Assets\" }"),
        authors: list("authors", "{ \"Lawn Meower\" }"),
        license: text("license", "\"Proprietary\""),
        removedSlots: "Delete" === removedSlots ? "Delete" : "CommentOut"
    };

    return { values: values, problems: reader.problems };
}

//Empty when the edit can be written, else why it can't. It checks the shape too, since edits come from outside the core.
export function projectEditMistake(edit: ProjectEdit): string
{
    switch (edit.key)
    {
        case "name":
            return /^[A-Za-z_][A-Za-z0-9_]*$/.test(edit.value) ? "" : "Letters, digits and _ only, not starting with a digit.";
        case "identifier":
            return "" === edit.value || /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(edit.value) ? "" : "Reverse domain with at least two parts, in lower case: com.example.app";
        case "version":
            return /^\d+\.\d+\.\d+$/.test(edit.value) ? "" : "Needs three numbers: major.minor.patch (0.1.0).";
        case "cmakeVersion":
            if (!/^\d+\.\d+(\.\d+)?$/.test(edit.value))
                return "A CMake version, such as 3.16 or 3.31.2.";

            return 0 > compareVersions(edit.value, minimumCMakeVersion) ? "RetroFuturaGUI needs CMake " + minimumCMakeVersion + " or newer." : "";
        case "appSettings":
            if (!edit.value.endsWith(".bechaml"))
                return "A .bechaml file, relative to the project: " + defaultAppSettingsPath + ".";

            return relativePathMistake(edit.value);
        case "startWindow":
            if ("" === edit.value)
                return "";

            if (!edit.value.endsWith(".bechaml"))
                return "A Window's .bechaml file, relative to the project.";

            return relativePathMistake(edit.value);
        case "license":
            return "" === edit.value.trim() ? "A license is needed: Proprietary when it isn't an open one." : "";
        case "removedSlots":
            return "Delete" === edit.value || "CommentOut" === edit.value ? "" : "Removed slots are deleted (Delete) or commented out (CommentOut).";
        case "platforms":
        case "features":
        {
            const known = "platforms" === edit.key ? platformNames : featureNames;
            const unknown = edit.value.find(name => !known.includes(name));
            const twice = duplicate(edit.value);

            if (undefined !== unknown)
                return unknown + " isn't one of " + known.join(", ") + ".";

            return undefined === twice ? "" : twice + " is listed twice.";
        }
        case "assets":
        {
            const twice = duplicate(edit.value);

            for (const folder of edit.value)
            {
                const mistake = relativePathMistake(folder);

                if (mistake)
                    return folder + ": " + mistake;
            }

            return undefined === twice ? "" : twice + " is listed twice.";
        }
        case "authors":
        {
            const twice = duplicate(edit.value);

            if (edit.value.some(author => "" === author.trim()))
                return "An author needs a name.";

            return undefined === twice ? "" : twice + " is listed twice.";
        }
        case "allowNonRoyaltyFreeCodecs":
            return "";
        case "platform":
            return platformSettingsMistake(edit.platform, edit.value);
    }
}

function platformSettingsMistake(platform: string, settings: PlatformSettings): string
{
    const languages = platformLanguages[platform];
    const compilers = platformCompilers[platform] ?? [];

    if (!languages)
        return platform + " isn't a platform Roux knows.";

    if (!languages.includes(settings.language))
        return platform + " offers " + languages.join(", ") + ", not " + settings.language + ".";

    if (!languageStandards[settings.language]?.includes(settings.standard))
        return settings.language + " has no standard " + settings.standard + ".";

    if (!compilers.includes(settings.compiler))
        return platform + " builds with " + compilers.join(", ") + ", not " + settings.compiler + ".";

    const unknown = settings.compilerFlags.find(flag => !Object.hasOwn(compilerFlags, flag));

    if (undefined !== unknown)
        return unknown + " isn't one of the compiler flags " + Object.keys(compilerFlags).join(", ") + ".";

    const twice = duplicate(settings.compilerFlags);
    return undefined === twice ? "" : twice + " is listed twice.";
}

//Checks that a value from outside has the shape its key needs, so the rest of the core can trust the types.
export function isProjectEdit(edit: unknown): edit is ProjectEdit
{
    if ("object" !== typeof edit || null === edit || !("key" in edit) || !("value" in edit))
        return false;

    const { key, value } = edit as { key: unknown; value: unknown };

    if ("string" !== typeof key)
        return false;

    if (Object.hasOwn(textElements, key))
        return "string" === typeof value;

    if (Object.hasOwn(listElements, key))
        return isStringList(value);

    if ("allowNonRoyaltyFreeCodecs" === key)
        return "boolean" === typeof value;

    if ("platform" !== key || !("platform" in edit) || "string" !== typeof edit.platform)
        return false;

    const settings = value as Partial<PlatformSettings> | null;
    return "object" === typeof settings && null !== settings && "string" === typeof settings.language && "string" === typeof settings.standard && "string" === typeof settings.compiler && isStringList(settings.compilerFlags);
}

//The edited file's text, or why it can't be written. Ticking a platform also gives it a block of its own with the
//defaults, when it has none yet: C++23 and the platform's first compiler. Unticking keeps the block.
export function editProject(document: Document, edit: ProjectEdit): { text: string } | { message: string }
{
    const mistake = projectEditMistake(edit);

    if (mistake)
        return { message: mistake };

    const editor = new BechamlEditor(document);

    switch (edit.key)
    {
        case "platforms":
            editor.setValue([{ name: listElements.platforms }], formatList(edit.value.map(formatString)));

            for (const platform of edit.value)
            {
                if (!editor.find(platformPath(platform)))
                    writePlatformSettings(editor, platform, defaultPlatformSettings(platform));
            }

            break;
        case "features":
        case "assets":
        case "authors":
            editor.setValue([{ name: listElements[edit.key] }], formatList(edit.value.map(formatString)));
            break;
        case "allowNonRoyaltyFreeCodecs":
            editor.setValue([{ name: "AllowNonRoyaltyFreeCodecs" }], formatBool(edit.value));
            break;
        case "platform":
            writePlatformSettings(editor, edit.platform, edit.value);
            break;
        default:
            editor.setValue([{ name: textElements[edit.key] }], formatString(edit.value));
            break;
    }

    if (editor.refusal)
        return { message: "Can't write this: " + (editor.refusal[0]?.message ?? "the file would have an error.") };

    return { text: editor.text };
}

export function defaultPlatformSettings(platform: string): PlatformSettings
{
    return { language: "C++", standard: "23", compiler: platformCompilers[platform]?.[0] ?? "", compilerFlags: [] };
}

function writePlatformSettings(editor: BechamlEditor, platform: string, settings: PlatformSettings): void
{
    const block = platformPath(platform);
    editor.setAttribute([...block, { name: "Language" }], "Name", formatString(settings.language));
    editor.setAttribute([...block, { name: "Language" }], "Standard", formatString(settings.standard));
    editor.setValue([...block, { name: "Compiler" }], formatString(settings.compiler));

    //No element for no flags, unless the file has one already.
    if (0 < settings.compilerFlags.length || editor.find([...block, { name: "CompilerFlags" }]))
        editor.setValue([...block, { name: "CompilerFlags" }], formatList(settings.compilerFlags.map(formatString)));
}

//A new Project.bechaml: the project's name from its folder, this computer's platform, the rest as the plan's defaults.
export function newProjectText(folderName: string, platform: string, removedSlots: RemovedSlots = "CommentOut"): string
{
    const name = folderName.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=[0-9])/, "_") || "App";
    const settings = defaultPlatformSettings(platform);

    return [
        "<Project>",
        "    <Name>" + formatString(name) + "</Name>",
        "    <Identifier>\"\"</Identifier>",
        "    <Version>\"0.1.0\"</Version>",
        "    <CMakeVersion>" + formatString(minimumCMakeVersion) + "</CMakeVersion>",
        "    <Platforms>{ " + formatString(platform) + " }</Platforms>",
        "",
        "    <" + platform + ">",
        "        <Language Name=" + formatString(settings.language) + " Standard=" + formatString(settings.standard) + "/>",
        "        <Compiler>" + formatString(settings.compiler) + "</Compiler>",
        "    </" + platform + ">",
        "    <AllowNonRoyaltyFreeCodecs>False</AllowNonRoyaltyFreeCodecs>",
        "    <Features>{ }</Features>",
        "    <AppSettings>" + formatString(defaultAppSettingsPath) + "</AppSettings>",
        "    <StartWindow>\"\"</StartWindow>",
        "    <Assets>{ }</Assets>",
        "    <Authors>{ }</Authors>",
        "    <License>\"Proprietary\"</License>",
        "    <RemovedSlots>" + formatString(removedSlots) + "</RemovedSlots>",
        "</Project>",
        ""
    ].join("\n");
}
