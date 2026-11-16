import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MachineEnvironment } from "../setup/Environment.js";
import { vcvars64Path } from "../setup/VisualStudio.js";

//Everything a build runs with: the tools Setup chose and the environment the compiler needs
export interface Toolset
{
    cmake: string;
    ninja: string;
    vcpkgRoot: string;
    compiler: string; //the Visual Studio folder on Windows, the compiler's file elsewhere
    environment: NodeJS.ProcessEnv;
}

//vcvars64.bat's environment, by Visual Studio folder: running it takes a few seconds, and it never changes for an
//installation while Roux runs
const studioEnvironments = new Map<string, NodeJS.ProcessEnv>();

//The environment of a Visual Studio's vcvars64.bat: what a "x64 Native Tools" prompt has. Without it, cl.exe finds no
//standard headers and vcpkg's FindFFMPEG no psapi.lib
export async function visualStudioEnvironment(installationPath: string): Promise<NodeJS.ProcessEnv | undefined>
{
    const cached = studioEnvironments.get(installationPath.toLowerCase());

    if (cached)
        return cached;

    const output = await new Promise<string | undefined>(resolve =>
    {
        //The /s switch keeps the quotes around the batch file's path; set prints the environment it left. It starts from Roux's
        //environment without any developer environment in it, since vcvars64.bat keeps another version's tools it finds set
        const child = spawn("cmd.exe", ["/d", "/s", "/c", "\"\"" + vcvars64Path(installationPath) + "\" >nul && set\""], { windowsHide: true, windowsVerbatimArguments: true, env: withoutDeveloperEnvironment(process.env) });
        let text = "";
        child.stdin.end();
        child.stdout.setEncoding("utf8").on("data", chunk => { text += chunk; });
        child.on("error", () => resolve(undefined));
        child.on("close", code => resolve(0 === code ? text : undefined));
    });

    if (!output)
        return undefined;

    const environment: NodeJS.ProcessEnv = {};

    for (const line of output.split(/\r?\n/))
    {
        const equals = line.indexOf("=");

        if (0 < equals)
            environment[line.slice(0, equals)] = line.slice(equals + 1);
    }

    if (!environment.INCLUDE)
        return undefined;

    studioEnvironments.set(installationPath.toLowerCase(), environment);
    return environment;
}

//What a Visual Studio developer environment (vcvars64.bat, a Developer PowerShell) sets
const developerVariables = /^(VSINSTALLDIR|VCINSTALLDIR|VCIDEInstallDir|VCToolsInstallDir|VCToolsRedistDir|VCToolsVersion|VisualStudioVersion|DevEnvDir|ExtensionSdkDir|EXTERNAL_INCLUDE|INCLUDE|LIB|LIBPATH|IFCPATH|Platform|CommandPromptType|UCRTVersion|UniversalCRTSdkDir|WindowsLibPath|WindowsSdk\w*|Framework\w*|FSHARPINSTALLDIR|VSCMD_\w*|__VSCMD_\w*|__DOTNET_\w*)$/i;

//Folders a developer environment puts on the PATH
const developerFolders = /\\(Microsoft Visual Studio|Windows Kits|Microsoft SDKs|MSBuild)\\/i;

//The environment without a developer environment in it: Roux started in a terminal where another Visual Studio's
//vcvars64.bat ran would otherwise build with that one's compiler, since vcvars64.bat keeps the tools it finds set. The PATH
//goes back to what it was before (__VSCMD_PREINIT_PATH), or loses the developer environment's folders
export function withoutDeveloperEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv
{
    const clean: NodeJS.ProcessEnv = {};
    const preinitPath = Object.entries(environment).find(([name]) => "__vscmd_preinit_path" === name.toLowerCase())?.[1];

    for (const [name, value] of Object.entries(environment))
    {
        if (!developerVariables.test(name))
            clean[name] = value;
    }

    for (const name of Object.keys(clean).filter(candidate => "path" === candidate.toLowerCase()))
        clean[name] = preinitPath ?? (clean[name] ?? "").split(";").filter(entry => !developerFolders.test(entry)).join(";");

    return clean;
}

//Sets a variable in a copy of the environment, dropping other spellings of its name first: on Windows Path and PATH are
//one variable, but a child process given both gets one of them at random
export function withVariable(environment: NodeJS.ProcessEnv, name: string, value: string, platform: NodeJS.Platform): NodeJS.ProcessEnv
{
    const copy = { ...environment };

    if ("win32" === platform)
    {
        for (const key of Object.keys(copy))
        {
            if (key.toLowerCase() === name.toLowerCase())
                delete copy[key];
        }
    }

    copy[name] = value;
    return copy;
}

//Which C++ compiler a build folder was configured with, from its CMakeCache.txt; undefined while it isn't configured
export async function configuredCompiler(buildFolder: string): Promise<string | undefined>
{
    const cache = await readFile(path.join(buildFolder, "CMakeCache.txt"), "utf8").catch(() => undefined);
    return cache ? /^CMAKE_CXX_COMPILER:[A-Z]+=(.+)$/m.exec(cache)?.[1]?.trim() : undefined;
}

//Whether a configured compiler belongs to the chosen one: a cl.exe inside the chosen Visual Studio folder, or the same
//file elsewhere. Mixing them is what breaks a build with walls of errors in the standard headers
export function isSameCompiler(configured: string, chosen: string, environment: MachineEnvironment): boolean
{
    const normalize = (file: string) =>
    {
        const resolved = path.resolve(file);
        return "win32" === environment.platform ? resolved.toLowerCase() : resolved;
    };

    const configuredPath = normalize(configured);
    const chosenPath = normalize(chosen);
    return "win32" === environment.platform ? configuredPath.startsWith(chosenPath + path.sep) : configuredPath === chosenPath;
}