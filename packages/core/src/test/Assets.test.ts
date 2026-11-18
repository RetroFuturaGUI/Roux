import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AssetSession, reference } from "../project/Assets.js";

//A project with one asset folder holding two pictures and a file that isn't one, and RetroFuturaGUI's premade Resources
function assetProject(): { folder: string; session: AssetSession }
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-assets-"));
    mkdirSync(path.join(folder, "Assets", "Images"), { recursive: true });
    writeFileSync(path.join(folder, "Assets", "Images", "Logo.png"), Buffer.from([137, 80, 78, 71]));
    writeFileSync(path.join(folder, "Assets", "Images", "My Icon.svg"), "<svg/>");
    writeFileSync(path.join(folder, "Assets", "Notes.txt"), "not a picture");
    mkdirSync(path.join(folder, "RetroFuturaGUI", "Resources", "Images"), { recursive: true });
    writeFileSync(path.join(folder, "RetroFuturaGUI", "Resources", "Images", "Pattern.png"), "");
    return { folder: folder, session: new AssetSession(folder, async () => ["Assets"]) };
}

test("lists the project's pictures and RetroFuturaGUI's, read-only, with the references markup names them by", async () =>
{
    const { folder, session } = assetProject();

    try
    {
        const list = await session.list();
        assert.ok(list.sections.every(section => section.files.every(file => 0 < file.modified)), "each file says when it was written");

        for (const section of list.sections)
            section.files = section.files.map(file => ({ ...file, modified: 0 }));

        assert.equal(list.destination, "Assets/Images");
        assert.ok(list.extensions.includes(".png") && list.extensions.includes(".svg") && !list.extensions.includes(".obj"), "pictures only, no models");
        assert.deepEqual(list.sections,
        [
            {
                folder: "Assets",
                isReadOnly: false,
                files:
                [
                    { path: "Images/Logo.png", size: 4, modified: 0, reference: "Assets.Images.Logo.png" },
                    { path: "Images/My Icon.svg", size: 6, modified: 0, reference: "\"Images/My Icon.svg\"" }
                ]
            },
            { folder: "RetroFuturaGUI/Resources", isReadOnly: true, files: [{ path: "Images/Pattern.png", size: 0, modified: 0, reference: "RetroFuturaGUI.Images.Pattern.png" }] }
        ]);

        assert.equal(reference("Assets", "Logo.v2.png"), "\"Logo.v2.png\"", "a dot in the name can't be a reference");
        assert.equal(reference("Assets", "3D/Logo.png"), "\"3D/Logo.png\"", "nor a folder starting with a digit");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("shows a listed picture as a data: URL and refuses anything outside the asset folders", async () =>
{
    const { folder, session } = assetProject();

    try
    {
        assert.equal((await session.preview("Assets", "Images/Logo.png")).dataUrl, "data:image/png;base64,iVBORw==");
        assert.equal((await session.preview("Assets", "Images/My Icon.svg")).dataUrl, "data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64"));
        await assert.rejects(session.preview("Assets", "../Project.bechaml"), /isn't in an asset folder/);
        await assert.rejects(session.preview("Elsewhere", "Logo.png"), /isn't in an asset folder/);
        await assert.rejects(session.preview("Assets", "Notes.txt"), /isn't a picture/);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("adds a file in pieces, keeping both or replacing one whose name is taken", async () =>
{
    const { folder, session } = assetProject();
    const images = path.join(folder, "Assets", "Images");

    try
    {
        assert.deepEqual(await session.clashes(["Logo.png", "New.png"]), { clashes: ["Logo.png"] });

        const kept = await session.uploadStart("Logo.png", "keepBoth");
        assert.equal(kept.savedAs, "Assets/Images/Logo 2.png");
        assert.deepEqual(await session.uploadChunk(kept.uploadId, Buffer.from("first ").toString("base64")), { received: 6 });
        assert.deepEqual(await session.uploadChunk(kept.uploadId, Buffer.from("second").toString("base64")), { received: 12 });
        assert.equal(readFileSync(path.join(images, "Logo.png")).length, 4, "nothing is in place before the upload ends");
        assert.deepEqual(await session.uploadEnd(kept.uploadId), { savedAs: "Assets/Images/Logo 2.png" });
        assert.equal(readFileSync(path.join(images, "Logo 2.png"), "utf8"), "first second");
        await assert.rejects(session.uploadChunk(kept.uploadId, ""), /There is no upload/, "an ended upload is gone");

        const replaced = await session.uploadStart("Logo.png", "replace");
        await session.uploadChunk(replaced.uploadId, Buffer.from("new").toString("base64"));
        assert.deepEqual(await session.uploadEnd(replaced.uploadId), { savedAs: "Assets/Images/Logo.png" });
        assert.equal(readFileSync(path.join(images, "Logo.png"), "utf8"), "new");

        await assert.rejects(session.uploadStart("../Logo.png", "keepBoth"), /isn't a file name/);
        await assert.rejects(session.uploadStart("Notes.txt", "keepBoth"), /isn't a picture the library loads/);
        await assert.rejects(new AssetSession(folder, async () => []).uploadStart("Logo.png", "keepBoth"), /names no asset folder/);
    }
    finally
    {
        await session.close();
        rmSync(folder, { recursive: true, force: true });
    }
});
