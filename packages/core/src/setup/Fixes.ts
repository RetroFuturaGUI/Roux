import { existsSync } from "node:fs";
import path from "node:path";
import type { CheckResult, Fix } from "@retrofuturagui/roux-protocol";
import { variable, type MachineEnvironment } from "./Environment.js";

//What a fix runs. The UI only ever sees the Fix, never this
export type FixRun =
    | { kind: "terminal"; commandLine: string; cwd?: string }
    | { kind: "capture"; file: string; args: string[]; cwd?: string }
    | { kind: "environment"; name: string; value: string }
    | { kind: "link"; url: string };

//A check's result and the runs behind its fixes, by fix id
export interface Check
{
    result: CheckResult;
    runs: Map<string, FixRun>;
}

//Collects a check's fixes: what the row shows and what runs on a click
export class FixList
{
    readonly fixes: Fix[] = [];
    readonly runs = new Map<string, FixRun>();

    terminal(label: string, commandLine: string, cwd?: string, after?: string): string
    {
        return this.add({ label: label, command: commandLine, kind: "terminal", after: after }, { kind: "terminal", commandLine: commandLine, cwd: cwd });
    }

    capture(label: string, file: string, args: string[], cwd?: string): string
    {
        return this.add({ label: label, command: commandLine(file, args), kind: "capture" }, { kind: "capture", file: file, args: args, cwd: cwd });
    }

    environment(label: string, name: string, value: string, shownCommand: string, after?: string): string
    {
        return this.add({ label: label, command: shownCommand, kind: "environment", after: after }, { kind: "environment", name: name, value: value });
    }

    link(label: string, url: string): string
    {
        return this.add({ label: label, command: url, kind: "link" }, { kind: "link", url: url });
    }

    check(result: Omit<CheckResult, "fixes">): Check
    {
        return { result: { ...result, fixes: this.fixes }, runs: this.runs };
    }

    private add(fix: Omit<Fix, "id">, run: FixRun): string
    {
        const base = fix.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fix";
        let id = base;

        for (let count = 2; this.runs.has(id); ++count)
            id = base + "-" + count;

        //A fix that waits for none has no after at all, rather than an undefined one
        const { after, ...rest } = fix;
        this.fixes.push({ id: id, ...rest, ...(after ? { after: after } : {}) });
        this.runs.set(id, run);
        return id;
    }
}

//A command as a terminal would take it: arguments with spaces in quotes
export function commandLine(file: string, args: readonly string[]): string
{
    return [file, ...args].map(part => /[\s"]/.test(part) ? "\"" + part.replace(/"/g, "\\\"") + "\"" : part).join(" ");
}

//The packages a component has with each package manager, and its download page for when there is none
export interface PackageNames
{
    winget?: string;
    brew?: string;
    apt?: string;
    dnf?: string;
    pacman?: string;
    zypper?: string;
    download: string;
}

//Adds the official way to install a component: winget on Windows, Homebrew on macOS, the distribution's packages on
//Linux, else its download page. The terminal shows elevation and password prompts, which Roux never answers itself
export function addInstallFix(fixes: FixList, environment: MachineEnvironment, packages: PackageNames, label = "Install"): void
{
    if ("win32" === environment.platform)
    {
        const localAppData = variable(environment, "LOCALAPPDATA");
        const hasWinget = Boolean(localAppData) && existsSync(path.join(localAppData, "Microsoft", "WindowsApps", "winget.exe"));

        if (packages.winget && hasWinget)
        {
            fixes.terminal(label, "winget install " + packages.winget);
            return;
        }
    }
    else if ("darwin" === environment.platform)
    {
        if (packages.brew)
        {
            fixes.terminal(label, "brew install " + packages.brew);
            return;
        }
    }
    else
    {
        const managers: [keyof PackageNames, string, string][] =
        [
            ["apt", "/usr/bin/apt", "sudo apt install "],
            ["dnf", "/usr/bin/dnf", "sudo dnf install "],
            ["pacman", "/usr/bin/pacman", "sudo pacman -S "],
            ["zypper", "/usr/bin/zypper", "sudo zypper install "]
        ];

        for (const [manager, file, command] of managers)
        {
            const name = packages[manager];

            if (name && existsSync(file))
            {
                fixes.terminal(label, command + name);
                return;
            }
        }
    }

    fixes.link("Download", packages.download);
}