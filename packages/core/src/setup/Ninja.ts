import path from "node:path";
import { toolCheck } from "./CMake.js";
import { variable, type MachineEnvironment } from "./Environment.js";
import { addInstallFix, type Check } from "./Fixes.js";
import { runProcess } from "./Process.js";
import { probeCandidates, subdirectories, withPathCandidates, type Candidate } from "./Tool.js";
import { visualStudioInstallations } from "./VisualStudio.js";

//Ninja is the generator Roux configures with, on every platform
export async function findNinja(environment: MachineEnvironment, chosenPath?: string): Promise<Check>
{
    const isWindows = "win32" === environment.platform;
    const candidates = isWindows ? await windowsCandidates(environment) : ["/usr/bin/ninja", "/usr/bin/ninja-build", "/usr/local/bin/ninja", "/opt/homebrew/bin/ninja"].map(file => ({ path: file, source: path.dirname(file) }));
    const executables = isWindows ? ["ninja.exe"] : ["ninja", "ninja-build"];
    const installations = await probeCandidates(withPathCandidates(environment, executables, candidates), async file => parseNinjaVersion(await runProcess(file, ["--version"]) ?? ""));

    return toolCheck("Ninja", installations, "", chosenPath, fixes => addInstallFix(fixes, environment,
        {
            winget: "Ninja-build.Ninja",
            brew: "ninja",
            apt: "ninja-build",
            dnf: "ninja-build",
            pacman: "ninja",
            zypper: "ninja",
            download: "https://github.com/ninja-build/ninja/releases"
        }));
}

//ninja --version prints only the version: "1.12.1".
export function parseNinjaVersion(output: string): string
{
    return /^\s*(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? "";
}

async function windowsCandidates(environment: MachineEnvironment): Promise<Candidate[]>
{
    const candidates: Candidate[] = [];
    const localAppData = variable(environment, "LOCALAPPDATA");
    const vcpkgRoot = variable(environment, "VCPKG_ROOT");

    for (const studio of await visualStudioInstallations(environment))
        candidates.push({ path: path.join(studio.installationPath, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "Ninja", "ninja.exe"), source: studio.displayName + " (bundled)" });

    if (localAppData)
        candidates.push({ path: path.join(localAppData, "Microsoft", "WinGet", "Links", "ninja.exe"), source: "winget" });

    const scoop = variable(environment, "SCOOP") || path.join(environment.homeDirectory, "scoop");
    candidates.push({ path: path.join(scoop, "shims", "ninja.exe"), source: "Scoop" });

    const chocolatey = variable(environment, "ChocolateyInstall") || "C:\\ProgramData\\chocolatey";
    candidates.push({ path: path.join(chocolatey, "bin", "ninja.exe"), source: "Chocolatey" });

    //vcpkg downloads its own Ninja into downloads\tools\ninja-<version>-windows
    if (vcpkgRoot)
    {
        for (const folder of subdirectories(path.join(vcpkgRoot, "downloads", "tools"), "ninja"))
            candidates.push({ path: path.join(folder, "ninja.exe"), source: "vcpkg (downloaded)" });
    }

    return candidates;
}