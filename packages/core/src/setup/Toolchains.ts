import path from "node:path";
import type { Installation, PlatformSettings } from "@retrofuturagui/roux-protocol";
import { toolCheck } from "./CMake.js";
import { variable, type MachineEnvironment } from "./Environment.js";
import { addInstallFix, FixList, type Check } from "./Fixes.js";
import { runProcess } from "./Process.js";
import { withPathCandidates } from "./Tool.js";
import { compareVersions } from "./Version.js";

const component = "Language toolchain";

//The .NET SDK that brings each C# version as its default
const dotnetForCSharp: Record<string, string> = { "7.3": "2", "8": "3", "9": "5", "10": "6", "11": "7", "12": "8", "13": "9" };

//The oldest Rust that knows each edition.
const rustForEdition: Record<string, string> = { "2015": "1.0", "2018": "1.31", "2021": "1.56", "2024": "1.85" };

//Only what the project's own language needs on this computer's platform: C and C++ need nothing beyond the compiler
export async function checkToolchain(environment: MachineEnvironment, settings: PlatformSettings | undefined): Promise<Check>
{
    if (!settings)
        return new FixList().check({ component: component, status: "skipped", detail: "the project sets no language for this computer's platform", installations: [], chosenIndex: -1 });

    switch (settings.language)
    {
        case "C#":
            return dotnetCheck(environment, await dotnetSdks(environment), settings.standard);
        case "Python":
            return pythonCheck(environment, await pythons(environment), settings.standard);
        case "Rust":
            return rustCheck(environment, await cargos(environment), settings.standard);
        default:
            return new FixList().check({ component: component, status: "skipped", detail: "not needed for " + settings.language, installations: [], chosenIndex: -1 });
    }
}

async function dotnetSdks(environment: MachineEnvironment): Promise<Installation[]>
{
    const isWindows = "win32" === environment.platform;
    const programFiles = variable(environment, "ProgramFiles");
    const candidates = withPathCandidates(environment, [isWindows ? "dotnet.exe" : "dotnet"], programFiles ? [{ path: path.join(programFiles, "dotnet", "dotnet.exe"), source: "Program Files" }] : []);
    const first = candidates[0];
    return first ? parseDotnetSdks(await runProcess(first.path, ["--list-sdks"]) ?? "") : [];
}

//"9.0.100 [C:\Program Files\dotnet\sdk]", one line per SDK
export function parseDotnetSdks(output: string): Installation[]
{
    const sdks: Installation[] = [];

    for (const line of output.split(/\r?\n/))
    {
        const match = /^(\d+\.\d+\.\d+\S*)\s+\[(.+)\]\s*$/.exec(line.trim());

        if (match?.[1] && match[2])
            sdks.push({ version: match[1], path: path.join(match[2], match[1]), source: ".NET SDK", isOnPath: false });
    }

    return sdks;
}

export function dotnetCheck(environment: MachineEnvironment, sdks: Installation[], csharp: string): Check
{
    const major = dotnetForCSharp[csharp] ?? "9";

    return toolCheck(component, sdks, major, undefined, fixes => addInstallFix(fixes, environment,
        {
            winget: "Microsoft.DotNet.SDK." + major,
            brew: "dotnet",
            apt: "dotnet-sdk-" + major + ".0",
            dnf: "dotnet-sdk-" + major + ".0",
            download: "https://dotnet.microsoft.com/download"
        }, "Install .NET " + major + " SDK"));
}

async function pythons(environment: MachineEnvironment): Promise<Installation[]>
{
    const found: Installation[] = [];

    //The py launcher lists every Python on Windows: " -V:3.14 *        C:\...\python.exe".
    if ("win32" === environment.platform)
        found.push(...parsePyLauncher(await runProcess("py", ["-0p"]) ?? ""));

    for (const candidate of withPathCandidates(environment, "win32" === environment.platform ? ["python.exe"] : ["python3", "python"], []))
    {
        const version = /Python (\d+\.\d+\.\d+)/.exec(await runProcess(candidate.path, ["--version"]) ?? "")?.[1];

        if (version && !found.some(entry => entry.path.toLowerCase() === candidate.path.toLowerCase()))
            found.push({ version: version, path: candidate.path, source: "PATH", isOnPath: true });
    }

    return found;
}

export function parsePyLauncher(output: string): Installation[]
{
    const found: Installation[] = [];

    for (const line of output.split(/\r?\n/))
    {
        const match = /^\s*-(?:V:)?(\d+\.\d+)\S*\s+\*?\s*(\S.*\.exe)\s*$/i.exec(line);

        if (match?.[1] && match[2])
            found.push({ version: match[1], path: match[2], source: "py launcher", isOnPath: false });
    }

    return found;
}

//A binding is built for one Python version, so the minor version has to match
export function pythonCheck(environment: MachineEnvironment, found: Installation[], version: string): Check
{
    const matching = found.filter(entry => entry.version === version || entry.version.startsWith(version + "."));

    return toolCheck(component, matching, "", undefined, fixes => addInstallFix(fixes, environment,
        {
            winget: "Python.Python." + version,
            brew: "python@" + version,
            apt: "python" + version,
            dnf: "python" + version,
            download: "https://www.python.org/downloads/"
        }, "Install Python " + version));
}

async function cargos(environment: MachineEnvironment): Promise<Installation[]>
{
    const cargoHome = variable(environment, "CARGO_HOME") || path.join(environment.homeDirectory, ".cargo");
    const executable = "win32" === environment.platform ? "cargo.exe" : "cargo";
    const candidates = withPathCandidates(environment, [executable], [{ path: path.join(cargoHome, "bin", executable), source: "rustup" }]);
    const found: Installation[] = [];

    for (const candidate of candidates)
    {
        const version = /cargo (\d+\.\d+\.\d+)/.exec(await runProcess(candidate.path, ["--version"]) ?? "")?.[1];

        if (version && !found.some(entry => entry.version === version))
            found.push({ version: version, path: candidate.path, source: candidate.source, isOnPath: "PATH" === candidate.source });
    }

    return found;
}

export function rustCheck(environment: MachineEnvironment, found: Installation[], edition: string): Check
{
    const minimum = rustForEdition[edition] ?? "1.85";
    const fixes = (list: FixList) => "win32" === environment.platform ? list.terminal("Install rustup", "winget install Rustlang.Rustup") : list.link("Download", "https://rustup.rs");
    const check = toolCheck(component, found.sort((left, right) => compareVersions(right.version, left.version)), minimum, undefined, list => { fixes(list); });

    if ("error" === check.result.status && 0 < found.length)
        check.result.detail = "edition " + edition + " needs Rust " + minimum + " or newer (rustup update)";

    return check;
}