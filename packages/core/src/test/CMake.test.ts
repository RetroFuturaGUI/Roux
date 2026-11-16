import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Installation } from "@retrofuturagui/roux-protocol";
import { cmakeCheckResult, findCMake, parseCMakeVersion } from "../setup/CMake.js";
import { currentEnvironment, type MachineEnvironment } from "../setup/Environment.js";
import { probeCandidates } from "../setup/Tool.js";
import { compareVersions } from "../setup/Version.js";

const windows: MachineEnvironment = { platform: "win32", variables: {}, homeDirectory: "C:\\Users\\Someone" };

function installation(version: string, source = "Program Files"): Installation
{
    return { version: version, path: "C:\\" + version + "\\cmake.exe", source: source, isOnPath: false };
}

test("reads the version CMake prints", () =>
{
    assert.equal(parseCMakeVersion("cmake version 3.31.2\n\nCMake suite maintained and supported by Kitware (kitware.com/cmake).\n"), "3.31.2");
    assert.equal(parseCMakeVersion("cmake version 4.0.0-rc1\n"), "4.0.0-rc1");
    assert.equal(parseCMakeVersion("cmake3 version 3.17.5\n"), "3.17.5");
    assert.equal(parseCMakeVersion("cmake version 3.29.5-msvc4\n"), "3.29.5-msvc4");
    assert.equal(parseCMakeVersion("command not found"), "");
});

test("compares versions part by part, a pre-release before its release", () =>
{
    assert.ok(0 > compareVersions("3.16", "3.31.2"));
    assert.ok(0 < compareVersions("3.100.0", "3.31.2"));
    assert.equal(compareVersions("3.16", "3.16.0"), 0);
    assert.ok(0 > compareVersions("4.0.0-rc1", "4.0.0"));
    assert.ok(0 > compareVersions("4.0.0-rc2", "4.0.0-rc10"));
    assert.equal(compareVersions("4.1.1-msvc4", "4.1.1"), 0);
    assert.ok(0 < compareVersions("4.1.1-msvc4", "4.1.0"));
});

test("chooses the newest installation, or the newest that meets the required version", () =>
{
    const found = [installation("3.29.5", "Visual Studio (bundled)"), installation("3.31.2"), installation("3.16.3")];

    const newest = cmakeCheckResult(found, windows, "").result;
    assert.equal(newest.status, "ok");
    assert.deepEqual(newest.installations.map(entry => entry.version), ["3.31.2", "3.29.5", "3.16.3"]);
    assert.equal(newest.chosenIndex, 0);

    const required = cmakeCheckResult(found, windows, "3.20").result;
    assert.equal(required.status, "ok");
    assert.equal(required.installations[required.chosenIndex]?.version, "3.31.2");
    assert.equal(required.detail, "needs 3.20 or newer");

    const tooOld = cmakeCheckResult(found, windows, "5.0").result;
    assert.equal(tooOld.status, "error");
    assert.deepEqual(tooOld.fixes, [{ id: "download", label: "Download", command: "https://cmake.org/download/", kind: "link" }]);
});

test("keeps the installation chosen in Machine.bechaml while it's there and new enough", () =>
{
    const found = [installation("3.29.5", "Visual Studio (bundled)"), installation("3.31.2")];

    const chosen = cmakeCheckResult(found, windows, "3.16", "C:\\3.29.5\\cmake.exe").result;
    assert.equal(chosen.status, "ok");
    assert.equal(chosen.installations[chosen.chosenIndex]?.version, "3.29.5");
    assert.equal(chosen.detail, "needs 3.16 or newer; chosen for this computer");

    const tooOld = cmakeCheckResult(found, windows, "3.30", "C:\\3.29.5\\cmake.exe").result;
    assert.equal(tooOld.status, "error");
    assert.equal(tooOld.detail, "the chosen 3.29.5 is older than 3.30");

    const gone = cmakeCheckResult(found, windows, "", "C:\\gone\\cmake.exe").result;
    assert.equal(gone.status, "warning");
    assert.equal(gone.installations[gone.chosenIndex]?.version, "3.31.2");
    assert.equal(gone.detail, "the chosen C:\\gone\\cmake.exe is gone");
});

test("offers winget where it is installed, else the download page", () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-winget-"));

    try
    {
        mkdirSync(path.join(folder, "Microsoft", "WindowsApps"), { recursive: true });
        writeFileSync(path.join(folder, "Microsoft", "WindowsApps", "winget.exe"), "");

        const withWinget = cmakeCheckResult([], { ...windows, variables: { LOCALAPPDATA: folder } }, "").result;
        assert.equal(withWinget.status, "error");
        assert.equal(withWinget.chosenIndex, -1);
        assert.deepEqual(withWinget.fixes, [{ id: "install", label: "Install", command: "winget install Kitware.CMake", kind: "terminal" }]);

        assert.equal(cmakeCheckResult([], windows, "").result.fixes[0]?.kind, "link");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("lists a file found twice once, marked as on the PATH, and drops files that give no version", async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-cmake-"));

    try
    {
        const programFiles = path.join(folder, "cmake.exe");
        const broken = path.join(folder, "broken.exe");
        writeFileSync(programFiles, "");
        writeFileSync(broken, "");

        const installations = await probeCandidates(
            [
                { path: programFiles, source: "Program Files" },
                { path: broken, source: "Scoop" },
                { path: programFiles, source: "PATH" }
            ],
            async file => file === programFiles ? "3.31.2" : "");

        assert.equal(installations.length, 1);
        assert.equal(installations[0]?.source, "Program Files");
        assert.equal(installations[0]?.isOnPath, true);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("finds the CMake installations of this computer", async () =>
{
    const { result } = await findCMake(currentEnvironment());
    assert.equal(result.component, "CMake");

    //Whatever is installed here: a result is either installations with one chosen, or none with a fix
    if ("ok" === result.status)
    {
        assert.ok(0 < result.installations.length);
        assert.ok(0 <= result.chosenIndex);
        assert.match(result.installations[result.chosenIndex]?.version ?? "", /^\d+\.\d+/);
    }
    else
    {
        assert.equal(result.chosenIndex, -1);
        assert.ok(0 < result.fixes.length);
    }
});
