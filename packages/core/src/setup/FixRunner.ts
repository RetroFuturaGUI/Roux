import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import type { MachineEnvironment } from "./Environment.js";
import { pathDirectories } from "./Environment.js";

export interface FixOutcome
{
    isDone: boolean;
    output: string;
}

//Runs fixes. Tests pass their own, so nothing is installed while testing
export interface FixRunner
{
    //Opens a terminal window running the command and resolves once that window is closed
    terminal(commandLine: string, cwd: string | undefined, title: string): Promise<FixOutcome>;
    capture(file: string, args: readonly string[], cwd: string | undefined): Promise<FixOutcome>;
    //Sets a user environment variable for good, and for Roux's own processes at once
    setEnvironment(name: string, value: string): Promise<FixOutcome>;
}

const closeNote = "Roux checks again once this window is closed.";

export function systemFixRunner(environment: MachineEnvironment): FixRunner
{
    return {
        terminal: (commandLine, cwd, title) => openTerminal(environment, commandLine, cwd, title),
        capture: (file, args, cwd) => capture(file, args, cwd),
        setEnvironment: (name, value) => setEnvironment(environment, name, value)
    };
}

function openTerminal(environment: MachineEnvironment, commandLine: string, cwd: string | undefined, title: string): Promise<FixOutcome>
{
    if ("win32" === environment.platform)
    {
        //start's first quoted argument is the window's title; /wait waits for the new window's cmd to end, which pause
        //holds open until a key is pressed. /s keeps the quotes inside the command as they are
        const inner = commandLine + " & echo. & echo " + closeNote + " & pause";
        const line = "start \"" + title.replace(/"/g, "'") + "\" /wait cmd.exe /d /s /c \"" + inner + "\"";
        return waitFor(spawn("cmd.exe", ["/d", "/s", "/c", "\"" + line + "\""], { cwd: cwd, stdio: "ignore", windowsVerbatimArguments: true }), "The terminal window couldn't be opened.");
    }

    const script = commandLine + "; printf '\\n" + closeNote + " Press Enter to close it.'; read _";

    if ("darwin" === environment.platform)
    {
        //Terminal.app gives no way to wait for the window, so Search again is up to the user there
        const shell = (cwd ? "cd '" + cwd.replace(/'/g, "'\\''") + "'; " : "") + script;
        const appleScript = "tell application \"Terminal\" to do script \"" + shell.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
        return waitFor(spawn("osascript", ["-e", appleScript], { stdio: "ignore" }), "Terminal couldn't be opened.");
    }

    //The first terminal found, with the flags that keep it in the foreground until its window closes
    const terminals: [string, string[]][] =
    [
        ["gnome-terminal", ["--wait", "--"]],
        ["konsole", ["--nofork", "-e"]],
        ["xfce4-terminal", ["--disable-server", "-x"]],
        ["x-terminal-emulator", ["-e"]],
        ["xterm", ["-e"]]
    ];

    for (const [name, flags] of terminals)
    {
        const file = pathDirectories(environment).map(directory => path.join(directory, name)).find(candidate => existsSync(candidate));

        if (file)
            return waitFor(spawn(file, [...flags, "sh", "-c", script], { cwd: cwd, stdio: "ignore" }), name + " couldn't be started.");
    }

    return Promise.resolve({ isDone: false, output: "No terminal was found (gnome-terminal, konsole, xfce4-terminal, xterm). Run the command yourself, then Search again." });
}

function waitFor(child: ReturnType<typeof spawn>, failure: string): Promise<FixOutcome>
{
    return new Promise(resolve =>
    {
        child.on("error", () => resolve({ isDone: false, output: failure }));
        child.on("exit", () => resolve({ isDone: true, output: "" }));
    });
}

//Runs a command quietly and gives back what it printed, both streams, for at most ten minutes
function capture(file: string, args: readonly string[], cwd: string | undefined): Promise<FixOutcome>
{
    return new Promise(resolve =>
    {
        let output = "";
        let child: ChildProcessWithoutNullStreams;

        //A file that isn't a program makes spawn throw rather than fail. stdin is closed at once, so a command that asks
        //something gets no answer and goes on instead of waiting for one
        try
        {
            child = spawn(file, args, { cwd: cwd, windowsHide: true, timeout: 600000 });
            child.stdin.end();
        }
        catch (error)
        {
            resolve({ isDone: false, output: error instanceof Error ? error.message : String(error) });
            return;
        }

        child.stdout.setEncoding("utf8").on("data", text => { output += text; });
        child.stderr.setEncoding("utf8").on("data", text => { output += text; });
        child.on("error", error => resolve({ isDone: false, output: output + error.message }));
        child.on("close", code => resolve({ isDone: 0 === code, output: output }));
    });
}

async function setEnvironment(environment: MachineEnvironment, name: string, value: string): Promise<FixOutcome>
{
    let outcome: FixOutcome;

    if ("win32" === environment.platform)
    {
        //setx writes HKCU\Environment, the user's own variables; no elevation is needed
        outcome = await capture("setx", [name, value], undefined);
    }
    else
    {
        try
        {
            await appendFile(path.join(environment.homeDirectory, ".profile"), "\nexport " + name + "=\"" + value.replace(/"/g, "\\\"") + "\"\n");
            outcome = { isDone: true, output: "" };
        }
        catch (error)
        {
            outcome = { isDone: false, output: error instanceof Error ? error.message : String(error) };
        }
    }

    if (outcome.isDone)
    {
        environment.variables[name] = value;
        outcome.output = name + " is set. Roux uses it at once; other programs, the IDE among them, see it after they are restarted.";
    }

    return outcome;
}