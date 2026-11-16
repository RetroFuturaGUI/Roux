import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { generateNeed, generateProject } from "../generate/Generator.js";
import { newProjectText } from "../project/ProjectFile.js";
import { schemaVersion, type Schema, type SchemaClass } from "../schema/Schema.js";
import { headersHash } from "../schema/SchemaFile.js";

const signal = { connect: "Connect_OnClick", slot: "typename Signal<>::Slot" };

function schemaClass(cpp: string, header: string, role: SchemaClass["role"], rest: Partial<SchemaClass> = {}): SchemaClass
{
    return { cpp: "RetroFuturaGUI::" + cpp, header: header, role: role, bases: [], parts: {}, setters: {}, signals: {}, slots: {}, fields: {}, constructorArgs: [], ...rest };
}

//The library as far as the scenes below use it, in Schema.json's form
async function testSchema(libraryFolder: string): Promise<Schema>
{
    const colors = { call: "SetColors", params: [{ name: "colors", type: "std::span<const glm::vec4>" }, { name: "state", type: "ColorState", isState: true }] };

    return {
        schemaVersion: schemaVersion,
        headersHash: await headersHash(path.join(libraryFolder, "source")),
        enums:
        {
            ColorState: { cpp: "RetroFuturaGUI::ColorState", header: "OpenGlHelpers/IncludeHelper.hpp", values: ["Enabled", "Hover", "Clicked"] },
            FontSizeUnit: { cpp: "RetroFuturaGUI::FontSizeUnit", header: "Text/FontManager.hpp", values: ["Pixels", "Points"] },
            SizingMode: { cpp: "RetroFuturaGUI::SizingMode", header: "OpenGlHelpers/IncludeHelper.hpp", values: ["FIXED", "FILL"] },
            "MenuBar::FlexSizing": { cpp: "RetroFuturaGUI::MenuBar::FlexSizing", header: "Widgets/Containers/MenuBar.hpp", values: ["Star", "Fixed", "Square"] }
        },
        classes:
        {
            Window: schemaClass("Window", "Widgets/Window/Window.hpp", "window",
            {
                parts: { Background: { getter: "GetBackground", type: "Background" } },
                setters: { Title: [{ call: "SetWindowTitle", params: [{ name: "title", type: "std::string_view" }] }] },
                slots: { Maximize: { call: "ToggleMaximize", params: [] } }
            }),
            Scene: schemaClass("Scene", "Scenes/Scene.hpp", "scene", { signals: { OnUpdate: { connect: "Connect_OnUpdate", slot: "typename Signal<>::Slot" } } }),
            Lasagna: schemaClass("Lasagna", "Widgets/Containers/Lasagna.hpp", "widget", { constructorArgs: [{ name: "axisDefinition", type: "AxisDefinition" }], container: { add: "AddWidget", placement: "CellPlacement" } }),
            MenuBar: schemaClass("MenuBar", "Widgets/Containers/MenuBar.hpp", "widget", { container: { add: "AddWidget", placement: "uSize", children: { call: "SetFlexDefinition", type: "MenuBar::FlexDefinition" } } }),
            Button: schemaClass("Button", "Widgets/Button.hpp", "widget",
            {
                parts: { Text: { getter: "GetText", type: "WidgetText" }, Background: { getter: "GetBackground", type: "Background" } },
                setters:
                {
                    Enabled: [{ call: "SetEnabled", params: [{ name: "enable", type: "bool" }, { name: "emitSignal", type: "bool" }] }],
                    Rotation: [{ call: "SetRotation", params: [{ name: "rotation", type: "glm::vec3" }] }]
                },
                signals: { OnClick: signal, OnFilesDropped: { connect: "Connect_OnFilesDropped", slot: "typename Signal<std::vector<std::string>, glm::vec2>::Slot" } }
            }),
            WidgetText: schemaClass("WidgetText", "Widgets/Parts/WidgetText.hpp", "part",
            {
                setters:
                {
                    String: [{ call: "SetString", params: [{ name: "string", type: "std::string_view" }, { name: "emitSignal", type: "bool" }] }],
                    FontSize: [{ call: "SetFontSize", params: [{ name: "size", type: "f32" }, { name: "sizeUnit", type: "FontSizeUnit" }], group: ["FontSize", "FontUnit"], defaults: { sizeUnit: "Pixels" } }],
                    Colors: [colors]
                }
            }),
            Background: schemaClass("Background", "Widgets/Parts/Background.hpp", "part", { setters: { Colors: [colors], CornerRadii: [{ call: "SetCornerRadii", params: [{ name: "radii", type: "glm::vec4" }] }] } }),
            CellPlacement: schemaClass("CellPlacement", "Widgets/Containers/Lasagna.hpp", "placement", { fields: { Row: { member: "_Row", type: "u32", default: "0" }, Column: { member: "_Column", type: "u32", default: "0" }, SizingMode: { member: "_SizingMode", type: "SizingMode", default: "\"FILL\"" } } }),
            AxisDefinition: schemaClass("AxisDefinition", "Widgets/Containers/Lasagna.hpp", "struct", { fields: { Rows: { member: "_RowDefinition", type: "std::vector<f32>", default: "{ }" }, Columns: { member: "_ColumnDefinition", type: "std::vector<f32>", default: "{ }" } } }),
            "MenuBar::FlexDefinition": schemaClass("MenuBar::FlexDefinition", "Widgets/Containers/MenuBar.hpp", "struct", { fields: { FlexSizing: { member: "_FlexSizing", type: "FlexSizing", default: "\"Fixed\"" }, Width: { member: "_Width", type: "f32", default: "1.0" } } })
        }
    };
}

const menuScene = [
    "<Scene Name=\"MenuScene\" OnUpdate=Slots.Tick>",
    "    <Slot>void Tick()</Slot>",
    "    <Slot Async>void Save()</Slot>",
    "    <Lasagna Name=\"RootLasagna\" Rows=2 Columns={ 0.25, 0.75 }>",
    "        <Button Name=\"OkButton\" Row=1 Column=1 OnClick={ Slots.Save, Scenes.OtherScene }>",
    "            <Text String=\"OK\" FontSize=20.0 Colors:Hover=#FF000080/>",
    "            <Background Colors={ 1.0, 0.5, 0.0 } CornerRadii={ 4.0, 4.0, 4.0, 4.0 }/>",
    "        </Button>",
    "        <MenuBar Name=\"Bar\" Row=0 Column=0>",
    "            <Button Name=\"Grow\" FlexSizing=\"Star\" Width=2.0 OnClick=Window.Maximize RotateY=-12.0 RotateZ=2.0/>",
    "            <Button Name=\"Fixed\" Enabled=False/>",
    "        </MenuBar>",
    "    </Lasagna>",
    "</Scene>",
    ""].join("\n");

const otherScene = "<Scene Name=\"OtherScene\">\n    <Lasagna Rows=1 Columns=1/>\n</Scene>\n";

async function sceneProject(): Promise<string>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-scenes-"));
    writeFileSync(path.join(folder, "Project.bechaml"), newProjectText("App", "Windows"));
    mkdirSync(path.join(folder, "RetroFuturaGUI"));
    writeFileSync(path.join(folder, "RetroFuturaGUI", "Schema.json"), JSON.stringify(await testSchema(path.join(folder, "RetroFuturaGUI"))));
    mkdirSync(path.join(folder, "source", "code", "Scenes"), { recursive: true });
    writeFileSync(path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml"), menuScene);
    writeFileSync(path.join(folder, "source", "code", "Scenes", "OtherScene.bechaml"), otherScene);
    return folder;
}

const read = (folder: string, relative: string) => readFileSync(path.join(folder, ...relative.split("/")), "utf8");

test("generates a scene's base class, its setup with #line back to the markup, and the user's class with slot stubs", async () =>
{
    const folder = await sceneProject();

    try
    {
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const written = result.written.map(file => path.relative(folder, file).split(path.sep).join("/")).sort();
        assert.deepEqual(written,
        [
            "CMakeLists.txt",
            "source/code/Scenes/MenuScene.cpp",
            "source/code/Scenes/MenuScene.hpp",
            "source/code/Scenes/OtherScene.cpp",
            "source/code/Scenes/OtherScene.hpp",
            "source/generated/Project.cmake",
            "source/generated/impl/Scenes/GeneratedScene.cpp",
            "source/generated/impl/Scenes/GeneratedScene.hpp",
            "source/generated/impl/Scenes/MenuScene_p.hpp",
            "source/generated/impl/Scenes/MenuScene_setup.cpp",
            "source/generated/impl/Scenes/OtherScene_p.hpp",
            "source/generated/impl/Scenes/OtherScene_setup.cpp"
        ]);

        assert.ok(read(folder, "source/generated/Project.cmake").includes("\"${PROJECT_SOURCE_DIR}/source/generated/impl/Scenes/MenuScene_setup.cpp\""), "what Generate writes is listed in the same run");

        const header = read(folder, "source/generated/impl/Scenes/MenuScene_p.hpp");
        assert.ok(header.startsWith("//Generated by Roux from source/code/Scenes/MenuScene.bechaml."));
        assert.ok(header.includes("    class MenuScene_p : public GeneratedScene\n"));
        assert.ok(header.includes("        RetroFuturaGUI::WidgetReference<RetroFuturaGUI::Button> _okButton { nullptr };\n"));
        assert.ok(header.includes("        virtual void Tick() = 0;\n        virtual void Save() = 0;\n        virtual void LoadOtherScene() = 0;\n"));
        assert.ok(header.includes("        void setupGrow(RetroFuturaGUI::MenuBar& bar);\n"));

        const setup = read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp");
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml").split(path.sep).join("/");
        const lines = setup.split("\n");
        const statement = (text: string) => lines.findIndex(line => line.includes(text));
        const directiveBefore = (text: string) => lines.slice(0, statement(text)).reverse().find(line => line.startsWith("#line"));

        assert.ok(setup.includes("_scene->SetLasagnaAxis(RetroFuturaGUI::AxisDefinition { ._RowDefinition = { 0.5f, 0.5f }, ._ColumnDefinition = { 0.25f, 0.75f } }, _parentWindow->GetProjection());"), "Rows=2 is two tracks, each half the size");
        assert.ok(setup.includes("_scene->Connect_OnUpdate([this]() { Tick(); }, false);"));
        assert.ok(setup.includes("_okButton = rootLasagna.AddWidget<RetroFuturaGUI::Button>(\"OkButton\", RetroFuturaGUI::CellPlacement { ._Row = 1, ._Column = 1, ._SizingMode = RetroFuturaGUI::SizingMode::FILL });"));
        assert.ok(setup.includes("okButton->Connect_OnClick([this]() { Save(); }, true);"), "an Async slot runs on its own thread");
        assert.ok(setup.includes("okButton->Connect_OnClick([this]() { LoadOtherScene(); }, false);"));
        assert.ok(setup.includes("okButton->GetText().SetString(\"OK\", false);"), "markup never fires a signal");
        assert.ok(setup.includes("okButton->GetText().SetFontSize(20.0f, RetroFuturaGUI::FontSizeUnit::Pixels);"), "a group's default fills what's left out");
        assert.ok(setup.includes("okButton->GetText().SetColors(std::array { glm::vec4(1.0f, 0.0f, 0.0f, 0.501961f) }, RetroFuturaGUI::ColorState::Hover);"));
        assert.ok(setup.includes("okButton->GetBackground().SetColors(std::array { glm::vec4(1.0f, 0.5f, 0.0f, 1.0f) }, RetroFuturaGUI::ColorState::Enabled);"), "a list with a decimal point is 0 to 1, three numbers are opaque");
        assert.ok(setup.includes("okButton->GetBackground().SetCornerRadii(glm::vec4(4.0f, 4.0f, 4.0f, 4.0f));"));
        assert.ok(setup.includes("        RetroFuturaGUI::MenuBar::FlexDefinition { ._FlexSizing = RetroFuturaGUI::MenuBar::FlexSizing::Star, ._Width = 2.0f },\n"));
        assert.ok(setup.includes("        RetroFuturaGUI::MenuBar::FlexDefinition { ._FlexSizing = RetroFuturaGUI::MenuBar::FlexSizing::Fixed, ._Width = 1.0f }\n"), "a field left out takes its default");
        assert.ok(setup.includes("bar->SetFlexDefinition(barChildren);"));
        assert.ok(setup.includes("_grow = bar.AddWidget<RetroFuturaGUI::Button>(\"Grow\", 0);"), "a MenuBar's child goes by its index");
        assert.ok(setup.includes("grow->Connect_OnClick([this]() { callWindowSlot(&RetroFuturaGUI::Window::ToggleMaximize); }, false);"));
        assert.ok(setup.includes("grow->SetRotation(glm::vec3(0.0f, -12.0f, 2.0f));"), "RotateY and RotateZ are one rotation, the axis left out 0");
        assert.ok(setup.includes("fixed->SetEnabled(false, false);"));
        assert.equal(directiveBefore("okButton->GetText().SetString"), "#line 6 \"" + markup + "\"");

        //A line that comes from no markup counts as the generated file's own line again.
        const back = lines.findIndex(line => line.startsWith("#line") && line.endsWith("MenuScene_setup.cpp\""));
        assert.equal(Number(lines[back]?.split(" ")[1]), back + 2);

        assert.equal(read(folder, "source/code/Scenes/MenuScene.hpp"), [
            "#pragma once",
            "#include \"MenuScene_p.hpp\"",
            "",
            "namespace App",
            "{",
            "    class MenuScene final : public MenuScene_p",
            "    {",
            "    public:",
            "        explicit MenuScene(RetroFuturaGUI::Window* parentWindow) : MenuScene_p(parentWindow) {}",
            "",
            "    privateSlots:",
            "        void Tick() override;",
            "        void Save() override;",
            "        void LoadOtherScene() override;",
            "    };",
            "}",
            ""].join("\n"));

        assert.ok(read(folder, "source/code/Scenes/MenuScene.cpp").includes("void App::MenuScene::LoadOtherScene()\n{\n    loadScene(\"OtherScene\");\n}\n"), "a scene's slot starts out loading it");
        assert.deepEqual((await generateProject(folder)).written, [], "nothing changed, so nothing is written");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("gives the user's class only the slots it lacks, keeps its bodies, and regenerates after a markup change", async () =>
{
    const folder = await sceneProject();

    try
    {
        await generateProject(folder);
        const userSource = path.join(folder, "source", "code", "Scenes", "MenuScene.cpp");
        const userHeader = path.join(folder, "source", "code", "Scenes", "MenuScene.hpp");
        writeFileSync(userSource, readFileSync(userSource, "utf8").replace("void App::MenuScene::Tick()\n{\n}", "void App::MenuScene::Tick()\n{\n    ++_ticks;\n}"));
        assert.equal(await generateNeed(folder), "changed", "the user's class is read too");
        await generateProject(folder);
        assert.equal(await generateNeed(folder), "unchanged");

        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        writeFileSync(markup, menuScene.replace("    <Slot Async>void Save()</Slot>", "    <Slot Async>void Save()</Slot>\n    <Slot>int Count(int start)</Slot>"));
        assert.equal(await generateNeed(folder), "changed");
        assert.deepEqual((await generateProject(folder)).problems, []);

        const header = readFileSync(userHeader, "utf8");
        assert.ok(header.includes("    privateSlots:\n        int Count(int start) override;\n        void Tick() override;\n"));
        assert.equal(header.match(/Tick\(\)/g)?.length, 1, "a slot that's declared stays as it is");

        const source = readFileSync(userSource, "utf8");
        assert.ok(source.includes("void App::MenuScene::Tick()\n{\n    ++_ticks;\n}"), "a body stays");
        assert.ok(source.endsWith("\nint App::MenuScene::Count(int start)\n{\n    return {};\n}\n"));
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("reports a scene's mistakes where they are, and leaves a file it didn't write alone", async () =>
{
    const folder = await sceneProject();

    try
    {
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        writeFileSync(markup, menuScene
            .replace("OnClick={ Slots.Save, Scenes.OtherScene }", "OnClick={ Slots.Missing, Scenes.Nowhere } Sparkle=True")
            .replace("FontSize=20.0", "FontUnit=\"Points\"")
            .replace("Width=2.0", "Width=\"wide\"")
            .replace("Enabled=False", "Enabled=False OnFilesDropped=Slots.Tick"));

        const messages = (await generateProject(folder)).problems.map(problem => path.basename(problem.file) + ":" + problem.line + ":" + problem.column + " " + problem.message);
        //OnFilesDropped=Slots.Tick is fine: a slot without parameters ignores what the signal hands over.
        assert.deepEqual(messages,
        [
            "MenuScene.bechaml:5:58 The scene declares no slot Missing: add <Slot>void Missing()</Slot>.",
            "MenuScene.bechaml:5:73 No scene is named Nowhere.",
            "MenuScene.bechaml:5:90 Button has no Sparkle.",
            "MenuScene.bechaml:6:31 FontUnit goes with FontSize.",
            "MenuScene.bechaml:10:57 This takes a number."
        ]);
        assert.ok(!exists(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp"), "nothing is written while a scene has an error");

        writeFileSync(markup, menuScene);
        mkdirSync(path.join(folder, "source", "generated", "impl", "Scenes"), { recursive: true });
        writeFileSync(path.join(folder, "source", "generated", "impl", "Scenes", "OtherScene_p.hpp"), "//Written by hand.\n");
        const refused = await generateProject(folder);
        assert.deepEqual(refused.problems.map(problem => path.basename(problem.file) + " " + problem.message), ["OtherScene_p.hpp Roux didn't write this file, so it doesn't overwrite it: move it away, or rename the scene."]);
        assert.equal(read(folder, "source/generated/impl/Scenes/OtherScene_p.hpp"), "//Written by hand.\n");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("removes what it generated for a scene that's gone, and nothing it didn't write", async () =>
{
    const folder = await sceneProject();

    try
    {
        await generateProject(folder);
        const handWritten = path.join(folder, "source", "generated", "impl", "Scenes", "Model.cpp");
        writeFileSync(handWritten, "//Written by hand.\n");

        rmSync(path.join(folder, "source", "code", "Scenes", "OtherScene.bechaml"));
        const menu = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        writeFileSync(menu, menuScene.replace("{ Slots.Save, Scenes.OtherScene }", "Slots.Save"));

        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);
        assert.deepEqual(result.removed.map(file => path.basename(file)).sort(), ["OtherScene_p.hpp", "OtherScene_setup.cpp"]);
        assert.ok(!exists(folder, "source/generated/impl/Scenes/OtherScene_setup.cpp"));
        assert.ok(!read(folder, "source/generated/Project.cmake").includes("OtherScene_setup.cpp"), "what goes isn't compiled");
        assert.ok(read(folder, "source/generated/Project.cmake").includes("Model.cpp"), "a file Roux didn't write stays, and is still compiled");
        assert.ok(exists(folder, "source/code/Scenes/OtherScene.hpp"), "the user's class is the user's to remove");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

const appWindow = [
    "<Window Name=\"AppWindow\" Title=\"App\" Width=1280 Height=720>",
    "    <Background Colors=#102030/>",
    "    <Scene Name=\"MenuScene\" Start/>",
    "    <Scene Name=\"OtherScene\"/>",
    "</Window>",
    ""].join("\n");

//The sceneProject with a window file, named by Project.bechaml as the start window.
async function windowProject(window: string): Promise<string>
{
    const folder = await sceneProject();
    mkdirSync(path.join(folder, "source", "code", "Windows"));
    writeFileSync(path.join(folder, "source", "code", "Windows", "AppWindow.bechaml"), window);
    const project = path.join(folder, "Project.bechaml");
    writeFileSync(project, readFileSync(project, "utf8").replace("<StartWindow>\"\"</StartWindow>", "<StartWindow>\"source/code/Windows/AppWindow.bechaml\"</StartWindow>"));
    return folder;
}

test("generates a window that builds the scenes it lists and swaps them, and the start function that opens it", async () =>
{
    const folder = await windowProject(appWindow);

    try
    {
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const setup = read(folder, "source/generated/impl/Windows/AppWindow_setup.cpp");
        assert.ok(setup.includes("#include \"MenuScene.hpp\"\n#include \"OtherScene.hpp\"\n"));
        assert.ok(setup.includes("    _window = std::make_unique<RetroFuturaGUI::Window>(\"AppWindow\", 1280, 720);\n"));
        assert.ok(setup.includes("    _window->SetWindowTitle(\"App\");\n"));
        assert.ok(setup.includes("_window->GetBackground().SetColors(std::array { glm::vec4(0.062745f, 0.12549f, 0.188235f, 1.0f) }, RetroFuturaGUI::ColorState::Enabled);"));
        assert.ok(setup.includes("    showScene(\"MenuScene\");\n"), "a Start scene is shown from the beginning");
        assert.ok(!setup.includes("showScene(\"OtherScene\")"), "the others wait until they're loaded");
        assert.ok(setup.includes("    if(\"OtherScene\" == sceneName)\n"));
        assert.ok(setup.includes("        return GeneratedScene::Create<OtherScene>(_window.get(), sceneRequest());\n"));
        assert.ok(setup.includes("    return \"MenuScene\" == sceneName || \"OtherScene\" == sceneName;\n"));

        assert.ok(read(folder, "source/generated/impl/Windows/AppWindow_p.hpp").includes("    class AppWindow_p : public GeneratedWindow\n"));
        assert.ok(read(folder, "source/code/Windows/AppWindow.hpp").includes("    class AppWindow final : public AppWindow_p\n    {\n    public:\n        AppWindow() = default;\n"));
        assert.ok(read(folder, "source/generated/impl/Windows/GeneratedWindow.cpp").includes("_window->InsertScene(scene->GetScene(), index);"), "a scene that's loaded takes the place of the one that asked");

        const start = read(folder, "source/generated/impl/Start.cpp");
        assert.ok(start.includes("#include \"AppWindow.hpp\"\n"));
        assert.ok(start.includes("windows.push_back(GeneratedWindow::Create<AppWindow>());"));
        assert.ok(read(folder, "source/generated/Project.cmake").includes("\"${PROJECT_SOURCE_DIR}/source/generated/impl/Start.cpp\""));
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("reports a window that misses a scene its scenes load, and a start window that isn't one", async () =>
{
    const folder = await windowProject(appWindow.replace("    <Scene Name=\"OtherScene\"/>\n", "    <Scene Name=\"Elsewhere\"/>\n"));

    try
    {
        const project = path.join(folder, "Project.bechaml");
        writeFileSync(project, readFileSync(project, "utf8").replace("AppWindow.bechaml", "Missing.bechaml"));
        const messages = (await generateProject(folder)).problems.map(problem => path.basename(problem.file) + ":" + problem.line + " " + problem.message);

        assert.deepEqual(messages,
        [
            "AppWindow.bechaml:4 No scene is named Elsewhere.",
            "AppWindow.bechaml:3 MenuScene loads OtherScene, which AppWindow doesn't list.",
            "Project.bechaml:" + (readFileSync(project, "utf8").split("\n").findIndex(line => line.includes("<StartWindow>")) + 1) + " <StartWindow> names source/code/Windows/Missing.bechaml, which isn't a window file that could be generated."
        ]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

function exists(folder: string, relative: string): boolean
{
    try
    {
        readFileSync(path.join(folder, ...relative.split("/")));
        return true;
    }
    catch
    {
        return false;
    }
}
