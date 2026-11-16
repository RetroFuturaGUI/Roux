#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Core, currentEnvironment, findClang, findProjectFolder, generateProject, makeSchema } from "@retrofuturagui/roux-core";
import { checkPaths } from "./Check.js";
import { ServeHost } from "./ServeHost.js";

const usage = `Usage: roux <command>

Commands:
  serve [--project <folder>] [--port <number>] [--no-open] [--vscode]
                                        Opens Roux in the browser, on this computer only. The project is the
                                        nearest folder up with a Project.bechaml, else with a CMakeLists.txt.
                                        --vscode: for VS Code's Simple Browser instead, until the extension exists
  check [<file or folder>...]           Reports the errors in .bechaml files (in the current folder when none is named)
  generate [--project <folder>]         Writes source/generated/Project.cmake and Roux's regions in CMakeLists.txt
                                        from Project.bechaml (the scenes' C++ comes later)
  schema [--project <folder>] [--build <folder>]
                                        Writes RetroFuturaGUI/Schema.json from the library's headers through Clang, with
                                        the flags of a configured build (the newest under build/ when none is named)
  build                                 Generate, configure and build (not built yet)
  run                                   Build, then start the program (not built yet)`;

async function main(args: string[]): Promise<number>
{
    const [command, ...options] = args;

    switch (command)
    {
        case "serve":
            return serve(options);
        case "check":
            return check(options);
        case "generate":
            return generate(options);
        case "schema":
            return schema(options);
        case "build":
        case "run":
            console.error("roux " + command + " isn't built yet.");
            return 1;
        case undefined:
        case "help":
        case "--help":
            console.log(usage);
            return 0;
        default:
            console.error("Unknown command " + command + ".\n\n" + usage);
            return 1;
    }
}

async function serve(options: string[]): Promise<number>
{
    let port = 0;
    let shouldOpen = true;
    let isForVSCode = false;
    let projectFolder: string | undefined;

    for (let index = 0; options.length > index; ++index)
    {
        const option = options[index];

        if ("--no-open" === option)
        {
            shouldOpen = false;
            continue;
        }

        //Simple Browser is opened from VS Code, so no other browser is
        if ("--vscode" === option)
        {
            isForVSCode = true;
            shouldOpen = false;
            continue;
        }

        if ("--project" === option)
        {
            projectFolder = options[++index];

            if (!projectFolder)
            {
                console.error("--project needs a folder.");
                return 1;
            }

            continue;
        }

        if ("--port" === option)
        {
            port = Number.parseInt(options[++index] ?? "", 10);

            if (!Number.isInteger(port) || 0 > port || 65535 < port)
            {
                console.error("--port needs a number from 0 to 65535.");
                return 1;
            }

            continue;
        }

        console.error("Unknown option " + option + ".\n\n" + usage);
        return 1;
    }

    const folder = await findProjectFolder(projectFolder ?? process.cwd());
    const core = new Core(undefined, { projectFolder: folder });
    const host = new ServeHost(core, { uiDirectory: uiDirectory(), port: port, forVSCode: isForVSCode });
    const url = await host.start();

    console.log("Roux is running at " + url);
    console.log("Project: " + folder);
    console.log("Only this computer can reach it. Ctrl+C stops it.");

    if (isForVSCode)
        console.log("In VS Code: Ctrl+Shift+P (Cmd+Shift+P on macOS), \"Simple Browser: Show\", then paste the address above.");

    if (shouldOpen)
        openInBrowser(url);

    await new Promise<void>(resolve =>
    {
        process.once("SIGINT", () => resolve());
        process.once("SIGTERM", () => resolve());
    });

    await host.stop();
    core.close();
    return 0;
}

async function generate(options: string[]): Promise<number>
{
    let projectFolder: string | undefined;

    for (let index = 0; options.length > index; ++index)
    {
        if ("--project" !== options[index] || !options[index + 1])
        {
            console.error("--project <folder> is the only option.\n\n" + usage);
            return 1;
        }

        projectFolder = options[++index];
    }

    const folder = await findProjectFolder(projectFolder ?? process.cwd());
    const result = await generateProject(folder);
    const relative = (file: string) => path.relative(process.cwd(), file) || file;

    if (!result.hasProject)
    {
        console.error("There's no Project.bechaml in " + folder + ", so there's nothing to generate.");
        return 1;
    }

    for (const problem of result.problems)
        console.log(relative(problem.file) + ":" + problem.line + ":" + problem.column + ": " + problem.severity + ": " + problem.message);

    for (const file of result.written)
        console.log("Wrote " + relative(file) + ".");

    for (const file of result.removed)
        console.log("Removed " + relative(file) + ".");

    const failed = result.problems.some(problem => "error" === problem.severity);

    if (!failed && 0 === result.written.length + result.removed.length)
        console.log("Everything is up to date.");

    return failed ? 1 : 0;
}

async function schema(options: string[]): Promise<number>
{
    let projectFolder: string | undefined;
    let buildFolder: string | undefined;

    for (let index = 0; options.length > index; ++index)
    {
        const option = options[index];
        const value = options[index + 1];

        if (("--project" !== option && "--build" !== option) || !value)
        {
            console.error("schema takes --project <folder> and --build <folder>.\n\n" + usage);
            return 1;
        }

        if ("--project" === option)
            projectFolder = value;
        else
            buildFolder = value;

        ++index;
    }

    const folder = await findProjectFolder(projectFolder ?? process.cwd());
    const compileCommandsFile = buildFolder ? path.join(path.resolve(buildFolder), "compile_commands.json") : await newestCompileCommands(path.join(folder, "build"));

    if (!compileCommandsFile)
    {
        console.error("No configured build under " + path.join(folder, "build") + ": configure one first, or name it with --build.");
        return 1;
    }

    const clang = (await findClang(currentEnvironment())).result;
    const chosen = clang.installations[clang.chosenIndex];

    if (!chosen)
    {
        console.error("Clang wasn't found: install LLVM (winget install LLVM.LLVM).");
        return 1;
    }

    const result = await makeSchema({ libraryFolder: path.join(folder, "RetroFuturaGUI"), compileCommandsFile: compileCommandsFile, clang: chosen.path });

    if (result.error)
    {
        console.error(result.error);
        return 1;
    }

    for (const problem of result.problems)
        console.log("warning: " + problem);

    const relative = path.relative(process.cwd(), result.file) || result.file;
    console.log((result.isWritten ? "Wrote " : "Up to date: ") + relative + " (" + result.classCount + " classes, " + result.enumCount + " enums), with Clang " + chosen.version + " and " + path.relative(process.cwd(), compileCommandsFile) + ".");
    return 0;
}

//The compile_commands.json of the most recently configured build folder
async function newestCompileCommands(buildRoot: string): Promise<string | undefined>
{
    let newest: { file: string; time: number } | undefined;

    for (const entry of await readdir(buildRoot, { withFileTypes: true }).catch(() => []))
    {
        const file = path.join(buildRoot, entry.name, "compile_commands.json");
        const time = (await stat(file).catch(() => undefined))?.mtimeMs;

        if (entry.isDirectory() && undefined !== time && (!newest || newest.time < time))
            newest = { file: file, time: time };
    }

    return newest?.file;
}

async function check(paths: string[]): Promise<number>
{
    const report = await checkPaths(0 === paths.length ? ["."] : paths, process.cwd());

    for (const line of report.lines)
        console.log(line);

    const files = 1 === report.fileCount ? "1 file" : report.fileCount + " files";
    const errors = 0 === report.errorCount ? "no errors" : 1 === report.errorCount ? "1 error" : report.errorCount + " errors";
    console.log("Checked " + files + ": " + errors + ".");

    return 0 === report.errorCount ? 0 : 1;
}

//The UI's files, wherever npm put the package
function uiDirectory(): string
{
    const require = createRequire(import.meta.url);
    return path.join(path.dirname(require.resolve("@retrofuturagui/roux-ui/package.json")), "src");
}

function openInBrowser(url: string): void
{
    //start's first quoted argument is the window title, so an empty one comes before the address
    const [command, args]: [string, string[]] =
        "win32" === process.platform ? ["cmd", ["/c", "start", "", url]]
        : "darwin" === process.platform ? ["open", [url]]
        : ["xdg-open", [url]];

    const opener = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    opener.on("error", () => console.log("Couldn't open a browser; open the address above yourself."));
    opener.unref();
}

process.exitCode = await main(process.argv.slice(2));
