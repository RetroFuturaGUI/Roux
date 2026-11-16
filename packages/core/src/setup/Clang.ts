import path from "node:path";
import { toolCheck } from "./CMake.js";
import { variable, type MachineEnvironment } from "./Environment.js";
import { addInstallFix, type Check } from "./Fixes.js";
import { runProcess } from "./Process.js";
import { probeCandidates, withPathCandidates, type Candidate } from "./Tool.js";

//Clang reads RetroFuturaGUI's headers for roux schema (Roux plan, 2.5). Only the library's developers need it, since
//Schema.json is committed with the library, so a missing Clang is a warning, never an error.
export async function findClang(environment: MachineEnvironment, chosenPath?: string): Promise<Check>
{
    const isWindows = "win32" === environment.platform;
    //clang-cl takes the MSVC flags a Windows build folder's compile_commands.json holds.
    const executables = isWindows ? ["clang-cl.exe"] : ["clang"];
    const candidates = isWindows ? windowsCandidates(environment) : ["/usr/bin/clang", "/usr/local/bin/clang", "/opt/homebrew/opt/llvm/bin/clang"].map(file => ({ path: file, source: path.dirname(file) }));
    const installations = await probeCandidates(withPathCandidates(environment, executables, candidates), async file => parseClangVersion(await runProcess(file, ["--version"]) ?? ""));

    const check = toolCheck("Clang", installations, "", chosenPath, fixes => addInstallFix(fixes, environment,
        {
            winget: "LLVM.LLVM",
            brew: "llvm",
            apt: "clang",
            dnf: "clang",
            pacman: "clang",
            zypper: "clang",
            download: "https://github.com/llvm/llvm-project/releases"
        }));

    if (0 === check.result.installations.length)
        check.result = { ...check.result, status: "warning", detail: "not found: only needed to make RetroFuturaGUI's Schema.json (roux schema)" };

    return check;
}

//"clang version 23.1.5 (https://github.com/llvm/llvm-project ...)", or "Apple clang version 17.0.0 (...)".
export function parseClangVersion(output: string): string
{
    return /clang version (\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? "";
}

function windowsCandidates(environment: MachineEnvironment): Candidate[]
{
    const candidates: Candidate[] = [];

    //The LLVM installer, winget's LLVM.LLVM among them, and the copy Visual Studio's "C++ Clang tools" component adds.
    for (const programFiles of [variable(environment, "ProgramFiles") || "C:\\Program Files", variable(environment, "ProgramFiles(x86)")])
    {
        if (programFiles)
            candidates.push({ path: path.join(programFiles, "LLVM", "bin", "clang-cl.exe"), source: "LLVM" });
    }

    return candidates;
}
