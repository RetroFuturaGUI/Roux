import type { CheckResult, Events, PlatformSettings } from "@retrofuturagui/roux-protocol";
import { InvalidParamsError } from "../JsonRpcServer.js";
import { findCMake } from "./CMake.js";
import { findCompiler } from "./Compiler.js";
import type { MachineEnvironment } from "./Environment.js";
import { FixList, type Check, type FixRun } from "./Fixes.js";
import type { FixOutcome, FixRunner } from "./FixRunner.js";
import { checkSubmodules, findGit } from "./Git.js";
import { isChoosable, type MachineSettings } from "./Machine.js";
import { findClang } from "./Clang.js";
import { findNinja } from "./Ninja.js";
import { checkToolchain } from "./Toolchains.js";
import { fileKey } from "./Tool.js";
import { checkFfmpegLicensing, checkPorts, checkVcpkgTool, findVcpkg, hostTriplet, readVcpkgStatus, requiredPorts } from "./Vcpkg.js";

//What the checks need from the project. Without a project, RetroFuturaGUI's own needs
export interface SetupContext
{
    projectFolder?: string;
    requiredCMakeVersion: string;
    hasTrackerModules: boolean;
    platformSettings?: PlatformSettings; //the project's settings for this computer's platform
}

//The rows in the order the tab shows them
export const components = ["Git", "Submodules", "CMake", "Ninja", "Compiler", "VCPKG_ROOT", "vcpkg tool", "Ports", "FFmpeg licensing", "Language toolchain", "Node", "Clang"];

//Checks that read what another check chose: rerun along with it
const dependents: Record<string, string[]> =
{
    "Git": ["Submodules"],
    "VCPKG_ROOT": ["vcpkg tool", "Ports", "FFmpeg licensing"]
};

type Emit = <E extends "setup.checkStarted" | "setup.checkFinished">(event: E, params: Events[E]) => void;

//Runs the Setup checks, saves chosen installations and runs fixes. It keeps the last check of every component, so a fix
//runs only what that check offered and a choice is only one of the installations it found
export class SetupChecks
{
    private readonly _environment: MachineEnvironment;
    private readonly _machine: MachineSettings;
    private readonly _runner: FixRunner;
    private readonly _emit: Emit;
    private readonly _last = new Map<string, Check>();
    //Fixes that ran, by component, so one that waits for another (Install after its dry run) can run
    private readonly _ranFixes = new Map<string, Set<string>>();

    constructor(environment: MachineEnvironment, machine: MachineSettings, runner: FixRunner, emit: Emit)
    {
        this._environment = environment;
        this._machine = machine;
        this._runner = runner;
        this._emit = emit;
    }

    //Runs the given checks (all by default), the others answered from the last run. Each result goes out as an event as
    //soon as it's there, since some checks take seconds
    async run(context: SetupContext, only: readonly string[] = components): Promise<CheckResult[]>
    {
        const choices = await this._machine.choices();
        const env = this._environment;
        const triplet = hostTriplet(env);
        const tasks = new Map<string, Promise<Check>>();

        for (const component of only)
            this._emit("setup.checkStarted", { component: component });

        const run = (component: string, task: () => Promise<Check>): Promise<Check> =>
        {
            const last = this._last.get(component);

            const promise = !only.includes(component) && last ? Promise.resolve(last) : task().catch(error => failed(component, error)).then(check =>
            {
                this._last.set(component, check);
                this._ranFixes.delete(component);
                this._emit("setup.checkFinished", check.result);
                return check;
            });

            tasks.set(component, promise);
            return promise;
        };

        const git = run("Git", () => findGit(env, choices.Git));
        run("Submodules", async () => checkSubmodules(chosenPath(await git), context.projectFolder));
        run("CMake", () => findCMake(env, context.requiredCMakeVersion, choices.CMake));
        run("Ninja", () => findNinja(env, choices.Ninja));
        run("Compiler", () => findCompiler(env, choices.Compiler));

        const vcpkg = run("VCPKG_ROOT", () => findVcpkg(env, choices.VCPKG_ROOT));
        const root = vcpkg.then(chosenPath);
        const status = root.then(folder => folder ? readVcpkgStatus(folder) : undefined).catch(() => undefined);
        run("vcpkg tool", async () => checkVcpkgTool(env, await root));
        run("Ports", async () => checkPorts(env, await root, await status, triplet, requiredPorts(context.hasTrackerModules)));
        run("FFmpeg licensing", async () => checkFfmpegLicensing(await status, triplet));
        run("Language toolchain", () => checkToolchain(env, context.platformSettings));
        run("Clang", () => findClang(env, choices.Clang));
        run("Node", async () => new FixList().check({ component: "Node", status: "ok", detail: "runs Roux", installations: [{ version: process.versions.node, path: process.execPath, source: "Node", isOnPath: false }], chosenIndex: 0 }));

        const checks = await Promise.all(components.map(component => tasks.get(component) ?? Promise.resolve(failed(component, new Error("not run")))));
        return checks.map(check => check.result);
    }

    //The installation each of the components chose, running the checks first when they haven't run yet. A component
    //whose check found nothing usable isn't in paths. Problems says why, in the check's own words
    async chosenTools(context: SetupContext, wanted: readonly string[]): Promise<{ paths: Record<string, string>; problems: string[] }>
    {
        if (wanted.some(component => !this._last.has(component)))
            await this.run(context);

        const paths: Record<string, string> = {};
        const problems: string[] = [];

        for (const component of wanted)
        {
            const check = this._last.get(component);
            const chosen = check ? chosenPath(check) : undefined;

            if (chosen)
                paths[component] = chosen;
            else
                problems.push(component + ": " + (check?.result.detail || "not found") + " (see Setup)");
        }

        return { paths: paths, problems: problems };
    }

    //Saves the choice and checks the component again, with what depends on it
    async choose(component: string, chosen: string, context: SetupContext): Promise<CheckResult>
    {
        const last = this._last.get(component);

        if (!isChoosable(component) || !last)
            throw new InvalidParamsError(component + " has no installations to choose from.");

        if (!last.result.installations.some(installation => fileKey(installation.path) === fileKey(chosen)))
            throw new InvalidParamsError(chosen + " isn't one of the " + component + " installations found.");

        const message = await this._machine.choose(component, chosen);

        if (message)
            throw new Error(message);

        const results = await this.run(context, [component, ...(dependents[component] ?? [])]);
        return results.find(result => component === result.component) ?? last.result;
    }

    //A terminal or environment fix is followed by all checks again, so what it changed shows at once
    async runFix(component: string, fixId: string, context: SetupContext): Promise<FixOutcome>
    {
        const check = this._last.get(component);
        const run = check?.runs.get(fixId);
        const fix = check?.result.fixes.find(entry => fixId === entry.id);

        if (!check || !run || !fix)
            throw new InvalidParamsError(component + " offers no fix " + fixId + ".");

        const ran = this._ranFixes.get(component) ?? new Set<string>();

        if (fix.after && !ran.has(fix.after))
        {
            const first = check.result.fixes.find(entry => fix.after === entry.id);
            return { isDone: false, output: (first?.label ?? "The fix before it") + " has to run first." };
        }

        const outcome = await this.execute(run, fix.label + " " + component);
        ran.add(fixId);
        this._ranFixes.set(component, ran);

        if ("terminal" === run.kind || "environment" === run.kind)
            await this.run(context);

        return outcome;
    }

    private execute(run: FixRun, title: string): Promise<FixOutcome>
    {
        switch (run.kind)
        {
            case "terminal":
                return this._runner.terminal(run.commandLine, run.cwd, "Roux: " + title);
            case "capture":
                return this._runner.capture(run.file, run.args, run.cwd);
            case "environment":
                return this._runner.setEnvironment(run.name, run.value);
            case "link":
                return Promise.resolve({ isDone: true, output: run.url });
        }
    }
}

//The installation a check chose, unless it found nothing usable
function chosenPath(check: Check): string | undefined
{
    return "error" === check.result.status ? undefined : check.result.installations[check.result.chosenIndex]?.path;
}

function failed(component: string, error: unknown): Check
{
    return new FixList().check({ component: component, status: "error", detail: "the check failed: " + (error instanceof Error ? error.message : String(error)), installations: [], chosenIndex: -1 });
}