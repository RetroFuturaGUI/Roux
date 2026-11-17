import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { CheckResult, JsonRpcFailure, JsonRpcSuccess } from "@retrofuturagui/roux-protocol";
import { Core } from "../Core.js";
import { parseCompilerVersion } from "../setup/Compiler.js";
import type { MachineEnvironment } from "../setup/Environment.js";
import { FixList } from "../setup/Fixes.js";
import type { FixRunner } from "../setup/FixRunner.js";
import { parseGitVersion, parseSubmoduleStatus, submoduleCheck } from "../setup/Git.js";
import { MachineSettings, machineFilePath } from "../setup/Machine.js";
import { parseNinjaVersion } from "../setup/Ninja.js";
import { parseDotnetSdks, parsePyLauncher, pythonCheck } from "../setup/Toolchains.js";
import { checkFfmpegLicensing, checkPorts, hostTriplet, parseVcpkgStatus, requiredPorts, vcpkgToolCheck } from "../setup/Vcpkg.js";

const windows: MachineEnvironment = { platform: "win32", variables: {}, homeDirectory: "C:\\Users\\Someone" };

test("reads the versions the tools print", () =>
{
    assert.equal(parseGitVersion("git version 2.47.1.windows.1\n"), "2.47.1");
    assert.equal(parseNinjaVersion("1.12.1\n"), "1.12.1");
    assert.equal(parseCompilerVersion("g++ (Ubuntu 14.2.0-4ubuntu2) 14.2.0\nCopyright"), "14.2.0");
    assert.equal(parseCompilerVersion("Ubuntu clang version 18.1.3 (1ubuntu1)\nTarget: x86_64"), "18.1.3");
    assert.deepEqual(parseDotnetSdks("8.0.404 [C:\\Program Files\\dotnet\\sdk]\r\n9.0.100 [C:\\Program Files\\dotnet\\sdk]\r\n").map(sdk => sdk.version), ["8.0.404", "9.0.100"]);
    assert.deepEqual(parsePyLauncher(" -V:3.14 *        C:\\Python314\\python.exe\r\n -V:3.12          C:\\Python312\\python.exe\r\n").map(python => python.version + " " + python.path),
        ["3.14 C:\\Python314\\python.exe", "3.12 C:\\Python312\\python.exe"]);
    assert.equal(hostTriplet(windows, "x64"), "x64-windows");
    assert.equal(hostTriplet({ ...windows, platform: "linux" }, "arm64"), "arm64-linux");
});

test("reads the submodules' states and offers to fetch the missing ones", () =>
{
    const states = parseSubmoduleStatus(" 1a2b3c RetroFuturaGUI (heads/main)\n-4d5e6f RetroFuturaGUI/PlatformBridge\n+7a8b9c Roux (v1)\n");
    assert.deepEqual([...states], [["RetroFuturaGUI", "ok"], ["RetroFuturaGUI/PlatformBridge", "uninitialized"], ["Roux", "otherCommit"]]);

    const missing = submoduleCheck(states, "C:\\Git\\git.exe", "C:\\Project", new FixList());
    assert.equal(missing.result.status, "error");
    assert.equal(missing.result.detail, "RetroFuturaGUI/PlatformBridge not checked out");
    assert.deepEqual(missing.result.fixes, [{ id: "fetch", label: "Fetch", command: "C:\\Git\\git.exe submodule update --init --recursive", kind: "terminal" }]);
    assert.deepEqual(missing.runs.get("fetch"), { kind: "terminal", commandLine: "C:\\Git\\git.exe submodule update --init --recursive", cwd: "C:\\Project" });

    const working = submoduleCheck(new Map([["RetroFuturaGUI", "otherCommit"], ["RetroFuturaGUI/PlatformBridge", "ok"]]), "git", "C:\\Project", new FixList());
    assert.equal(working.result.status, "ok");
    assert.match(working.result.detail, /RetroFuturaGUI at another commit/);
    assert.deepEqual(working.result.fixes, [], "no Update while working on RetroFuturaGUI");
});

test("adds RetroFuturaGUI to a project without it, and updates it with its submodules", () =>
{
    const added = submoduleCheck(new Map(), "git", "C:\\NoSuchProject", new FixList());
    assert.equal(added.result.status, "error");
    assert.deepEqual(added.runs.get("add-retrofuturagui"),
    {
        kind: "terminal",
        commandLine: "git submodule add https://github.com/RetroFuturaGUI/RetroFuturaGUI RetroFuturaGUI && git submodule update --init --recursive",
        cwd: "C:\\NoSuchProject"
    });

    const current = submoduleCheck(new Map([["RetroFuturaGUI", "ok"], ["RetroFuturaGUI/PlatformBridge", "ok"]]), "git", "C:\\Project", new FixList());
    assert.equal(current.result.status, "ok");
    assert.equal(current.result.fixes[0]?.command, "git submodule update --init --remote RetroFuturaGUI && git -C RetroFuturaGUI submodule update --init --recursive");
});

test("reads vcpkg's database, the later paragraph winning", () =>
{
    const status = "Package: glm\nVersion: 1.0.1\nArchitecture: x64-windows\nStatus: install ok installed\n\n"
        + "Package: ffmpeg\nFeature: gpl\nArchitecture: x64-windows\nStatus: install ok installed\n";
    const update = "Package: ffmpeg\nFeature: gpl\nArchitecture: x64-windows\nStatus: purge ok not-installed\n\n"
        + "Package: ffmpeg\nArchitecture: x64-windows\nStatus: install ok installed\n";

    const installed = parseVcpkgStatus([status, update]);
    assert.equal(installed.get("glm::x64-windows"), true);
    assert.equal(installed.get("ffmpeg::x64-windows"), true);
    assert.equal(installed.get("ffmpeg:gpl:x64-windows"), false);
    assert.equal(checkFfmpegLicensing(installed, "x64-windows").result.status, "ok");
    assert.equal(checkFfmpegLicensing(parseVcpkgStatus([status + "\nPackage: ffmpeg\nArchitecture: x64-windows\nStatus: install ok installed\n"]), "x64-windows").result.detail.startsWith("ffmpeg is built with gpl"), true);
    assert.equal(checkFfmpegLicensing(new Map(), "x64-windows").result.status, "skipped");
});

test("offers a dry run of the missing ports first, and their install after it", () =>
{
    const status = new Map(requiredPorts(false).map(port => [port + "::x64-windows", true] as [string, boolean]));
    assert.equal(checkPorts(windows, "C:\\vcpkg", status, "x64-windows", requiredPorts(false)).result.status, "ok");

    const missing = checkPorts(windows, "C:\\vcpkg", status, "x64-windows", requiredPorts(true));
    assert.equal(missing.result.status, "error");
    assert.match(missing.result.detail, /^libopenmpt missing for x64-windows/);
    assert.deepEqual(missing.result.fixes.map(fix => [fix.id, fix.kind, fix.after ?? ""]), [["dry-run", "capture", ""], ["install", "terminal", "dry-run"]]);
    assert.deepEqual(missing.runs.get("dry-run"), { kind: "capture", file: "C:\\vcpkg\\vcpkg.exe", args: ["install", "libopenmpt", "--triplet", "x64-windows", "--dry-run"], cwd: "C:\\vcpkg" });
});

test("tells an executable older than its ports tree", () =>
{
    assert.equal(vcpkgToolCheck(windows, "C:\\vcpkg", "2026-10-29", "2026-10-29", new FixList()).result.status, "ok");

    const old = vcpkgToolCheck(windows, "C:\\vcpkg", "2026-09-01", "2026-10-29", new FixList());
    assert.equal(old.result.detail, "the executable (2026-09-01) is older than its ports tree (2026-10-29)");
    assert.equal(old.result.fixes[0]?.command, "C:\\vcpkg\\bootstrap-vcpkg.bat -disableMetrics");
});

test("needs the Python version the project names", () =>
{
    const found = parsePyLauncher(" -V:3.12 *  C:\\Python312\\python.exe\r\n");
    assert.equal(pythonCheck(windows, found, "3.12").result.status, "ok");
    assert.equal(pythonCheck(windows, found, "3.14").result.status, "error");
});

test("saves choices in Machine.bechaml, keeping what else the file holds", async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-machine-"));

    try
    {
        assert.equal(machineFilePath({ ...windows, variables: { APPDATA: "C:\\Users\\Someone\\AppData\\Roaming" } }), path.join("C:\\Users\\Someone\\AppData\\Roaming", "Roux", "Machine.bechaml"));

        const file = path.join(folder, "Roux", "Machine.bechaml");
        const machine = new MachineSettings(file);
        assert.deepEqual(await machine.choices(), {});

        assert.equal(await machine.choose("CMake", path.join("C:", "CMake", "bin", "cmake.exe")), "");
        assert.equal(await machine.choose("VCPKG_ROOT", path.join("C:", "vcpkg")), "");
        assert.equal(readFileSync(file, "utf8"), "<Machine>\n    <CMake>\"C:/CMake/bin/cmake.exe\"</CMake>\n    <Vcpkg>\"C:/vcpkg\"</Vcpkg>\n</Machine>\n");
        assert.deepEqual(await machine.choices(), { "CMake": path.normalize("C:/CMake/bin/cmake.exe"), "VCPKG_ROOT": path.normalize("C:/vcpkg") });
        assert.equal(await machine.choose("Node", "C:/node.exe"), "Node's installation isn't chosen.");

        writeFileSync(file, "<Machine>\n    <CMake>broken</CMake>\n</Machine>\n");
        assert.match(await machine.choose("CMake", "C:/cmake.exe"), /has errors, so it isn't written over/);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("runs a dry run before its install, then checks again", { timeout: 60000 }, async () =>
{
    const root = mkdtempSync(path.join(os.tmpdir(), "roux-vcpkg-"));
    const asked: string[] = [];
    const runner: FixRunner =
    {
        terminal: async commandLine => { asked.push("terminal " + commandLine); return { isDone: true, output: "" }; },
        capture: async (file, args) => { asked.push("capture " + [path.basename(file), ...args].join(" ")); return { isDone: true, output: "would install" }; },
        setEnvironment: async name => { asked.push("environment " + name); return { isDone: true, output: "" }; }
    };

    try
    {
        //A vcpkg folder that has nothing installed. Tts executable doesn't run, which is fine for this
        mkdirSync(path.join(root, "scripts", "buildsystems"), { recursive: true });
        mkdirSync(path.join(root, "installed", "vcpkg"), { recursive: true });
        writeFileSync(path.join(root, "vcpkg.exe"), "");
        writeFileSync(path.join(root, "scripts", "buildsystems", "vcpkg.cmake"), "");
        writeFileSync(path.join(root, "installed", "vcpkg", "status"), "");

        const environment: MachineEnvironment = { platform: "win32", variables: { VCPKG_ROOT: root }, homeDirectory: root };
        const core = new Core(environment, { machineFile: path.join(root, "Machine.bechaml"), fixRunner: runner });
        const call = async (method: string, params: object = {}) => ((await core.server.handle({ jsonrpc: "2.0", id: 1, method: method, params: params })) as JsonRpcSuccess).result;

        const { checks } = await call("setup.runChecks") as { checks: CheckResult[] };
        const ports = checks.find(check => "Ports" === check.component);
        assert.equal(ports?.status, "error");

        assert.deepEqual(await call("setup.runFix", { component: "Ports", fixId: "install" }), { isDone: false, output: "Dry run has to run first." });
        assert.deepEqual(await call("setup.runFix", { component: "Ports", fixId: "dry-run" }), { isDone: true, output: "would install" });
        assert.deepEqual(await call("setup.runFix", { component: "Ports", fixId: "install" }), { isDone: true, output: "" });
        assert.equal(asked.length, 2);
        assert.match(asked[0] ?? "", /^capture vcpkg\.exe install glfw3 .* --triplet x64-windows --dry-run$/);
        assert.match(asked[1] ?? "", /^terminal .*vcpkg\.exe install glfw3 .* --triplet x64-windows$/);
        core.close();
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});

test("runs only the fixes a check offered, and chooses only found installations", { timeout: 60000 }, async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-setup-"));
    const asked: string[] = [];
    const runner: FixRunner =
    {
        terminal: async commandLine => { asked.push("terminal " + commandLine); return { isDone: true, output: "" }; },
        capture: async (file, args) => { asked.push("capture " + [file, ...args].join(" ")); return { isDone: true, output: "would install" }; },
        setEnvironment: async name => { asked.push("environment " + name); return { isDone: true, output: "" }; }
    };

    try
    {
        mkdirSync(path.join(folder, "project"));
        const core = new Core(undefined, { projectFolder: path.join(folder, "project"), machineFile: path.join(folder, "Machine.bechaml"), fixRunner: runner });
        const call = async (method: string, params: object = {}) => core.server.handle({ jsonrpc: "2.0", id: 1, method: method, params: params });

        const checks = ((await call("setup.runChecks")) as JsonRpcSuccess).result as { checks: CheckResult[] };
        assert.deepEqual(checks.checks.map(check => check.component), ["Git", "Submodules", "CMake", "Ninja", "Compiler", "VCPKG_ROOT", "vcpkg tool", "Ports", "FFmpeg licensing", "Language toolchain", "Node", "Clang"]);

        const clang = checks.checks.find(check => "Clang" === check.component);
        assert.ok(clang && "error" !== clang.status, "a missing Clang is a warning at most: only roux schema needs it");

        const unknownFix = (await call("setup.runFix", { component: "CMake", fixId: "rm-rf" })) as JsonRpcFailure;
        assert.equal(unknownFix.error.message, "CMake offers no fix rm-rf.");

        const outsidePath = (await call("setup.choose", { component: "CMake", path: "C:\\Windows\\System32\\cmd.exe" })) as JsonRpcFailure;
        assert.match(outsidePath.error.message, /isn't one of the CMake installations found/);

        const cmake = checks.checks.find(check => "CMake" === check.component);
        const last = cmake?.installations[cmake.installations.length - 1];

        if (last)
        {
            const chosen = ((await call("setup.choose", { component: "CMake", path: last.path })) as JsonRpcSuccess).result as CheckResult;
            assert.equal(chosen.installations[chosen.chosenIndex]?.path, last.path);
            assert.ok(readFileSync(path.join(folder, "Machine.bechaml"), "utf8").includes("<CMake>"));
        }

        assert.deepEqual(asked, [], "nothing ran without being asked");
        core.close();
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});
