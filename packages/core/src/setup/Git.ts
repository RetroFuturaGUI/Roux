import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { toolCheck } from "./CMake.js";
import { variable, type MachineEnvironment } from "./Environment.js";
import { addInstallFix, commandLine, FixList, type Check } from "./Fixes.js";
import { runProcess } from "./Process.js";
import { probeCandidates, withPathCandidates, type Candidate } from "./Tool.js";
import { visualStudioInstallations } from "./VisualStudio.js";

//What a RetroFuturaGUI project needs checked out, relative to the project's folder
export const requiredSubmodules = ["RetroFuturaGUI", "RetroFuturaGUI/PlatformBridge"];
export const retroFuturaGuiUrl = "https://github.com/RetroFuturaGUI/RetroFuturaGUI";

export async function findGit(environment: MachineEnvironment, chosenPath?: string): Promise<Check>
{
    const isWindows = "win32" === environment.platform;
    const candidates = isWindows ? await windowsCandidates(environment) : ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"].map(file => ({ path: file, source: path.dirname(file) }));
    const installations = await probeCandidates(withPathCandidates(environment, [isWindows ? "git.exe" : "git"], candidates), async file => parseGitVersion(await runProcess(file, ["--version"]) ?? ""));

    return toolCheck("Git", installations, "", chosenPath, fixes => addInstallFix(fixes, environment,
        {
            winget: "Git.Git",
            brew: "git",
            apt: "git",
            dnf: "git",
            pacman: "git",
            zypper: "git",
            download: "https://git-scm.com/downloads"
        }));
}

//"git version 2.47.1.windows.1" is 2.47.1
export function parseGitVersion(output: string): string
{
    return /git version (\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? "";
}

async function windowsCandidates(environment: MachineEnvironment): Promise<Candidate[]>
{
    const candidates: Candidate[] = [];
    const programFiles = variable(environment, "ProgramFiles");
    const localAppData = variable(environment, "LOCALAPPDATA");

    if (programFiles)
        candidates.push({ path: path.join(programFiles, "Git", "cmd", "git.exe"), source: "Program Files" });

    if (localAppData)
        candidates.push({ path: path.join(localAppData, "Programs", "Git", "cmd", "git.exe"), source: "installed for this user" });

    for (const studio of await visualStudioInstallations(environment))
        candidates.push({ path: path.join(studio.installationPath, "Common7", "IDE", "CommonExtensions", "Microsoft", "TeamFoundation", "Team Explorer", "Git", "cmd", "git.exe"), source: studio.displayName + " (bundled)" });

    const scoop = variable(environment, "SCOOP") || path.join(environment.homeDirectory, "scoop");
    candidates.push({ path: path.join(scoop, "apps", "git", "current", "cmd", "git.exe"), source: "Scoop" });
    return candidates;
}

export type SubmoduleState = "ok" | "uninitialized" | "otherCommit" | "conflict";

//Reads git submodule status: a space before the commit is ok, - not initialized, + checked out at another commit than
//the parent records, U a merge conflict
export function parseSubmoduleStatus(output: string): Map<string, SubmoduleState>
{
    const states = new Map<string, SubmoduleState>();
    const marks: Record<string, SubmoduleState> = { " ": "ok", "-": "uninitialized", "+": "otherCommit", "U": "conflict" };

    for (const line of output.split(/\r?\n/))
    {
        const match = /^([ +\-U])[0-9a-f]+ (\S+)/.exec(line);

        if (match?.[1] && match[2])
            states.set(match[2], marks[match[1]] ?? "ok");
    }

    return states;
}

export async function checkSubmodules(git: string | undefined, folder: string | undefined): Promise<Check>
{
    const fixes = new FixList();
    const component = "Submodules";
    const names = requiredSubmodules.map(submodule => path.basename(submodule)).join(", ");

    if (!folder)
        return fixes.check({ component: component, status: "skipped", detail: "no project", installations: [], chosenIndex: -1 });

    if (!existsSync(path.join(folder, ".git")))
    {
        const missing = requiredSubmodules.filter(submodule => !hasFiles(path.join(folder, submodule)));

        if (0 === missing.length)
            return fixes.check({ component: component, status: "ok", detail: names + " (the project isn't a Git repository)", installations: [], chosenIndex: -1 });

        if (!git)
            return fixes.check({ component: component, status: "error", detail: missing.join(", ") + " missing; Git is needed to fetch them", installations: [], chosenIndex: -1 });

        fixes.terminal("Set up", addRetroFuturaGuiCommand(git, false), folder);
        return fixes.check({ component: component, status: "error", detail: missing.join(", ") + " missing; Set up makes the project a Git repository and adds them", installations: [], chosenIndex: -1 });
    }

    if (!git)
        return fixes.check({ component: component, status: "skipped", detail: "needs Git", installations: [], chosenIndex: -1 });

    const output = await runProcess(git, ["-C", folder, "submodule", "status", "--recursive"], 30000);

    if (undefined === output)
        return fixes.check({ component: component, status: "error", detail: "git submodule status failed", installations: [], chosenIndex: -1 });

    return submoduleCheck(parseSubmoduleStatus(output), git, folder, fixes);
}

export function submoduleCheck(states: Map<string, SubmoduleState>, git: string, folder: string, fixes: FixList): Check
{
    const component = "Submodules";

    //Not a submodule of the project at all, as in a new one: added with PlatformBridge inside it
    if (!states.has(requiredSubmodules[0]) && !hasFiles(path.join(folder, requiredSubmodules[0])))
    {
        fixes.terminal("Add RetroFuturaGUI", addRetroFuturaGuiCommand(git, true), folder);
        return fixes.check({ component: component, status: "error", detail: "RetroFuturaGUI isn't part of the project yet", installations: [], chosenIndex: -1 });
    }

    const stateOf = (submodule: string) => states.get(submodule) ?? (hasFiles(path.join(folder, submodule)) ? "ok" : "uninitialized");
    const uninitialized = requiredSubmodules.filter(submodule => "uninitialized" === stateOf(submodule));
    const conflicts = requiredSubmodules.filter(submodule => "conflict" === stateOf(submodule));
    const otherCommits = requiredSubmodules.filter(submodule => "otherCommit" === stateOf(submodule));

    if (0 < conflicts.length)
        return fixes.check({ component: component, status: "error", detail: conflicts.join(", ") + " has a merge conflict", installations: [], chosenIndex: -1 });

    if (0 < uninitialized.length)
    {
        fixes.terminal("Fetch", commandLine(git, ["submodule", "update", "--init", "--recursive"]), folder);
        return fixes.check({ component: component, status: "error", detail: uninitialized.join(", ") + " not checked out", installations: [], chosenIndex: -1 });
    }

    const note = 0 < otherCommits.length ? "; " + otherCommits.map(submodule => path.basename(submodule)).join(", ") + " at another commit than the project records, as while working on it" : "";

    //Only offered at the recorded commits: while working on RetroFuturaGUI, an update would leave its branch for the remote's commit
    if (0 === otherCommits.length)
        fixes.terminal("Update", updateRetroFuturaGuiCommand(git), folder);

    return fixes.check({ component: component, status: "ok", detail: requiredSubmodules.map(submodule => path.basename(submodule)).join(", ") + note, installations: [], chosenIndex: -1 });
}

//Adds RetroFuturaGUI as a submodule and checks out PlatformBridge inside it; a folder that isn't a repository becomes one first
function addRetroFuturaGuiCommand(git: string, isRepository: boolean): string
{
    const add = [commandLine(git, ["submodule", "add", retroFuturaGuiUrl, requiredSubmodules[0]]), commandLine(git, ["submodule", "update", "--init", "--recursive"])];
    return (isRepository ? add : [commandLine(git, ["init"]), ...add]).join(" && ");
}

//Moves RetroFuturaGUI to the newest commit of its remote, then its own submodules to the commits that commit records, so
//PlatformBridge always matches the RetroFuturaGUI it came with. The project then records the new commit once it's committed
function updateRetroFuturaGuiCommand(git: string): string
{
    return [commandLine(git, ["submodule", "update", "--init", "--remote", requiredSubmodules[0]]),
            commandLine(git, ["-C", requiredSubmodules[0], "submodule", "update", "--init", "--recursive"])].join(" && ");
}

function hasFiles(folder: string): boolean
{
    try
    {
        return 0 < readdirSync(folder).length;
    }
    catch
    {
        return false;
    }
}