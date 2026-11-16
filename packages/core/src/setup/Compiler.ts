import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Installation } from "@retrofuturagui/roux-protocol";
import { toolCheck } from "./CMake.js";
import { pathDirectories, type MachineEnvironment } from "./Environment.js";
import { addInstallFix, type Check } from "./Fixes.js";
import { runProcess } from "./Process.js";
import { probeCandidates, type Candidate } from "./Tool.js";
import { compareVersions } from "./Version.js";
import { vcvars64Path, visualStudioInstallations } from "./VisualStudio.js";

//The oldest compilers whose standard library has std::println, which RetroFuturaGUI uses throughout: libstdc++ 14 and
//libc++ 18
const minimumVersions: Record<string, string> = { "GCC": "14", "Clang": "18" };

//Windows: Visual Studio or its Build Tools with the C++ workload and vcvars64.bat, which Roux runs the build in. Elsewhere:
//GCC or Clang new enough for C++23
export async function findCompiler(environment: MachineEnvironment, chosenPath?: string): Promise<Check>
{
    if ("win32" !== environment.platform)
        return findUnixCompiler(environment, chosenPath);

    const installations: Installation[] = (await visualStudioInstallations(environment, true))
        .filter(studio => existsSync(vcvars64Path(studio.installationPath)))
        .map(studio => ({ version: studio.version, path: studio.installationPath, source: studio.displayName, isOnPath: false }));

    const check = toolCheck("Compiler", installations, "", chosenPath, fixes =>
        fixes.terminal("Install", "winget install Microsoft.VisualStudio.2022.BuildTools --override \"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --wait\""));

    if ("error" !== check.result.status)
        check.result.detail = ["vcvars64.bat found", check.result.detail].filter(Boolean).join("; ");
    else if (0 === installations.length && 0 < (await visualStudioInstallations(environment)).length)
        check.result.detail = "Visual Studio is installed without the C++ workload (Desktop development with C++)";

    return check;
}

async function findUnixCompiler(environment: MachineEnvironment, chosenPath?: string): Promise<Check>
{
    //g++, g++-14, clang++, clang++-18 and so on, in every PATH folder
    const candidates: Candidate[] = [];

    for (const directory of pathDirectories(environment))
    {
        let names: string[] = [];

        try
        {
            names = readdirSync(directory).filter(name => /^(g\+\+|clang\+\+)(-\d+)?$/.test(name));
        }
        catch
        {
            continue;
        }

        for (const name of names)
            candidates.push({ path: path.join(directory, name), source: name.startsWith("g") ? "GCC" : "Clang" });
    }

    const installations = await probeCandidates(candidates, async file => parseCompilerVersion(await runProcess(file, ["--version"]) ?? ""));
    const usable = installations.filter(installation => 0 <= compareVersions(installation.version, minimumVersions[installation.source] ?? "0"));

    const check = toolCheck("Compiler", usable, "", chosenPath, fixes => addInstallFix(fixes, environment,
        {
            brew: "llvm",
            apt: "g++-14",
            dnf: "gcc-c++",
            pacman: "gcc",
            zypper: "gcc14-c++",
            download: "https://gcc.gnu.org/install/"
        }));

    if (0 === usable.length && 0 < installations.length)
        check.result.detail = "needs GCC " + minimumVersions.GCC + " or Clang " + minimumVersions.Clang + " for C++23; found " + installations.map(installation => installation.source + " " + installation.version).join(", ");

    return check;
}

//The version on the first line: "g++ (Ubuntu 14.2.0-4ubuntu2) 14.2.0", "clang version 18.1.3 (...)"
export function parseCompilerVersion(output: string): string
{
    const firstLine = output.split(/\r?\n/)[0] ?? "";
    const clang = /clang version (\d+\.\d+(?:\.\d+)?)/.exec(firstLine);

    if (clang?.[1])
        return clang[1];

    const versions = firstLine.match(/\d+\.\d+(?:\.\d+)?/g);
    return versions?.[versions.length - 1] ?? "";
}
