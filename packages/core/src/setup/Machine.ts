import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatString } from "../bechaml/Edit.js";
import { BechamlEditor, findChild } from "../bechaml/Editor.js";
import { parseBechaml } from "../bechaml/Parser.js";
import { variable, type MachineEnvironment } from "./Environment.js";

//The components whose installation can be chosen, and their element in Machine.bechaml
const machineElements: Record<string, string> =
{
    "Git": "Git",
    "CMake": "CMake",
    "Ninja": "Ninja",
    "Compiler": "Compiler",
    "VCPKG_ROOT": "Vcpkg",
    "Clang": "Clang"
};

export function isChoosable(component: string): boolean
{
    return component in machineElements;
}

//In the user's profile, since the choices belong to this computer, not to a project: %APPDATA%\Roux on Windows,
//~/Library/Application Support/Roux on macOS, $XDG_CONFIG_HOME/roux or ~/.config/roux elsewhere
export function machineFilePath(environment: MachineEnvironment): string
{
    if ("win32" === environment.platform)
        return path.join(variable(environment, "APPDATA") || path.join(environment.homeDirectory, "AppData", "Roaming"), "Roux", "Machine.bechaml");

    if ("darwin" === environment.platform)
        return path.join(environment.homeDirectory, "Library", "Application Support", "Roux", "Machine.bechaml");

    return path.join(variable(environment, "XDG_CONFIG_HOME") || path.join(environment.homeDirectory, ".config"), "roux", "Machine.bechaml");
}

//The installations chosen on this computer. A missing or broken file means nothing was chosen, so every check takes its
//default. Broken file is never written over
export class MachineSettings
{
    readonly file: string;

    constructor(file: string)
    {
        this.file = file;
    }

    //The chosen path by component.
    async choices(): Promise<Record<string, string>>
    {
        const document = parseBechaml(await this.text() ?? "");
        const choices: Record<string, string> = {};

        if (0 < document.diagnostics.length || !document.root)
            return choices;

        for (const [component, name] of Object.entries(machineElements))
        {
            const value = findChild(document.root, { name: name })?.value;

            if ("String" === value?.kind && value.value)
                choices[component] = path.normalize(value.value);
        }

        return choices;
    }

    //Empty when it's saved, else why it isn't
    async choose(component: string, chosenPath: string): Promise<string>
    {
        const name = machineElements[component];

        if (!name)
            return component + "'s installation isn't chosen.";

        const text = await this.text() ?? "<Machine>\n</Machine>\n";
        const document = parseBechaml(text);

        if (0 < document.diagnostics.length)
            return this.file + " has errors, so it isn't written over: " + (document.diagnostics[0]?.message ?? "");

        const editor = new BechamlEditor(document);

        if (!editor.setValue([{ name: name }], formatString(chosenPath.split(path.sep).join("/"))))
            return "Can't write " + this.file + ": " + (editor.refusal?.[0]?.message ?? "");

        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file, editor.text, "utf8");
        return "";
    }

    private async text(): Promise<string | undefined>
    {
        try
        {
            return await readFile(this.file, "utf8");
        }
        catch
        {
            return undefined;
        }
    }
}