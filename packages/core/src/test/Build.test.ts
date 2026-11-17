import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { BuildState, BuildStep, Events, LogLine, ProjectValues } from "@retrofuturagui/roux-protocol";
import { BuildSession } from "../build/BuildSession.js";
import { findExecutable, writeCodeModelQuery } from "../build/CMakeFileApi.js";
import { problemSummary, readLogLine } from "../build/LogLines.js";
import { readBuildTarget, writeBuildTarget } from "../build/ProjectUserFile.js";
import { isSameCompiler, withoutDeveloperEnvironment } from "../build/Toolset.js";
import { newProjectText } from "../project/ProjectFile.js";
import type { MachineEnvironment } from "../setup/Environment.js";
import type { SetupChecks } from "../setup/SetupChecks.js";

const windows: MachineEnvironment = { platform: "win32", variables: {}, homeDirectory: "C:\\Users\\Someone" };

test("reads errors and warnings with the file they name", () =>
{
    const folder = path.resolve("project");

    assert.deepEqual(readLogLine("C:\\src\\Main.cpp(12,5): error C2039: 'SetColour': is not a member", folder),
        { text: "C:\\src\\Main.cpp(12,5): error C2039: 'SetColour': is not a member", severity: "error", location: { file: path.resolve("C:\\src\\Main.cpp"), line: 12, column: 5 } });
    assert.equal(readLogLine("source\\Main.cpp(42): warning C4100: 'deltaTime': unreferenced parameter", folder).location?.file, path.join(folder, "source", "Main.cpp"));
    assert.equal(readLogLine("src/main.cpp:7:13: fatal error: glm/glm.hpp: No such file or directory", folder).severity, "error");
    assert.deepEqual(readLogLine("CMake Error at CMakeLists.txt:19 (message):", folder).location, { file: path.join(folder, "CMakeLists.txt"), line: 19, column: 1 });
    assert.equal(readLogLine("CMake Warning (dev) at RetroFuturaGUI/CMakeLists.txt:5 (find_package):", folder).severity, "warning");
    assert.equal(readLogLine("ninja: build stopped: subcommand failed.", folder).severity, "error");
    assert.equal(readLogLine("LINK : fatal error LNK1168: cannot open MyApp.exe for writing", folder).severity, "error");
    assert.equal(readLogLine("[12/185] Building CXX object source\\code\\MainScene.cpp.obj", folder).severity, "");
    assert.equal(readLogLine("See https://example.com/a(1): error-free", folder).severity, "");
    assert.equal(problemSummary(1, 2), "1 error, 2 warnings");
    assert.equal(problemSummary(0, 0), "");
});

test("keeps the build target in Project.user.bechaml", async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-user-"));

    try
    {
        assert.deepEqual(await readBuildTarget(folder), { platform: "", buildType: "" });
        assert.equal(await writeBuildTarget(folder, "Windows", "Release"), "");
        assert.deepEqual(await readBuildTarget(folder), { platform: "Windows", buildType: "Release" });
        assert.equal(readFileSync(path.join(folder, "Project.user.bechaml"), "utf8"), "<ProjectUser>\n    <BuildType>\"Release\"</BuildType>\n    <ActivePlatform>\"Windows\"</ActivePlatform>\n</ProjectUser>\n");

        writeFileSync(path.join(folder, "Project.user.bechaml"), "<ProjectUser>\n    <BuildType>Release</BuildType>\n</ProjectUser>\n");
        assert.match(await writeBuildTarget(folder, "Windows", "Debug"), /has errors, so it isn't written over/);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("tells whether a build folder was configured with the chosen compiler", () =>
{
    const studio = "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community";
    assert.ok(isSameCompiler("C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Tools/MSVC/14.43.34808/bin/Hostx64/x64/cl.exe", studio, windows));
    assert.ok(!isSameCompiler("C:/Program Files/Microsoft Visual Studio/18/Insiders/VC/Tools/MSVC/14.50.35717/bin/Hostx64/x64/cl.exe", studio, windows));
    assert.ok(!isSameCompiler("C:/Program Files/Microsoft Visual Studio/2022/CommunityPreview/VC/cl.exe", studio, windows));
});

test("finds the program to run in CMake's file API reply", async () =>
{
    const build = mkdtempSync(path.join(os.tmpdir(), "roux-fileapi-"));

    try
    {
        await writeCodeModelQuery(build);
        assert.equal(readFileSync(path.join(build, ".cmake", "api", "v1", "query", "client-roux", "codemodel-v2"), "utf8"), "");
        assert.equal(await findExecutable(build), undefined);

        const reply = path.join(build, ".cmake", "api", "v1", "reply");
        mkdirSync(reply, { recursive: true });
        const write = (name: string, value: unknown) => writeFileSync(path.join(reply, name), JSON.stringify(value));
        write("index-2026-11-15T10-00-00-0000.json", { reply: { "client-roux": { "codemodel-v2": { jsonFile: "codemodel-v2-1.json" } } } });
        write("codemodel-v2-1.json", { configurations: [{ projects: [{ name: "MyApp" }], targets: [{ name: "Helper", jsonFile: "target-helper.json" }, { name: "RetroFuturaGUI", jsonFile: "target-library.json" }, { name: "MyApp", jsonFile: "target-app.json" }] }] });
        write("target-helper.json", { type: "EXECUTABLE", artifacts: [{ path: "RetroFuturaGUI/Helper.exe" }], paths: { source: "RetroFuturaGUI" } });
        write("target-library.json", { type: "STATIC_LIBRARY", artifacts: [{ path: "RetroFuturaGUI/RetroFuturaGUI.lib" }], paths: { source: "RetroFuturaGUI" } });
        write("target-app.json", { type: "EXECUTABLE", artifacts: [{ path: "MyApp.exe" }, { path: "MyApp.pdb" }], paths: { source: "." } });

        assert.deepEqual(await findExecutable(build), { name: "MyApp", file: path.join(build, "MyApp.exe") });
    }
    finally
    {
        rmSync(build, { recursive: true, force: true });
    }
});

//A build session whose CMake is Node itself. Node rejects CMake's arguments, so Configure fails at once, without a compiler
function failingSession(folder: string, values: ProjectValues | undefined, events: { method: string; params: unknown }[]): BuildSession
{
    const setup = { chosenTools: async () => ({ paths: { CMake: process.execPath, Ninja: "ninja", Compiler: "cc", VCPKG_ROOT: folder }, problems: [] }) } as unknown as SetupChecks;
    const linux: MachineEnvironment = { platform: "linux", variables: process.env, homeDirectory: folder };
    const emit = <E extends keyof Events>(event: E, params: Events[E]) => { events.push({ method: event, params: params }); };
    return new BuildSession(linux, setup, async () => ({ folder: folder, values: values, setup: { requiredCMakeVersion: "3.16", hasTrackerModules: true } }), emit);
}

async function waitUntilDone(events: { method: string; params: unknown }[]): Promise<BuildState>
{
    for (let tries = 0; 200 > tries; ++tries)
    {
        const last = events.filter(event => "build.changed" === event.method).pop()?.params as BuildState | undefined;

        if (last && !last.isRunning)
            return last;

        await new Promise(resolve => setTimeout(resolve, 50));
    }

    throw new Error("The steps never ended.");
}

test("runs the steps in order and stops at the first that fails", { timeout: 30000 }, async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-build-"));
    const events: { method: string; params: unknown }[] = [];

    try
    {
        const session = failingSession(folder, undefined, events);
        const loaded = await session.load();
        assert.equal(loaded.state.target.platform, "Linux");
        assert.equal(loaded.state.target.buildFolder, "build/Linux-Debug");

        assert.deepEqual(await session.start(["generate", "configure", "build", "run"]), { isStarted: true, message: "" });
        assert.deepEqual(await session.start(["build"]), { isStarted: false, message: "A step is running already." });

        const done = await waitUntilDone(events);
        assert.deepEqual(done.steps.map(step => step.step + " " + step.state), ["generate skipped", "configure failed", "build idle", "run idle"]);
        assert.match(done.steps[1]?.summary ?? "", /^exited with code \d+/);

        const lines = events.filter(event => "build.log" === event.method).flatMap(event => (event.params as { lines: LogLine[] }).lines);
        assert.ok(lines.some(line => "command" === line.severity && line.text.includes("-DVCPKG_TARGET_TRIPLET=")), "the command is printed");
        assert.ok((await session.load()).logs.configure?.length, "the log is kept for a page that loads later");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("refuses targets this computer can't build, and cleans only inside build/", async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-target-"));
    const events: { method: string; params: unknown }[] = [];
    const values = { platforms: ["Linux", "Wii"], platformSettings: {}, features: [], allowNonRoyaltyFreeCodecs: false } as unknown as ProjectValues;

    try
    {
        const session = failingSession(folder, values, events);
        const wii = await session.setTarget("Wii", "Release");
        assert.equal(wii.target.buildFolder, "build/Wii-Release");
        assert.match(wii.target.unavailable, /^Wii builds only on Wii/);
        assert.deepEqual(await session.start(["configure"]), { isStarted: false, message: wii.target.unavailable });
        await assert.rejects(session.setTarget("Amiga", "Debug"));

        mkdirSync(path.join(folder, "build", "Wii-Release"), { recursive: true });
        writeFileSync(path.join(folder, "build", "Wii-Release", "CMakeCache.txt"), "");
        writeFileSync(path.join(folder, "keep.txt"), "");

        assert.equal((await session.clean()).message, "Removed build/Wii-Release.");
        assert.equal((await session.clean()).message, "build/Wii-Release didn't exist.");
        assert.ok(readFileSync(path.join(folder, "keep.txt"), "utf8") === "");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("generates first, and stops there when Project.bechaml's CMakeLists.txt has no regions", { timeout: 30000 }, async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-generate-step-"));
    const events: { method: string; params: unknown }[] = [];

    try
    {
        writeFileSync(path.join(folder, "Project.bechaml"), newProjectText("App", "Linux"));
        writeFileSync(path.join(folder, "CMakeLists.txt"), "project(App)\n");

        const session = failingSession(folder, undefined, events);
        await session.start(["generate", "configure"]);
        const failed = await waitUntilDone(events);
        assert.deepEqual(failed.steps.map(step => step.step + " " + step.state), ["generate failed", "configure idle", "build idle", "run idle"]);
        assert.equal(failed.steps[0]?.summary, "1 error");

        const error = (await session.load()).logs.generate?.find(line => "error" === line.severity);
        assert.deepEqual(error?.location, { file: path.join(folder, "CMakeLists.txt"), line: 1, column: 1 });

        rmSync(path.join(folder, "CMakeLists.txt"));
        events.length = 0;
        await session.start(["generate"]);
        const done = await waitUntilDone(events);
        assert.deepEqual([done.steps[0]?.state, done.steps[0]?.summary], ["ok", "wrote 2 files"]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("runs Generate in a build only when what it reads changed, and always when it's asked for alone", { timeout: 30000 }, async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-generate-skip-"));
    const events: { method: string; params: unknown }[] = [];
    const run = async (steps: BuildStep[]) =>
    {
        events.length = 0;
        await session.start(steps);
        return (await waitUntilDone(events)).steps.map(step => step.step + " " + step.state + (step.summary ? " (" + step.summary + ")" : ""));
    };

    const session = failingSession(folder, undefined, events);

    try
    {
        writeFileSync(path.join(folder, "Project.bechaml"), newProjectText("App", "Linux"));

        assert.deepEqual((await run(["build"]))[0], "generate ok (wrote 2 files)", "Build generates first, since nothing was generated yet");
        assert.equal((await run(["build"]))[2], "build failed (not configured)");
        assert.ok(!events.some(event => "build.log" === event.method && "generate" === (event.params as { step: string }).step), "nothing changed, so Generate didn't run");
        assert.deepEqual((await run(["generate", "build"]))[0], "generate skipped (nothing changed)");
        assert.deepEqual((await run(["generate"]))[0], "generate ok (up to date)", "the Generate button always runs");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("leaves out a developer environment Roux was started in, so the chosen Visual Studio's vcvars64.bat isn't overruled", () =>
{
    const studio2022 = String.raw`C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.43.34808\bin\Hostx64\x64`;
    const started =
    {
        Path: studio2022 + String.raw`;C:\Program Files (x86)\Windows Kits\10\bin\x64;C:\nodejs`,
        VCToolsInstallDir: String.raw`C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.43.34808\ `.trim(),
        VSCMD_VER: "17.13.0",
        INCLUDE: String.raw`C:\somewhere\include`,
        WindowsSdkDir: String.raw`C:\Program Files (x86)\Windows Kits\10\ `.trim(),
        VCPKG_ROOT: String.raw`C:\vcpkg`
    };

    assert.deepEqual(withoutDeveloperEnvironment(started), { Path: String.raw`C:\nodejs`, VCPKG_ROOT: String.raw`C:\vcpkg` }, "its folders leave the PATH");
    assert.deepEqual(withoutDeveloperEnvironment({ ...started, __VSCMD_PREINIT_PATH: String.raw`C:\before;C:\nodejs` }), { Path: String.raw`C:\before;C:\nodejs`, VCPKG_ROOT: String.raw`C:\vcpkg` }, "the PATH from before it, when it kept one");
});