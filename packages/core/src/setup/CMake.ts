import path from "node:path";
import type { Installation } from "@retrofuturagui/roux-protocol";
import { variable, type MachineEnvironment } from "./Environment.js";
import { addInstallFix, FixList, type Check } from "./Fixes.js";
import { runProcess } from "./Process.js";
import { chosenIndexOf, probeCandidates, subdirectories, withPathCandidates, type Candidate } from "./Tool.js";
import { compareVersions } from "./Version.js";
import { visualStudioInstallations } from "./VisualStudio.js";

//Finds every CMake on this computer and runs each for its version
export async function findCMake(environment: MachineEnvironment, requiredVersion = "", chosenPath?: string): Promise<Check>
{
    const installations = await probeCandidates(await cmakeCandidates(environment), readCMakeVersion);
    return cmakeCheckResult(installations, environment, requiredVersion, chosenPath);
}

//The places a CMake is installed to, then the PATH's folders, keeping only files that exist
export async function cmakeCandidates(environment: MachineEnvironment): Promise<Candidate[]>
{
    const isWindows = "win32" === environment.platform;
    return withPathCandidates(environment, [isWindows ? "cmake.exe" : "cmake"], isWindows ? await windowsCandidates(environment) : unixCandidates(environment));
}

export async function readCMakeVersion(file: string): Promise<string>
{
    return parseCMakeVersion(await runProcess(file, ["--version"]) ?? "");
}

//Reads "cmake version 3.31.2" (or "cmake3 version ...", as some distributions name it). "" when there is none
export function parseCMakeVersion(output: string): string
{
    const match = /cmake3?\s+version\s+(\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?)/i.exec(output);
    return match?.[1] ?? "";
}

export function cmakeCheckResult(installations: Installation[], environment: MachineEnvironment, requiredVersion: string, chosenPath?: string): Check
{
    return toolCheck("CMake", installations, requiredVersion, chosenPath, fixes => addInstallFix(fixes, environment,
        {
            winget: "Kitware.CMake",
            brew: "cmake",
            apt: "cmake",
            dnf: "cmake",
            pacman: "cmake",
            zypper: "cmake",
            download: "https://cmake.org/download/"
        }));
}

//Picks one of the installations, newest first: the one chosen in Machine.bechaml while it's there and new enough, else
//the newest that meets requiredVersion. A choice that's gone is a warning, not an error, since another one takes over.
//addFixes is only asked for fixes when nothing usable is found
export function toolCheck(component: string, installations: Installation[], requiredVersion: string, chosenPath: string | undefined, addFixes: (fixes: FixList) => void): Check
{
    const fixes = new FixList();
    const sorted = [...installations].sort((left, right) => compareVersions(right.version, left.version));
    const meets = (installation: Installation | undefined) => !requiredVersion || (installation && 0 <= compareVersions(installation.version, requiredVersion));
    const need = requiredVersion ? "needs " + requiredVersion + " or newer" : "";

    if (0 === sorted.length)
    {
        addFixes(fixes);
        return fixes.check({ component: component, status: "error", detail: "not found", installations: [], chosenIndex: -1 });
    }

    const chosen = chosenIndexOf(sorted, chosenPath);

    if (0 <= chosen)
    {
        if (meets(sorted[chosen]))
            return fixes.check({ component: component, status: "ok", detail: join(need, "chosen for this computer"), installations: sorted, chosenIndex: chosen });

        return fixes.check({ component: component, status: "error", detail: "the chosen " + (sorted[chosen]?.version ?? "") + " is older than " + requiredVersion, installations: sorted, chosenIndex: chosen });
    }

    const fallback = sorted.findIndex(installation => meets(installation));

    if (0 > fallback)
    {
        addFixes(fixes);
        return fixes.check({ component: component, status: "error", detail: "every installation is older than " + requiredVersion, installations: sorted, chosenIndex: 0 });
    }

    const gone = chosenPath ? "the chosen " + chosenPath + " is gone" : "";
    return fixes.check({ component: component, status: gone ? "warning" : "ok", detail: join(gone, need), installations: sorted, chosenIndex: fallback });
}

function join(...parts: string[]): string
{
    return parts.filter(part => "" !== part).join("; ");
}

async function windowsCandidates(environment: MachineEnvironment): Promise<Candidate[]>
{
    const candidates: Candidate[] = [];
    const programFiles = variable(environment, "ProgramFiles");
    const programFilesX86 = variable(environment, "ProgramFiles(x86)");
    const localAppData = variable(environment, "LOCALAPPDATA");
    const vcpkgRoot = variable(environment, "VCPKG_ROOT");

    if (programFiles)
        candidates.push({ path: path.join(programFiles, "CMake", "bin", "cmake.exe"), source: "Program Files" });

    if (programFilesX86)
        candidates.push({ path: path.join(programFilesX86, "CMake", "bin", "cmake.exe"), source: "Program Files (x86)" });

    for (const studio of await visualStudioInstallations(environment))
    {
        const bundled = path.join(studio.installationPath, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin", "cmake.exe");
        candidates.push({ path: bundled, source: studio.displayName + " (bundled)" });
    }

    const scoop = variable(environment, "SCOOP") || path.join(environment.homeDirectory, "scoop");
    candidates.push({ path: path.join(scoop, "apps", "cmake", "current", "bin", "cmake.exe"), source: "Scoop" });

    const chocolatey = variable(environment, "ChocolateyInstall") || "C:\\ProgramData\\chocolatey";
    candidates.push({ path: path.join(chocolatey, "bin", "cmake.exe"), source: "Chocolatey" });

    for (const environmentName of ["ucrt64", "mingw64", "clang64"])
        candidates.push({ path: path.join("C:\\msys64", environmentName, "bin", "cmake.exe"), source: "MSYS2 " + environmentName.toUpperCase() });

    //vcpkg downloads its own CMake into downloads\tools\cmake-<version>-windows\<one more folder>\bin.
    if (vcpkgRoot)
    {
        for (const toolFolder of subdirectories(path.join(vcpkgRoot, "downloads", "tools"), "cmake-"))
        {
            candidates.push({ path: path.join(toolFolder, "bin", "cmake.exe"), source: "vcpkg (downloaded)" });

            for (const innerFolder of subdirectories(toolFolder, "cmake-"))
                candidates.push({ path: path.join(innerFolder, "bin", "cmake.exe"), source: "vcpkg (downloaded)" });
        }
    }

    //CLion bundles CMake, installed either into Program Files or by the JetBrains Toolbox.
    for (const root of [programFiles ? path.join(programFiles, "JetBrains") : "", localAppData ? path.join(localAppData, "Programs") : ""])
    {
        for (const clion of subdirectories(root, "CLion"))
        {
            const source = path.basename(clion) + " (bundled)";
            candidates.push({ path: path.join(clion, "bin", "cmake", "win", "x64", "bin", "cmake.exe"), source: source });
            candidates.push({ path: path.join(clion, "bin", "cmake", "win", "bin", "cmake.exe"), source: source });
        }
    }

    return candidates;
}

function unixCandidates(environment: MachineEnvironment): Candidate[]
{
    const candidates: Candidate[] =
    [
        { path: "/usr/bin/cmake", source: "System packages" },
        { path: "/usr/local/bin/cmake", source: "/usr/local" },
        { path: "/snap/bin/cmake", source: "Snap" },
        { path: path.join(environment.homeDirectory, ".local", "bin", "cmake"), source: "~/.local" },
        { path: "/home/linuxbrew/.linuxbrew/bin/cmake", source: "Homebrew" },
        { path: "/opt/homebrew/bin/cmake", source: "Homebrew" },
        { path: "/Applications/CMake.app/Contents/bin/cmake", source: "CMake.app" }
    ];

    //Kitware's installer and tarball are often unpacked into /opt/cmake-<version>.
    for (const folder of subdirectories("/opt", "cmake"))
        candidates.push({ path: path.join(folder, "bin", "cmake"), source: folder });

    return candidates;
}