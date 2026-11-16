import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { BuildState, BuildStep, BuildTarget, Events, LogLine, ProjectValues, StepStatus } from "@retrofuturagui/roux-protocol";
import { generateNeed, generateProject } from "../generate/Generator.js";
import { hostPlatform } from "../project/Catalog.js";
import type { MachineEnvironment } from "../setup/Environment.js";
import { commandLine } from "../setup/Fixes.js";
import type { SetupChecks, SetupContext } from "../setup/SetupChecks.js";
import { hostTriplet } from "../setup/Vcpkg.js";
import { findExecutable, writeCodeModelQuery } from "./CMakeFileApi.js";
import { problemSummary, readLogLine } from "./LogLines.js";
import { buildTypes, readBuildTarget, writeBuildTarget } from "./ProjectUserFile.js";
import { configuredCompiler, isSameCompiler, visualStudioEnvironment, withVariable, type Toolset } from "./Toolset.js";

export const buildSteps: BuildStep[] = ["generate", "configure", "build", "run"];

//What a build needs from the rest of the core, read again for every request
export interface BuildContext
{
    folder: string | undefined;
    values: ProjectValues | undefined;
    setup: SetupContext;
}

interface StepCounts
{
    errors: number;
    warnings: number;
    progress: string;
}

type Emit = <E extends "build.changed" | "build.log">(event: E, params: Events[E]) => void;

//The value TestProject's CMakeLists.txt takes in LANG to build the shared library a language's binding loads
const languageOptions: Record<string, string> = { "C#": "CSharp", "Python": "Python", "Rust": "Rust" };

//Lines kept per step; a long build's oldest go first
const maximumLineCount = 20000;

//The Build tab: Generate, Configure, Build and Run for the target in Project.user.bechaml, one step after another, each in its own
//process. Output goes out as events while it comes; a step that fails or is stopped leaves the rest waiting
export class BuildSession
{
    private readonly _environment: MachineEnvironment;
    private readonly _setup: SetupChecks;
    private readonly _emit: Emit;
    private readonly _context: () => Promise<BuildContext>;
    private readonly _steps = new Map<BuildStep, StepStatus>();
    private readonly _logs = new Map<BuildStep, LogLine[]>();
    private readonly _pendingLines = new Map<BuildStep, LogLine[]>();
    private _flushTimer: NodeJS.Timeout | undefined;
    private _isRunning = false;
    private _isStopping = false;
    private _child: ChildProcess | undefined;
    //The target of the running steps, so the state sent while they run doesn't read the files again each time
    private _runningTarget: BuildTarget | undefined;
    //Per running step: the errors and warnings so far, and ninja's progress
    private readonly _counts = new Map<BuildStep, StepCounts>();
    //Whether Generate runs even when nothing it reads changed: when it was asked for alone, as the Generate button does
    private _isGenerateForced = false;

    constructor(environment: MachineEnvironment, setup: SetupChecks, context: () => Promise<BuildContext>, emit: Emit)
    {
        this._environment = environment;
        this._setup = setup;
        this._context = context;
        this._emit = emit;

        for (const step of buildSteps)
        {
            this._steps.set(step, idleStep(step));
            this._logs.set(step, []);
        }
    }

    async load(): Promise<{ state: BuildState; logs: Partial<Record<BuildStep, LogLine[]>> }>
    {
        return { state: await this.state(), logs: Object.fromEntries(this._logs) };
    }

    async state(): Promise<BuildState>
    {
        const target = this._isRunning && this._runningTarget ? this._runningTarget : await this.target();
        return { target: target, steps: buildSteps.map(step => ({ ...this._steps.get(step) ?? idleStep(step) })), isRunning: this._isRunning };
    }

    async setTarget(platform: string, buildType: string): Promise<BuildState>
    {
        const { folder } = await this._context();
        const target = await this.target();

        if (this._isRunning)
            throw new Error("The target can't change while a step runs.");

        if (!folder || !target.platforms.includes(platform) || !buildTypes.includes(buildType))
            throw new Error(platform + " " + buildType + " isn't a target of this project.");

        const message = await writeBuildTarget(folder, platform, buildType);

        if (message)
            throw new Error(message);

        this.resetSteps();
        return this.state();
    }

    //Starts the steps and answers at once; the events tell how they go.
    async start(steps: readonly BuildStep[]): Promise<{ isStarted: boolean; message: string }>
    {
        if (this._isRunning)
            return { isStarted: false, message: "A step is running already." };

        const target = await this.target();
        const { folder } = await this._context();
        const asked = buildSteps.filter(step => steps.includes(step));

        //Configure and Build need what Generate writes, so it runs first when a file it reads changed since it last ran.
        const needsGenerate = !asked.includes("generate") && asked.some(step => "configure" === step || "build" === step) && undefined !== folder && "changed" === await generateNeed(folder);
        const requested = needsGenerate ? buildSteps.filter(step => "generate" === step || asked.includes(step)) : asked;

        if (0 === requested.length)
            return { isStarted: false, message: "No step to run." };

        if (target.unavailable && requested.some(step => "generate" !== step))
            return { isStarted: false, message: target.unavailable };

        this._isRunning = true;
        this._isStopping = false;
        this._isGenerateForced = 1 === requested.length && "generate" === requested[0];
        this._runningTarget = target;

        for (const step of requested)
        {
            this._steps.set(step, { ...idleStep(step), state: "waiting" });
            this._logs.set(step, []);
        }

        void this.runSteps(requested, target);
        await this.emitState();
        return { isStarted: true, message: "" };
    }

    async stop(): Promise<BuildState>
    {
        this._isStopping = true;
        killTree(this._child, this._environment);
        return this.state();
    }

    //Removes the target's build folder, never anything outside the project's build/ folder.
    async clean(): Promise<{ state: BuildState; message: string }>
    {
        const { folder } = await this._context();
        const target = await this.target();

        if (this._isRunning)
            return { state: await this.state(), message: "Stop the running step first." };

        if (!folder)
            return { state: await this.state(), message: "There's no project." };

        const buildRoot = path.resolve(folder, "build");
        const buildFolder = path.resolve(folder, target.buildFolder);

        if (!buildFolder.startsWith(buildRoot + path.sep))
            return { state: await this.state(), message: target.buildFolder + " isn't inside build/, so it isn't removed." };

        const existed = existsSync(buildFolder);
        await rm(buildFolder, { recursive: true, force: true });
        this.resetSteps();
        return { state: await this.state(), message: existed ? "Removed " + target.buildFolder + "." : target.buildFolder + " didn't exist." };
    }

    private async target(): Promise<BuildTarget>
    {
        const { folder, values } = await this._context();
        const host = hostPlatform(this._environment.platform);
        const platforms = values && 0 < values.platforms.length ? values.platforms : [host];
        const saved = folder ? await readBuildTarget(folder) : { platform: "", buildType: "" };
        const platform = platforms.includes(saved.platform) ? saved.platform : platforms.includes(host) ? host : platforms[0] ?? host;
        const buildType = buildTypes.includes(saved.buildType) ? saved.buildType : "Debug";
        const settings = values?.platformSettings[platform];
        const language = settings ? [settings.language, settings.standard].join(" ") : "C++ (no Project.bechaml)";
        const buildFolder = "build/" + platform.replace(/[^A-Za-z0-9]+/g, "") + "-" + buildType;

        let unavailable = "";

        if (!folder)
            unavailable = "Roux was started without a project folder.";
        else if (platform !== host)
            unavailable = platform + " builds only on " + platform + " for now; building it from " + host + " comes later.";

        return {
            platforms: platforms,
            buildTypes: buildTypes,
            platform: platform,
            buildType: buildType,
            buildFolder: buildFolder,
            summary: [platform, language, settings?.compiler, buildFolder].filter(Boolean).join(" · "),
            unavailable: unavailable
        };
    }

    private async runSteps(steps: BuildStep[], target: BuildTarget): Promise<void>
    {
        for (const [index, step] of steps.entries())
        {
            const isDone = await this.runStep(step, target).catch(error =>
            {
                this.log(step, { text: "Roux: " + (error instanceof Error ? error.message : String(error)), severity: "error" });
                this.finish(step, "failed", "failed");
                return false;
            });

            if (!isDone)
            {
                for (const rest of steps.slice(index + 1))
                    this._steps.set(rest, idleStep(rest));

                break;
            }
        }

        this._isRunning = false;
        this._runningTarget = undefined;
        this._child = undefined;
        this.flush();
        await this.emitState();
    }

    //Whether the step went through, so the next one may run.
    private async runStep(step: BuildStep, target: BuildTarget): Promise<boolean>
    {
        if (this._isStopping)
            return false;

        this._steps.set(step, { ...idleStep(step), state: "running", startedAt: Date.now() });
        await this.emitState();

        const context = await this._context();
        const folder = context.folder ?? "";

        if ("generate" === step)
            return this.generate(folder);

        const buildFolder = path.resolve(folder, target.buildFolder);

        //The program runs in the user's own environment; only configuring and building need the tools and vcvars64.
        if ("run" === step)
            return this.runProgram(buildFolder, target, context.values);

        const toolset = await this.toolset(step, context);

        if (!toolset)
            return this.finish(step, "failed", "tools missing");

        if ("configure" === step)
            return this.configure(folder, buildFolder, target, toolset, context.values);

        return this.build(buildFolder, target, toolset);
    }

    //The tools Setup chose, and on Windows the chosen Visual Studio's vcvars64 environment around them.
    private async toolset(step: BuildStep, context: BuildContext): Promise<Toolset | undefined>
    {
        const { paths, problems } = await this._setup.chosenTools(context.setup, ["CMake", "Ninja", "Compiler", "VCPKG_ROOT"]);

        for (const problem of problems)
            this.log(step, { text: problem, severity: "error" });

        const [cmake, ninja, compiler, vcpkgRoot] = [paths.CMake, paths.Ninja, paths.Compiler, paths.VCPKG_ROOT];

        if (!cmake || !ninja || !compiler || !vcpkgRoot)
            return undefined;

        let environment: NodeJS.ProcessEnv = this._environment.variables;

        if ("win32" === this._environment.platform)
        {
            const studio = await visualStudioEnvironment(compiler);

            if (!studio)
            {
                this.log(step, { text: "vcvars64.bat of " + compiler + " failed, so there's no compiler environment.", severity: "error" });
                return undefined;
            }

            this.log(step, { text: "Using the environment of " + compiler + " (vcvars64.bat).", severity: "note" });
            environment = studio;
        }

        //RetroFuturaGUI's CMakeLists.txt reads VCPKG_ROOT itself; English compiler messages keep the log readable for Roux.
        environment = withVariable(environment, "VCPKG_ROOT", vcpkgRoot, this._environment.platform);
        environment = withVariable(environment, "VSLANG", "1033", this._environment.platform);
        return { cmake: cmake, ninja: ninja, compiler: compiler, vcpkgRoot: vcpkgRoot, environment: environment };
    }

    //A build folder keeps the compiler it was configured with; another one's environment around it mixes two standard
    //libraries, which ends in walls of errors in the standard headers. Both Configure and Build refuse that.
    private async isOtherCompiler(step: BuildStep, buildFolder: string, target: BuildTarget, toolset: Toolset): Promise<boolean>
    {
        const configured = await configuredCompiler(buildFolder);

        if (!configured || isSameCompiler(configured, toolset.compiler, this._environment))
            return false;

        this.log(step, { text: target.buildFolder + " was configured with " + configured + ", not with the compiler chosen in Setup (" + toolset.compiler + "). Mixing them breaks the build: Clean, then configure again.", severity: "error" });
        return true;
    }

    private async configure(folder: string, buildFolder: string, target: BuildTarget, toolset: Toolset, values: ProjectValues | undefined): Promise<boolean>
    {
        if (await this.isOtherCompiler("configure", buildFolder, target, toolset))
            return this.finish("configure", "failed", "another compiler");

        await writeCodeModelQuery(buildFolder);

        const slashes = (file: string) => file.split(path.sep).join("/");
        const triplet = hostTriplet(this._environment);
        const args =
        [
            "-S", folder,
            "-B", buildFolder,
            "-G", "Ninja",
            "-DCMAKE_MAKE_PROGRAM=" + slashes(toolset.ninja),
            "-DCMAKE_TOOLCHAIN_FILE=" + slashes(path.join(toolset.vcpkgRoot, "scripts", "buildsystems", "vcpkg.cmake")),
            "-DVCPKG_TARGET_TRIPLET=" + triplet,
            "-DTARGETPLATFORM=" + triplet,
            "-DROUX_PLATFORM=" + target.platform,
            "-DCMAKE_BUILD_TYPE=" + target.buildType
        ];

        //The Project tab's switches, once there's a Project.bechaml; RetroFuturaGUI's defaults without one.
        if (values)
        {
            args.push("-DRETROFUTURAGUI_TRACKER_MODULES=" + (values.features.includes("TrackerModules") ? "ON" : "OFF"));
            args.push("-DRETROFUTURAGUI_ROYALTY_FREE_CODECS_ONLY=" + (values.allowNonRoyaltyFreeCodecs ? "OFF" : "ON"));

            const language = languageOptions[values.platformSettings[target.platform]?.language ?? ""];

            if (language)
                args.push("-DLANG=" + language);
        }

        const code = await this.execute("configure", toolset.cmake, args, folder, toolset.environment, folder);
        return this.finishProcess("configure", code, code => 0 === code ? "configured" : "exited with code " + code);
    }

    //Project.bechaml into Project.cmake and CMakeLists.txt's regions. Without a Project.bechaml there's nothing to
    //generate, and CMakeLists.txt is used as it is. Unless asked for alone, it's skipped while nothing it reads changed.
    private async generate(folder: string): Promise<boolean>
    {
        if (!folder)
            return this.finish("generate", "failed", "no project");

        if (!this._isGenerateForced && "unchanged" === await generateNeed(folder))
        {
            this.log("generate", { text: "Nothing Generate reads changed since it last ran.", severity: "note" });
            return this.finish("generate", "skipped", "nothing changed");
        }

        const result = await generateProject(folder);

        if (!result.hasProject)
        {
            this.log("generate", { text: "There's no Project.bechaml, so there's nothing to generate: CMakeLists.txt is used as it is.", severity: "note" });
            return this.finish("generate", "skipped", "no Project.bechaml");
        }

        const relative = (file: string) => path.relative(folder, file).split(path.sep).join("/");
        let errors = 0;
        let warnings = 0;

        for (const problem of result.problems)
        {
            const location = { file: problem.file, line: problem.line, column: problem.column };
            this.log("generate", { text: relative(problem.file) + ":" + problem.line + ":" + problem.column + ": " + problem.severity + ": " + problem.message, severity: problem.severity, location: location });

            if ("error" === problem.severity)
                ++errors;
            else
                ++warnings;
        }

        for (const file of result.written)
            this.log("generate", { text: "Wrote " + relative(file) + ".", severity: "note" });

        for (const file of result.removed)
            this.log("generate", { text: "Removed " + relative(file) + ".", severity: "note" });

        const problems = problemSummary(errors, warnings);

        if (0 < errors)
            return this.finish("generate", "failed", problems);

        const changed = result.written.length + result.removed.length;
        const done = 0 === changed ? "up to date" : [result.written.length ? "wrote " + result.written.length + (1 === result.written.length ? " file" : " files") : "", result.removed.length ? "removed " + result.removed.length : ""].filter(Boolean).join(", ");
        return this.finish("generate", "ok", [done, problems].filter(Boolean).join(", "));
    }

    private async build(buildFolder: string, target: BuildTarget, toolset: Toolset): Promise<boolean>
    {
        if (!existsSync(path.join(buildFolder, "CMakeCache.txt")))
        {
            this.log("build", { text: target.buildFolder + " isn't configured yet: run Configure first.", severity: "error" });
            return this.finish("build", "failed", "not configured");
        }

        if (await this.isOtherCompiler("build", buildFolder, target, toolset))
            return this.finish("build", "failed", "another compiler");

        const code = await this.execute("build", toolset.cmake, ["--build", buildFolder], buildFolder, toolset.environment, buildFolder);
        const log = this._logs.get("build") ?? [];
        const upToDate = log.some(line => /^ninja: no work to do/.test(line.text));
        return this.finishProcess("build", code, code => 0 === code ? (upToDate ? "up to date" : "built") : "");
    }

    private async runProgram(buildFolder: string, target: BuildTarget, values: ProjectValues | undefined): Promise<boolean>
    {
        const language = values?.platformSettings[target.platform]?.language;

        if (language && languageOptions[language])
        {
            this.log("run", { text: "Running a " + language + " app through its language comes later; the build made the library it loads.", severity: "error" });
            return this.finish("run", "failed", "not yet for " + language);
        }

        const executable = await findExecutable(buildFolder);

        if (!executable || !existsSync(executable.file))
        {
            this.log("run", { text: "No program to run in " + target.buildFolder + ": configure and build first.", severity: "error" });
            return this.finish("run", "failed", "nothing built");
        }

        //Run from the program's folder, where the build copies its resources and where RetroFuturaGUI.ini is kept.
        const code = await this.execute("run", executable.file, [], path.dirname(executable.file), this._environment.variables, path.dirname(executable.file), true);
        return this.finishProcess("run", code, code => "exited with code " + code);
    }

    //Runs one process of a step: prints its command first, then each line it prints. Resolves with its exit code, or
    //null when it couldn't start.
    private execute(step: BuildStep, file: string, args: string[], cwd: string, environment: NodeJS.ProcessEnv, locationFolder: string, showsWindows = false): Promise<number | null>
    {
        this.log(step, { text: "$ " + commandLine(file, args), severity: "command" });

        return new Promise(resolve =>
        {
            let child: ChildProcess;

            try
            {
                //A program's windows must show, so only the build tools' consoles are hidden. Elsewhere the process gets
                //a group of its own, so Stop reaches what it started.
                child = spawn(file, args, { cwd: cwd, env: environment, windowsHide: !showsWindows, detached: "win32" !== this._environment.platform });
            }
            catch (error)
            {
                this.log(step, { text: "Can't start " + file + ": " + (error instanceof Error ? error.message : String(error)), severity: "error" });
                resolve(null);
                return;
            }

            this._child = child;
            child.stdin?.end();

            const counts = this.stepCounts(step);

            for (const stream of [child.stdout, child.stderr])
            {
                let rest = "";
                stream?.setEncoding("utf8");

                stream?.on("data", (chunk: string) =>
                {
                    const lines = (rest + chunk).split(/\r?\n/);
                    rest = lines.pop() ?? "";

                    for (const text of lines)
                        this.logOutput(step, text, locationFolder, counts);
                });

                stream?.on("end", () =>
                {
                    if (rest)
                        this.logOutput(step, rest, locationFolder, counts);

                    rest = "";
                });
            }

            child.on("error", error =>
            {
                this.log(step, { text: "Can't start " + file + ": " + error.message, severity: "error" });
                resolve(null);
            });

            child.on("close", code => resolve(code ?? -1));
        });
    }

    private logOutput(step: BuildStep, text: string, folder: string, counts: StepCounts): void
    {
        const line = readLogLine(text, folder);

        if ("error" === line.severity && line.location)
            ++counts.errors;
        else if ("warning" === line.severity)
            ++counts.warnings;

        //Ninja's "[12/340] Building CXX object ..." shows as the step's progress.
        const progress = /^\[(\d+)\/(\d+)\]/.exec(text);

        if (progress)
            counts.progress = progress[1] + " of " + progress[2];

        const status = this._steps.get(step);

        if (status)
            status.summary = [counts.progress, problemSummary(counts.errors, counts.warnings)].filter(Boolean).join(", ");

        this.log(step, line);
    }

    private stepCounts(step: BuildStep): StepCounts
    {
        const counts = this._counts.get(step) ?? { errors: 0, warnings: 0, progress: "" };
        this._counts.set(step, counts);
        return counts;
    }

    private finishProcess(step: BuildStep, code: number | null, describe: (code: number) => string): boolean
    {
        const counts = this.stepCounts(step);
        this._counts.delete(step);
        const problems = problemSummary(counts.errors, counts.warnings);

        if (this._isStopping)
            return this.finish(step, "stopped", "stopped");

        if (null === code)
            return this.finish(step, "failed", "couldn't start");

        //A failure without counted problems (a crash, a linker error without a file) at least says how it ended.
        const summary = [describe(code), problems].filter(Boolean).join(", ") || "exited with code " + code;
        return this.finish(step, 0 === code ? "ok" : "failed", summary);
    }

    //Ends a step; true when the next step may run.
    private finish(step: BuildStep, state: StepStatus["state"], summary: string): boolean
    {
        const status = this._steps.get(step) ?? idleStep(step);
        this._steps.set(step, { ...status, state: state, summary: summary, endedAt: Date.now() });
        this.flush();
        void this.emitState();
        return "ok" === state || "skipped" === state;
    }

    private log(step: BuildStep, line: LogLine): void
    {
        const lines = this._logs.get(step) ?? [];
        lines.push(line);

        if (maximumLineCount < lines.length)
            lines.splice(0, lines.length - maximumLineCount);

        this._logs.set(step, lines);

        const pending = this._pendingLines.get(step) ?? [];
        pending.push(line);
        this._pendingLines.set(step, pending);

        //A busy build prints thousands of lines; they go out in batches, ten times a second at most.
        this._flushTimer ??= setTimeout(() => this.flush(), 100);
    }

    private flush(): void
    {
        clearTimeout(this._flushTimer);
        this._flushTimer = undefined;

        for (const [step, lines] of this._pendingLines)
            this._emit("build.log", { step: step, lines: lines });

        this._pendingLines.clear();

        if (this._isRunning)
            void this.emitState();
    }

    private async emitState(): Promise<void>
    {
        this._emit("build.changed", await this.state());
    }

    private resetSteps(): void
    {
        for (const step of buildSteps)
        {
            this._steps.set(step, idleStep(step));
            this._logs.set(step, []);
        }
    }
}

function idleStep(step: BuildStep): StepStatus
{
    return { step: step, state: "idle", summary: "", startedAt: 0, endedAt: 0 };
}

//Ends a process and everything it started: ninja's compilers, a program's helper processes.
function killTree(child: ChildProcess | undefined, environment: MachineEnvironment): void
{
    if (!child?.pid || null !== child.exitCode)
        return;

    if ("win32" === environment.platform)
    {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        return;
    }

    try
    {
        process.kill(-child.pid, "SIGTERM");
    }
    catch
    {
        child.kill("SIGTERM");
    }
}
