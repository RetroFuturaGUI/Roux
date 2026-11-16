import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkPaths } from "../Check.js";

test("checks every .bechaml file in a folder and reports errors as file:line:column", async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-check-"));

    try
    {
        mkdirSync(path.join(folder, "Scenes"));
        mkdirSync(path.join(folder, "node_modules"));
        mkdirSync(path.join(folder, ".git"));
        writeFileSync(path.join(folder, "Project.bechaml"), "<Project>\n    <Name>\"Test\"</Name>\n</Project>\n");
        writeFileSync(path.join(folder, "Scenes", "Main.bechaml"), "<Scene>\n    <Button Position=Top/>\n</Scene>\n");
        writeFileSync(path.join(folder, "Scenes", "Latin1.bechaml"), Buffer.from([0x3C, 0x41, 0xE9, 0x2F, 0x3E]));
        writeFileSync(path.join(folder, "Scenes", "Notes.txt"), "not read");
        writeFileSync(path.join(folder, "node_modules", "Skipped.bechaml"), "<");
        writeFileSync(path.join(folder, ".git", "Skipped.bechaml"), "<");

        const report = await checkPaths([".", "Missing.bechaml"], folder);

        assert.equal(report.fileCount, 3);
        assert.equal(report.errorCount, 3);
        assert.deepEqual(report.lines,
            [
                "Missing.bechaml: error: There is no such file or folder.",
                path.join("Scenes", "Latin1.bechaml") + ": error: The file isn't UTF-8.",
                path.join("Scenes", "Main.bechaml") + ":2:22: error: Top needs quotes: \"Top\". Text and enum values are strings."
            ]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});
