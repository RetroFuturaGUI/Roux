import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatString } from "../bechaml/Edit.js";
import { BechamlEditor, findChild } from "../bechaml/Editor.js";
import { parseBechaml } from "../bechaml/Parser.js";

//The build type and the platform being built. A choice of whoever builds, so the file isn't checked in
export const projectUserFileName = "Project.user.bechaml";
export const buildTypes = ["Debug", "Release", "RelWithDebInfo", "MinSizeRel"];

export async function readBuildTarget(folder: string): Promise<{ platform: string; buildType: string }>
{
    const document = parseBechaml(await readFile(path.join(folder, projectUserFileName), "utf8").catch(() => ""));
    const root = 0 === document.diagnostics.length ? document.root : undefined;
    const text = (name: string) =>
    {
        const value = root && findChild(root, { name: name })?.value;
        return "String" === value?.kind ? value.value : "";
    };

    return { platform: text("ActivePlatform"), buildType: text("BuildType") };
}

//Empty when it's written, else why it isn't. A file with errors is never written over
export async function writeBuildTarget(folder: string, platform: string, buildType: string): Promise<string>
{
    const file = path.join(folder, projectUserFileName);
    const document = parseBechaml(await readFile(file, "utf8").catch(() => "<ProjectUser>\n</ProjectUser>\n"));

    if (0 < document.diagnostics.length)
        return projectUserFileName + " has errors, so it isn't written over: " + (document.diagnostics[0]?.message ?? "");

    const editor = new BechamlEditor(document);
    editor.setValue([{ name: "BuildType" }], formatString(buildType));
    editor.setValue([{ name: "ActivePlatform" }], formatString(platform));

    if (editor.refusal)
        return "Can't write " + projectUserFileName + ": " + (editor.refusal[0]?.message ?? "");

    if (editor.text !== document.source)
        await writeFile(file, editor.text, "utf8");

    return "";
}