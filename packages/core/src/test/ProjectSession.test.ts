import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProjectSnapshot } from "@retrofuturagui/roux-protocol";
import { findProjectFolder, ProjectSession } from "../project/ProjectSession.js";

function temporaryFolder(): string
{
    return mkdtempSync(path.join(os.tmpdir(), "roux-project-"));
}

//Resolves with the next outside change, or undefined when none comes within the time
function nextChange(changes: ProjectSnapshot[], milliseconds: number): Promise<ProjectSnapshot | undefined>
{
    const count = changes.length;

    return new Promise(resolve =>
    {
        const started = Date.now();
        const timer = setInterval(() =>
        {
            if (changes.length > count || Date.now() - started > milliseconds)
            {
                clearInterval(timer);
                resolve(changes[count]);
            }
        }, 25);
    });
}

test("creates the project's files, edits them and reports only outside changes", { timeout: 20000 }, async () =>
{
    const folder = path.join(temporaryFolder(), "Test Project");
    mkdirSync(folder);
    const changes: ProjectSnapshot[] = [];
    const session = new ProjectSession(folder, "Windows", snapshot => changes.push(snapshot));

    try
    {
        const empty = await session.load();
        assert.equal(empty.project.exists, false);
        assert.equal(empty.project.values, undefined);
        assert.equal(empty.app, undefined);

        const created = await session.createProject();
        assert.equal(created.project.values?.name, "Test_Project");
        assert.equal(created.app?.relativePath, "App/App.bechaml");
        assert.equal(created.app?.exists, false);

        const withApp = await session.createApp();
        assert.deepEqual(withApp.app?.values?.scopes.All?.renderers, ["OpenGL"]);

        const written = await session.editProject({ key: "version", value: "1.2.3" });
        assert.ok(written.isWritten);
        assert.equal(written.snapshot.project.values?.version, "1.2.3");
        assert.ok(readFileSync(path.join(folder, "Project.bechaml"), "utf8").includes("<Version>\"1.2.3\"</Version>"));

        const refused = await session.editProject({ key: "version", value: "1.2" });
        assert.equal(refused.isWritten, false);
        assert.equal(refused.message, "Needs three numbers: major.minor.patch (0.1.0).");

        const appEdit = await session.editApp({ kind: "set", scope: "Windows", key: "transitions", value: "On" });
        assert.ok(appEdit.isWritten);
        assert.deepEqual(appEdit.snapshot.app?.values?.scopes.Windows, { transitions: "On" });

        assert.equal(await nextChange(changes, 600), undefined, "Roux's own writes aren't outside changes");

        const file = path.join(folder, "Project.bechaml");
        writeFileSync(file, readFileSync(file, "utf8").replace("\"1.2.3\"", "\"2.0.0\""));
        const outside = await nextChange(changes, 5000);
        assert.equal(outside?.project.values?.version, "2.0.0");

        writeFileSync(file, "<Project>\n    <Name>5</Name>\n</Project>\n");
        const broken = await nextChange(changes, 5000);
        assert.equal(broken?.project.values, undefined);
        assert.deepEqual(broken?.project.problems, [{ line: 2, column: 11, message: "<Name> holds a string, such as \"MyApp\"." }]);

        const blocked = await session.editProject({ key: "version", value: "3.0.0" });
        assert.equal(blocked.isWritten, false);
        assert.equal(blocked.message, "Project.bechaml can't be edited: line 2: <Name> holds a string, such as \"MyApp\".");
    }
    finally
    {
        session.close();
        rmSync(path.dirname(folder), { recursive: true, force: true });
    }
});

test("finds the project folder from a folder inside it", async () =>
{
    const root = temporaryFolder();

    try
    {
        mkdirSync(path.join(root, "Project", "Roux", "cli"), { recursive: true });
        writeFileSync(path.join(root, "Project", "CMakeLists.txt"), "");
        assert.equal(await findProjectFolder(path.join(root, "Project", "Roux", "cli")), path.join(root, "Project"));

        writeFileSync(path.join(root, "Project", "Roux", "Project.bechaml"), "<Project/>");
        assert.equal(await findProjectFolder(path.join(root, "Project", "Roux", "cli")), path.join(root, "Project", "Roux"));
    }
    finally
    {
        rmSync(root, { recursive: true, force: true });
    }
});
