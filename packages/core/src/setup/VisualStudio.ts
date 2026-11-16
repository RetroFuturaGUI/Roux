import { existsSync } from "node:fs";
import path from "node:path";
import { variable, type MachineEnvironment } from "./Environment.js";
import { runProcess } from "./Process.js";

export interface VisualStudioInstallation
{
    installationPath: string;
    displayName: string; //"Visual Studio Community 2022"
    version: string;     //"17.14.36310.24"
}

//The C++ compiler for x64; without it there is no cl.exe and no vcvars64.bat.
const cppToolsComponent = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64";

//Lists every Visual Studio installation through vswhere, which the Visual Studio Installer puts in a fixed place.
//Empty when there is no installer, or on other systems. withCppTools keeps only those that can build C++ for x64
export async function visualStudioInstallations(environment: MachineEnvironment, withCppTools = false): Promise<VisualStudioInstallation[]>
{
    if ("win32" !== environment.platform)
        return [];

    const programFilesX86 = variable(environment, "ProgramFiles(x86)");

    if (!programFilesX86)
        return [];

    const vswhere = path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");

    if (!existsSync(vswhere))
        return [];

    //-products * also finds the Build Tools, which aren't a "Visual Studio" product to vswhere
    const requirement = withCppTools ? ["-requires", cppToolsComponent] : [];
    const output = await runProcess(vswhere, ["-all", "-prerelease", "-products", "*", ...requirement, "-format", "json", "-utf8"]);

    if (undefined === output)
        return [];

    return parseVswhere(output);
}

export function parseVswhere(output: string): VisualStudioInstallation[]
{
    let entries: unknown;

    try
    {
        entries = JSON.parse(output);
    }
    catch
    {
        return [];
    }

    if (!Array.isArray(entries))
        return [];

    return entries
        .filter(entry => "string" === typeof entry?.installationPath)
        .map(entry => ({
            installationPath: entry.installationPath as string,
            displayName: "string" === typeof entry.displayName ? entry.displayName as string : "Visual Studio",
            version: "string" === typeof entry.installationVersion ? entry.installationVersion as string : ""
        }));
}

export function vcvars64Path(installationPath: string): string
{
    return path.join(installationPath, "VC", "Auxiliary", "Build", "vcvars64.bat");
}