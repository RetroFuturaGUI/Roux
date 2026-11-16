import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBechaml } from "../bechaml/Parser.js";
import { editAppSettings, isAppEdit, newAppSettingsText, readAppSettings } from "../project/AppSettingsFile.js";
import { editProject, isProjectEdit, newProjectText, readProject } from "../project/ProjectFile.js";

const fixture = (name: string) => readFileSync(new URL("../../src/test/fixtures/" + name, import.meta.url), "utf8");

test("reads the plan's Project.bechaml into the Project tab's values", () =>
{
    const { values, problems } = readProject(parseBechaml(fixture("Project.bechaml")));

    assert.deepEqual(problems, []);
    assert.equal(values.name, "TestProject");
    assert.equal(values.cmakeVersion, "3.16");
    assert.deepEqual(values.platforms, ["Windows", "Linux", "Wii"]);
    assert.deepEqual(values.platformSettings.Wii, { language: "C", standard: "99", compiler: "devkitPPC", compilerFlags: [] });
    assert.equal(values.allowNonRoyaltyFreeCodecs, false);
    assert.deepEqual(values.authors, ["Lawn Meower"]);
    assert.equal(values.removedSlots, "CommentOut");
});

test("reports values of the wrong kind where they are", () =>
{
    const { problems } = readProject(parseBechaml("<Project>\n    <Name>5</Name>\n    <Platforms>\"Windows\"</Platforms>\n</Project>"));
    assert.deepEqual(problems.map(problem => problem.message), ["<Name> holds a string, such as \"TestProject\".", "<Platforms> holds a list of strings, such as { \"Windows\" }."]);

    const wrongRoot = readProject(parseBechaml("<Scene/>"));
    assert.equal(wrongRoot.problems[0]?.message, "Project.bechaml's root element is <Project>, not <Scene>.");
});

test("writes a Project edit in place and refuses an invalid one", () =>
{
    const source = fixture("Project.bechaml");
    const document = parseBechaml(source);

    const version = editProject(document, { key: "version", value: "0.2.0" });
    assert.ok("text" in version);
    assert.equal(version.text, source.replace("<Version>\"0.1.0\"</Version>", "<Version>\"0.2.0\"</Version>"));

    assert.deepEqual(editProject(document, { key: "version", value: "0.2" }), { message: "Needs three numbers: major.minor.patch (0.1.0)." });
    assert.deepEqual(editProject(document, { key: "cmakeVersion", value: "3.10" }), { message: "RetroFuturaGUI needs CMake 3.16 or newer." });
    assert.deepEqual(editProject(document, { key: "platforms", value: ["Windows", "Amiga"] }), { message: "Amiga isn't one of Windows, Linux, macOS, Android, GameCube, Wii, WiiU, Nintendo3DS, Switch, Xbox, Dreamcast, PS2." });
    assert.deepEqual(editProject(document, { key: "platform", platform: "Linux", value: { language: "C++", standard: "23", compiler: "MSVC", compilerFlags: [] } }), { message: "Linux builds with GCC, Clang, not MSVC." });
    assert.deepEqual(editProject(document, { key: "appSettings", value: "App\\App.bechaml" }), { message: "Paths use /, not \\." });
});

test("gives a newly ticked platform a block named after it, with the defaults", () =>
{
    const result = editProject(parseBechaml(fixture("Project.bechaml")), { key: "platforms", value: ["Windows", "Linux", "Wii", "macOS"] });
    assert.ok("text" in result);

    const { values } = readProject(parseBechaml(result.text));
    assert.deepEqual(values.platforms, ["Windows", "Linux", "Wii", "macOS"]);
    assert.deepEqual(values.platformSettings.macOS, { language: "C++", standard: "23", compiler: "Clang", compilerFlags: [] });
    assert.ok(result.text.includes("    </Wii>\n    <macOS>\n        <Language Name=\"C++\" Standard=\"23\"/>\n        <Compiler>\"Clang\"</Compiler>\n    </macOS>\n    <AllowNonRoyaltyFreeCodecs>"));
});

test("reports a block that's neither a setting nor a platform", () =>
{
    const project = readProject(parseBechaml("<Project>\n    <Windws>\n        <Compiler>\"MSVC\"</Compiler>\n    </Windws>\n</Project>"));
    assert.deepEqual(project.problems.map(problem => problem.message), ["<Windws> is neither a setting nor a platform. The platforms are Windows, Linux, macOS, Android, GameCube, Wii, WiiU, Nintendo3DS, Switch, Xbox, Dreamcast, PS2."]);

    const app = readAppSettings(parseBechaml("<AppSettings>\n    <Desktp/>\n    <WiiU/>\n</AppSettings>"), "App.bechaml");
    assert.deepEqual(app.problems.map(problem => problem.message), ["<Desktp> is neither an App Setting nor a platform or group. They are Desktop, Nintendo, Windows, Linux, macOS, Android, GameCube, Wii, WiiU, Nintendo3DS, Switch, Xbox, Dreamcast, PS2."]);
    assert.ok("WiiU" in app.values.scopes);
});

test("creates files that read back without problems", () =>
{
    const project = readProject(parseBechaml(newProjectText("My Project 2", "Linux")));
    assert.deepEqual(project.problems, []);
    assert.equal(project.values.name, "My_Project_2");
    assert.deepEqual(project.values.platformSettings.Linux, { language: "C++", standard: "23", compiler: "GCC", compilerFlags: [] });
    assert.equal(project.values.appSettings, "App/App.bechaml");

    const app = readAppSettings(parseBechaml(newAppSettingsText("Test")), "App.bechaml");
    assert.deepEqual(app.problems, []);
    assert.deepEqual(app.values.scopes.All, { appName: "Test", renderers: ["OpenGL"], requires: [] });
});

test("checks the shape of edits that come from outside the core", () =>
{
    assert.ok(isProjectEdit({ key: "name", value: "A" }));
    assert.ok(isProjectEdit({ key: "platform", platform: "Windows", value: { language: "C", standard: "11", compiler: "MSVC", compilerFlags: ["Wall"] } }));
    assert.ok(!isProjectEdit({ key: "name", value: 5 }));
    assert.ok(!isProjectEdit({ key: "platforms", value: "Windows" }));
    assert.ok(!isProjectEdit({ key: "unknown", value: "A" }));
    assert.ok(!isProjectEdit(null));

    assert.ok(isAppEdit({ kind: "set", scope: "All", key: "appName", value: "A" }));
    assert.ok(isAppEdit({ kind: "charset", index: 0, charset: { name: "Greek", blocks: ["Greek and Coptic"] } }));
    assert.ok(!isAppEdit({ kind: "set", scope: "All", key: "appName", value: 5 }));
    assert.ok(!isAppEdit({ kind: "removeCharset", index: "0" }));
});

test("reads the plan's App Settings per scope", () =>
{
    const { values, problems } = readAppSettings(parseBechaml(fixture("AppSettings.bechaml")), "App.bechaml");

    assert.deepEqual(problems, []);
    assert.deepEqual(values.scopes.All,
        {
            appName: "RetroFuturaGUI Test",
            renderers: ["OpenGL"],
            requires: ["MultiWindow", "FileSystem"],
            layoutFile: "RetroFuturaGUI.ini",
            transitions: "Off",
            fontFamily: "Noto Sans",
            fontSize: "25",
            fontUnit: "Points"
        });
    assert.deepEqual(values.scopes.Desktop, { requires: ["MultiWindow", "FileSystem", "Mouse"] });
    assert.deepEqual(values.scopes.Windows, { renderers: ["DirectX", "OpenGL"], "font:Japanese": "Yu Mincho", "font:Emoji": "Segoe UI Emoji" });
    assert.deepEqual(values.scopes.Wii, { renderers: ["GX"], layoutFile: "" });
    assert.deepEqual(values.charsets.map(charset => charset.name), ["Japanese", "Cyrillic", "Emoji"]);
    assert.deepEqual(values.charsets[1]?.blocks, ["Cyrillic"]);
});

test("sets and resets App Settings in a scope, and removes what a reset empties", () =>
{
    const source = fixture("AppSettings.bechaml");
    const document = parseBechaml(source);
    const { values } = readAppSettings(document, "App.bechaml");

    const set = editAppSettings(document, values, { kind: "set", scope: "Linux", key: "fontSize", value: "18" });
    assert.ok("text" in set);
    assert.ok(set.text.includes("        <CharsetFont Charset=\"Emoji\">\"Noto Color Emoji\"</CharsetFont>\n        <DefaultFont Size=18/>\n    </Linux>"));

    const setDocument = parseBechaml(set.text);
    const reset = editAppSettings(setDocument, readAppSettings(setDocument, "App.bechaml").values, { kind: "reset", scope: "Linux", keys: ["fontSize"] });
    assert.ok("text" in reset);
    assert.equal(reset.text, source);

    const resetBlock = editAppSettings(document, values, { kind: "reset", scope: "Desktop", keys: ["requires"] });
    assert.ok("text" in resetBlock);
    assert.ok(!resetBlock.text.includes("Desktop"), "the emptied <Desktop> goes too");

    assert.deepEqual(editAppSettings(document, values, { kind: "set", scope: "Amiga", key: "fontSize", value: "18" }), { message: "Amiga isn't a platform or group." });

    assert.deepEqual(editAppSettings(document, values, { kind: "set", scope: "All", key: "requires", value: ["Telepathy"] }), { message: "Telepathy isn't one of MultiWindow, FileSystem, Mouse, Keyboard, Touch, Gamepad." });
    assert.deepEqual(editAppSettings(document, values, { kind: "set", scope: "All", key: "fontSize", value: "big" }), { message: "A size is a number above 0, such as 25." });
    assert.deepEqual(editAppSettings(document, values, { kind: "set", scope: "All", key: "renderers", value: "OpenGL" }), { message: "renderers is a list." });
});

test("renames a character set along with its fonts, adds one and removes one", () =>
{
    const document = parseBechaml(fixture("AppSettings.bechaml"));
    const { values } = readAppSettings(document, "App.bechaml");

    const renamed = editAppSettings(document, values, { kind: "charset", index: 0, charset: { name: "Japanese2", blocks: ["Hiragana"] } });
    assert.ok("text" in renamed);

    const after = readAppSettings(parseBechaml(renamed.text), "App.bechaml").values;
    assert.deepEqual(after.charsets[0], { name: "Japanese2", blocks: ["Hiragana"] });
    assert.equal(after.scopes.Windows?.["font:Japanese2"], "Yu Mincho");
    assert.equal(after.scopes.Linux?.["font:Japanese2"], "Noto Sans CJK JP");

    const added = editAppSettings(document, values, { kind: "charset", index: 3, charset: { name: "Greek", blocks: ["Greek and Coptic"] } });
    assert.ok("text" in added);
    assert.deepEqual(readAppSettings(parseBechaml(added.text), "App.bechaml").values.charsets[3], { name: "Greek", blocks: ["Greek and Coptic"] });

    const removed = editAppSettings(document, values, { kind: "removeCharset", index: 2 });
    assert.ok("text" in removed);
    assert.ok(!removed.text.includes("Emoji"));

    assert.deepEqual(editAppSettings(document, values, { kind: "charset", index: 1, charset: { name: "Emoji", blocks: [] } }), { message: "There's a character set named Emoji already." });
});

test("keeps a platform's compiler flags in its block, and refuses ones it doesn't know", () =>
{
    const document = parseBechaml(fixture("Project.bechaml"));
    const flags = { language: "C++", standard: "23", compiler: "GCC", compilerFlags: ["Wall", "Wextra", "Werror"] };

    const result = editProject(document, { key: "platform", platform: "Linux", value: flags });
    assert.ok("text" in result);
    assert.ok(result.text.includes("        <Compiler>\"GCC\"</Compiler>\n        <CompilerFlags>{ \"Wall\", \"Wextra\", \"Werror\" }</CompilerFlags>\n    </Linux>"));
    assert.deepEqual(readProject(parseBechaml(result.text)).values.platformSettings.Linux, flags);

    const cleared = editProject(parseBechaml(result.text), { key: "platform", platform: "Linux", value: { ...flags, compilerFlags: [] } });
    assert.ok("text" in cleared && cleared.text.includes("<CompilerFlags>{ }</CompilerFlags>"), "an existing element is emptied, not left stale");
    assert.ok("text" in editProject(document, { key: "platform", platform: "Wii", value: { language: "C", standard: "99", compiler: "devkitPPC", compilerFlags: [] } }));
    assert.ok(!fixture("Project.bechaml").includes("CompilerFlags"), "no flags, no element");

    assert.deepEqual(editProject(document, { key: "platform", platform: "Linux", value: { ...flags, compilerFlags: ["toString"] } }), { message: "toString isn't one of the compiler flags Wall, Wextra, Wpedantic, Wshadow, Wconversion, Werror." });
    assert.deepEqual(editProject(document, { key: "platform", platform: "Linux", value: { ...flags, compilerFlags: ["Wall", "Wall"] } }), { message: "Wall is listed twice." });
});
