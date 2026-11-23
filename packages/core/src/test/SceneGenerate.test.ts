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
            TransitionProperty: { cpp: "RetroFuturaGUI::TransitionProperty", header: "Animation/Transition.hpp", values: ["Colors", "CornerRadii", "Size"], isMask: true },
            Easing: { cpp: "RetroFuturaGUI::Easing", header: "Animation/Transition.hpp", values: ["Linear", "EaseOut", "EaseInOut"] },
            BorderEdge: { cpp: "RetroFuturaGUI::BorderEdge", header: "Rectangles/Frame.hpp", values: ["Top", "Bottom"] },
            WidgetTypeID: { cpp: "RetroFuturaGUI::WidgetTypeID", header: "OpenGlHelpers/IncludeHelper.hpp", values: ["None", "Lasagna", "Button", "Slider"] },
            StyleScope: { cpp: "RetroFuturaGUI::StyleScope", header: "Styling/StylingManager.hpp", values: ["None", "Popup", "File"] },
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
                    Transition: [{ call: "SetTransition", params: [{ name: "properties", type: "TransitionProperty" }, { name: "transition", type: "Transition" }] }],
                    Rotation: [{ call: "SetRotation", params: [{ name: "rotation", type: "glm::vec3" }] }]
                },
                signals: { OnClick: signal, OnFilesDropped: { connect: "Connect_OnFilesDropped", slot: "typename Signal<std::vector<std::string>, glm::vec2>::Slot" } },
                slots: { Press: { call: "Press", params: [] } }
            }),
            Prefab: schemaClass("Prefab", "Widgets/Containers/Prefab.hpp", "widget"),
            FileExplorer: schemaClass("FileExplorer", "Widgets/Window/Dialog/FileExplorer/FileExplorer.hpp", "popup", { popupScopes: ["File"] }),
            RadioButtonGroup: schemaClass("RadioButtonGroup", "Widgets/Containers/RadioButtonGroup.hpp", "widget",
            {
                setters: { Rows: [{ call: "SetAxisDefinitions", params: [{ name: "rowDefinitions", type: "std::span<const f32>" }, { name: "columnDefinitions", type: "std::span<const f32>" }], group: ["Rows", "Columns"], defaults: { columnDefinitions: "1" } }] },
                container: { add: "AddRadioButton", placement: "glm::i64vec2", widget: "RadioButton" }
            }),
            RadioButton: schemaClass("RadioButton", "Widgets/RadioButton.hpp", "widget",
            {
                parts: { Label: { getter: "GetLabel", type: "Label" } },
                setters: { Value: [{ call: "SetValue", params: [{ name: "value", type: "bool" }, { name: "emitSignal", type: "bool" }] }] },
                constructorArgs: [{ name: "parentGroup", type: "RadioButtonGroup *" }]
            }),
            Label: schemaClass("Label", "Widgets/Label.hpp", "widget", { parts: { Text: { getter: "GetText", type: "WidgetText" } } }),
            ComboBox: schemaClass("ComboBox", "Widgets/ComboBox.hpp", "widget",
            {
                setters:
                {
                    Items: [{ call: "SetItems", params: [{ name: "items", type: "std::span<const std::string_view>" }, { name: "emitSignal", type: "bool" }] }],
                    Modes: [{ call: "SetModes", params: [{ name: "modes", type: "std::span<const SizingMode>" }] }],
                    Names: [{ call: "SetNames", params: [{ name: "names", type: "std::vector<std::string>" }] }],
                    Tracks: [{ call: "SetTracks", params: [{ name: "tracks", type: "std::span<f32>" }] }]
                }
            }),
            Slider: schemaClass("Slider", "Widgets/Slider.hpp", "widget",
            {
                setters:
                {
                    MinValue: [{ call: "SetMinValue", params: [{ name: "value", type: "T" }], template: ["T"] }],
                    Value: [{ call: "SetValue", params: [{ name: "value", type: "T" }, { name: "emitSignal", type: "bool" }], template: ["T"] }]
                },
                slots: { StepUp: { call: "StepUp", params: [{ name: "emitSignal", type: "bool" }] } }
            }),
            WidgetText: schemaClass("WidgetText", "Widgets/Parts/WidgetText.hpp", "part",
            {
                parts: { Glow: { getter: "GetGlow", type: "Glow" } },
                setters:
                {
                    String: [{ call: "SetString", params: [{ name: "string", type: "std::string_view" }, { name: "emitSignal", type: "bool" }] }],
                    FontSize: [{ call: "SetFontSize", params: [{ name: "size", type: "f32" }, { name: "sizeUnit", type: "FontSizeUnit" }], group: ["FontSize", "FontUnit"], defaults: { sizeUnit: "Pixels" } }],
                    Colors: [colors],
                    Image: [{ call: "SetImage", params: [{ name: "path", type: "std::string_view" }] }]
                }
            }),
            Background: schemaClass("Background", "Widgets/Parts/Background.hpp", "part", { parts: { Glow: { getter: "GetGlow", type: "Glow" } }, setters: { GlassNoise: [{ call: "SetGlassNoise", params: [{ name: "noise", type: "GlassNoise" }] }], Gaps: [{ call: "SetGaps", params: [{ name: "gaps", type: "std::span<const BorderGap>" }] }], PathFill: [{ call: "SetImagePathFill", params: [{ name: "name", type: "std::string_view" }, { name: "fill", type: "SvgPathFill" }] }], Colors: [colors], CornerRadii: [{ call: "SetCornerRadii", params: [{ name: "radii", type: "glm::vec4" }] }], Image: [{ call: "SetImage", params: [{ name: "imagePath", type: "std::string_view" }] }] } }),
            Flavor: schemaClass("Flavor", "Styling/Flavor.hpp", "flavor",
            {
                parts: { Background: { getter: "GetBackground", type: "FlavorPart" } },
                setters:
                {
                    Size: [{ call: "SetSize", params: [{ name: "size", type: "glm::vec3" }] }],
                    Transition: [{ call: "SetTransition", params: [{ name: "properties", type: "TransitionProperty" }, { name: "transition", type: "Transition" }] }]
                }
            }),
            FlavorPart: schemaClass("FlavorPart", "Styling/Flavor.hpp", "part", { parts: { Glow: { getter: "GetGlow", type: "FlavorEffect" } }, setters: { Colors: [colors], CornerRadii: [{ call: "SetCornerRadii", params: [{ name: "radii", type: "glm::vec4" }] }] } }),
            FlavorEffect: schemaClass("FlavorEffect", "Styling/Flavor.hpp", "part", { parts: { Flash: { getter: "GetFlash", type: "Flash" } }, setters: { Width: [{ call: "SetWidth", params: [{ name: "value", type: "f32" }] }] } }),
            Transition: schemaClass("Transition", "Animation/Transition.hpp", "struct", { fields: { Duration: { member: "_Duration", type: "std::chrono::milliseconds" }, Easing: { member: "_Easing", type: "Easing", default: "\"EaseInOut\"" } } }),
            GlassNoise: schemaClass("GlassNoise", "Shaders/Noise.hpp", "struct", { fields: { CellSize: { member: "_CellSize", type: "f32", default: "128.0" }, Distortion: { member: "_Distortion", type: "f32", default: "12.0" } } }),
            BorderGap: schemaClass("BorderGap", "Rectangles/Frame.hpp", "struct", { fields: { Edge: { member: "_Edge", type: "BorderEdge", default: "\"Top\"" }, Length: { member: "_Length", type: "f32", default: "0.0" }, Repeat: { member: "_Repeat", type: "i32", default: "1" }, CutsBackground: { member: "_CutsBackground", type: "bool", default: "False" } } }),
            SvgPathFill: schemaClass("SvgPathFill", "OpenGlHelpers/SvgPathFill.hpp", "struct", { fields: { Colors: { member: "_Colors", type: "std::vector<glm::vec4>" } } }),
            Glow: schemaClass("Glow", "Shaders/Glow.hpp", "part", { parts: { Flash: { getter: "GetFlash", type: "Flash" } }, setters: { Colors: [colors] } }),
            Flash: schemaClass("Flash", "Shaders/Flash.hpp", "part",
            {
                setters:
                {
                    On: [{ call: "SetOn", params: [{ name: "state", type: "ColorState" }] }],
                    Opacities: [{ call: "SetOpacities", params: [{ name: "opacities", type: "std::span<const f32>" }] }],
                    Widths: [{ call: "SetWidths", params: [{ name: "widths", type: "std::span<const f32>" }] }],
                    Loop: [{ call: "SetLoop", params: [{ name: "firstStep", type: "uSize" }, { name: "lastStep", type: "uSize" }] }],
                    Repeat: [{ call: "SetRepeat", params: [{ name: "repeatCount", type: "uSize" }] }],
                    StartTime: [{ call: "SetStartTime", params: [{ name: "time", type: "std::chrono::milliseconds" }] }],
                    LoopTime: [{ call: "SetLoopTime", params: [{ name: "time", type: "std::chrono::milliseconds" }] }],
                    EndTime: [{ call: "SetEndTime", params: [{ name: "time", type: "std::chrono::milliseconds" }] }]
                }
            }),
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
    "        <Button Name=\"OkButton\" Row=1 Column=1 OnClick={ Slots.Save, Slots.LoadScene(Scenes.OtherScene), Slots.UnloadScene(Scenes.MenuScene) }>",
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
        assert.ok(header.includes("        virtual void Tick() = 0;\n        virtual void Save() = 0;\n"));
        assert.ok(!header.includes("LoadOtherScene"), "loading a scene needs no slot of the scene's own");
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
        assert.ok(setup.includes("okButton->Connect_OnClick([this](auto&&...) { LoadScene(\"OtherScene\"); }, false);"));
        assert.ok(setup.includes("okButton->Connect_OnClick([this](auto&&...) { UnloadScene(\"MenuScene\"); }, false);"));
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
            "    };",
            "}",
            ""].join("\n"));

        assert.ok(!read(folder, "source/code/Scenes/MenuScene.cpp").includes("LoadOtherScene"), "the user's class gets no stub for loading a scene");
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

test("connects a signal to a function of a named widget with @, and reports an unknown prefab and a stray @ element", async () =>
{
    const folder = await sceneProject();

    try
    {
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        writeFileSync(markup, menuScene.replace("<Button Name=\"Fixed\" Enabled=False/>", "<Button Name=\"Fixed\" Enabled=False OnClick=@OkButton.Press/>"));
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);
        assert.match(read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp"), /Connect_OnClick\(\[this\]\(\) \{ if\(!_okButton\) return; _okButton->Press\(\); \}, false\);/);

        writeFileSync(markup, menuScene
            .replace("OnClick={ Slots.Save, Slots.LoadScene(Scenes.OtherScene), Slots.UnloadScene(Scenes.MenuScene) }", "OnClick={ @Nobody.Press, @Grow.Fly }")
            .replace("<Button Name=\"Fixed\" Enabled=False/>", "<Prefab:Stepper Name=\"Volume\"/>\n            <@Grow Width=1.0/>"));
        const messages = (await generateProject(folder)).problems.map(problem => path.basename(problem.file) + ":" + problem.line + ":" + problem.column + " " + problem.message);
        assert.deepEqual(messages,
        [
            "MenuScene.bechaml:11:13 No prefab is named Stepper; there are none.",
            "MenuScene.bechaml:12:13 <@Grow> sets a named widget of a placed prefab, so it goes inside <Prefab:…>; in a <Layout> it isn't generated yet.",
            "MenuScene.bechaml:5:58 The scene has no widget named Nobody.",
            "MenuScene.bechaml:5:73 A Button has no function Fly: Press."
        ]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

const stepperPrefab = [
    "<Prefab Name=\"Stepper\">",
    "    <Lasagna Rows=1 Columns=2>",
    "        <Button Name=\"Up\" Row=0 Column=0 OnClick=@Level.StepUp>",
    "            <Text String=\"+\"/>",
    "        </Button>",
    "        <Slider Name=\"Level\" Row=0 Column=1 Type=\"F32\" MinValue=0.0 Value=0.5/>",
    "    </Lasagna>",
    "</Prefab>",
    ""].join("\n");

const stepperInstance = [
    "        <Prefab:Stepper Name=\"Volume\" Row=0 Column=1>",
    "            <@Level Type=\"I32\" MinValue=0 Value=5/>",
    "            <@Up OnClick=Slots.Tick/>",
    "            <Button>",
    "                <Text String=\"Up\"/>",
    "            </Button>",
    "        </Prefab:Stepper>",
    ""].join("\n");

test("generates a prefab once and places it in a scene, its entries in cascade order and its Slider's type changed", async () =>
{
    const folder = await sceneProject();

    try
    {
        mkdirSync(path.join(folder, "source", "code", "Prefabs"), { recursive: true });
        writeFileSync(path.join(folder, "source", "code", "Prefabs", "Stepper.bechaml"), stepperPrefab);
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        writeFileSync(markup, menuScene.replace("        </MenuBar>\n", "        </MenuBar>\n" + stepperInstance));

        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        //Prefab: its own values with its own type, and its wiring connected once every widget is there
        const prefab = read(folder, "source/generated/Prefabs/Stepper_prefab.cpp");
        assert.match(read(folder, "source/generated/Prefabs/Stepper_prefab.hpp"), /struct Stepper\n[\s\S]*WidgetReference<RetroFuturaGUI::Slider> _Level \{ nullptr \};[\s\S]*static Stepper Build\(Container& container/);
        assert.match(prefab, /built\._Root = prefab->SetRootContainer<RetroFuturaGUI::Lasagna>\("Root", /);
        assert.match(prefab, /level->SetMinValue<f32>\(0\.0f\);/);
        assert.match(prefab, /level->SetValue<f32>\(0\.5f, false\);/);
        assert.match(prefab, /setupLevel\(built, \*root\);\n\n    connectUp\(built\);/);
        assert.match(prefab, /up->Connect_OnClick\(\[levelTarget = built\._Level\]\(\) \{ if\(!levelTarget\) return; levelTarget->StepUp\(true\); \}, false\);/);
        assert.match(read(folder, "source/generated/Project.cmake"), /source\/generated\/Prefabs\/Stepper_prefab\.cpp/);

        //Scene: the struct as its member, Build, then each reached widget's own setup
        const setup = read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp");
        assert.match(read(folder, "source/generated/impl/Scenes/MenuScene_p.hpp"), /App::Prefabs::Stepper _volume \{\};[\s\S]*void setupVolumeUp\(\);\n        void setupVolumeLevel\(\);/);
        assert.match(setup, /_volume = App::Prefabs::Stepper::Build\(rootLasagna, "Volume", RetroFuturaGUI::CellPlacement \{ \._Row = 0, \._Column = 1/);
        assert.match(setup, /volumeLevel->SetMinValue<i32>\(0\);[\s\S]*volumeLevel->SetValue<i32>\(5, false\);/);
        assert.match(setup, /void App::MenuScene_p::setupVolumeUp\(\)[\s\S]*volumeUp->GetText\(\)\.SetString\("Up", false\);[\s\S]*volumeUp->Connect_OnClick\(\[this\]\(\) \{ Tick\(\); \}, false\);/);

        writeFileSync(markup, menuScene
            .replace("        </MenuBar>\n", "        </MenuBar>\n" + stepperInstance.replace("<@Level Type=\"I32\" MinValue=0 Value=5/>", "<@Nope/>"))
            .replace("<Button Name=\"Fixed\" Enabled=False/>", "<Button Name=\"Fixed\" Enabled=False/>\n            <Slider Name=\"Loose\" MinValue=1/>"));
        const messages = (await generateProject(folder)).problems.map(problem => path.basename(problem.file) + ":" + problem.line + ":" + problem.column + " " + problem.message);
        assert.ok(messages.includes("MenuScene.bechaml:15:13 Stepper has no widget named Nope: Root, Up, Level."), messages.join("\n"));
        assert.ok(messages.some(message => message.endsWith("Slider's MinValue needs the value type first: Type=\"F32\" or another of I8, I16, I32, I64, U8, U16, U32, U64, F32, F64.")), messages.join("\n"));
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
            .replace("OnClick={ Slots.Save, Slots.LoadScene(Scenes.OtherScene), Slots.UnloadScene(Scenes.MenuScene) }", "OnClick={ Slots.Missing, Slots.LoadScene(Scenes.Nowhere) } Sparkle=True")
            .replace("FontSize=20.0", "FontUnit=\"Points\"")
            .replace("Width=2.0", "Width=\"wide\"")
            .replace("Enabled=False", "Enabled=False OnFilesDropped=Slots.Tick"));

        const messages = (await generateProject(folder)).problems.map(problem => path.basename(problem.file) + ":" + problem.line + ":" + problem.column + " " + problem.message);
        //OnFilesDropped=Slots.Tick is fine: a slot without parameters ignores what the signal hands over.
        assert.deepEqual(messages,
        [
            "MenuScene.bechaml:5:58 The scene declares no slot Missing: add <Slot>void Missing()</Slot>.",
            "MenuScene.bechaml:5:89 No scene is named Nowhere.",
            "MenuScene.bechaml:5:107 Button has no Sparkle.",
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

test("generates a glow's flash, and checks its steps, loop and times and that only a Border's and a Background's glows grow", async () =>
{
    const folder = await sceneProject();
    const background = "<Background Colors={ 1.0, 0.5, 0.0 } CornerRadii={ 4.0, 4.0, 4.0, 4.0 }/>";
    const text = "<Text String=\"OK\" FontSize=20.0 Colors:Hover=#FF000080/>";

    try
    {
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        writeFileSync(markup, menuScene.replace(background, "<Background><Glow><Flash On=\"Clicked\" Opacities={ 1.0, 0.6, 1.0, 0.0 } Widths={ 8.0, 3.0, 8.0, 0.0 } Loop={ 1, 2 } Repeat=3 StartTime=60 LoopTime=300 EndTime=400/></Glow></Background>"));
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const setup = read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp");
        assert.match(setup, /GetBackground\(\)\.GetGlow\(\)\.GetFlash\(\)\.SetOn\(RetroFuturaGUI::ColorState::Clicked\);/);
        assert.match(setup, /GetFlash\(\)\.SetOpacities\(std::array \{ 1\.0f, 0\.6f, 1\.0f, 0\.0f \}\);/);
        assert.match(setup, /GetFlash\(\)\.SetLoop\(1, 2\);/);
        assert.match(setup, /GetFlash\(\)\.SetLoopTime\(std::chrono::milliseconds\(300\)\);/);

        writeFileSync(markup, menuScene
            .replace(text, "<Text String=\"OK\"><Glow><Flash Opacities={ 1.0, 0.0 } Widths={ 4.0, 0.0 } StartTime=60/></Glow></Text>")
            .replace(background, "<Background><Glow><Flash Opacities={ 1.0, 0.6, 0.0 } Widths={ 8.0, 0.0 } Loop={ 1, 3 }/></Glow></Background>"));
        const messages = (await generateProject(folder)).problems.map(problem => problem.message);
        assert.deepEqual(messages,
        [
            "Only the glows of a Border and a Background grow, so this <Flash> takes no Widths.",
            "This <Flash> has an ending, so it needs EndTime in milliseconds.",
            "Widths gives 2 steps, but Opacities 3: give every step both.",
            "Loop takes its first and its last step among the 3, the first not after the last: Loop={ 1, 2 }."
        ]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("hands a setter a list of whatever it takes several of, and refuses a list it would change", async () =>
{
    const folder = await sceneProject();

    try
    {
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        const comboBox = (attributes: string) => menuScene.replace("    </Lasagna>", "        <ComboBox Name=\"Pick\" Row=0 Column=1 " + attributes + "/>\n    </Lasagna>");
        writeFileSync(markup, comboBox("Items={ \"Chrome\", \"Liquid metal\" } Modes={ \"FIXED\", \"FILL\" } Names={ \"A\" }"));
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const setup = read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp");
        assert.ok(setup.includes("pick->SetItems(std::array<std::string_view, 2> { \"Chrome\", \"Liquid metal\" }, false);"), "strings are named as the setter's type, and markup never fires a signal");
        assert.ok(setup.includes("pick->SetModes(std::array<RetroFuturaGUI::SizingMode, 2> { RetroFuturaGUI::SizingMode::FIXED, RetroFuturaGUI::SizingMode::FILL });"), "enum values are read as the enum");
        assert.ok(setup.includes("pick->SetNames({ \"A\" });"));

        writeFileSync(markup, comboBox("Items=\"Chrome\" Modes={ \"Sideways\" } Tracks={ 1.0 }"));
        assert.deepEqual((await generateProject(folder)).problems.map(problem => problem.message),
        [
            "This takes a list: { … }.",
            "This takes one of \"FIXED\", \"FILL\".",
            "This takes a list the setter changes (std::span<f32>), which markup can't hand over."
        ]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("registers an Aesthetic's entries by widget type, AnyWidget and popup type, and gives a scene the Aesthetic it names", async () =>
{
    const folder = await sceneProject();
    const aesthetic = path.join(folder, "source", "code", "Aesthetics", "Sleek.bechaml");
    const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
    const sleek = [
        "<Aesthetic Name=\"Sleek\">",
        "    <AnyWidget>",
        "        <Background CornerRadii={ 2.0, 2.0, 2.0, 2.0 }/>",
        "    </AnyWidget>",
        "    <Button Size={ 40.0, 20.0, 0.01 }>",
        "        <Background Colors:Hover=#FF0000/>",
        "    </Button>",
        "    <FileExplorer>",
        "        <Button>",
        "            <Background Colors=#00FF00/>",
        "        </Button>",
        "        <Title>",
        "            <Background Colors=#0000FF/>",
        "        </Title>",
        "    </FileExplorer>",
        "    <Popup>",
        "        <AnyWidget>",
        "            <Background CornerRadii={ 6.0, 6.0, 6.0, 6.0 }/>",
        "        </AnyWidget>",
        "    </Popup>",
        "</Aesthetic>",
        ""].join("\n");

    try
    {
        mkdirSync(path.dirname(aesthetic), { recursive: true });
        writeFileSync(aesthetic, sleek);
        writeFileSync(markup, menuScene.replace("<Scene Name=\"MenuScene\" OnUpdate=Slots.Tick>", "<Scene Name=\"MenuScene\" Aesthetic=Aesthetics.Sleek OnUpdate=Slots.Tick>"));
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const source = read(folder, "source/generated/impl/Styles/Sleek_aesthetic.cpp");
        assert.ok(source.includes("void App::RegisterAestheticSleek()\n"));
        assert.ok(source.includes("RetroFuturaGUI::Flavor& flavor { RetroFuturaGUI::StylingManager::GetAesthetic(\"Sleek\").GetAnyWidget() };\n        flavor.GetBackground().SetCornerRadii(glm::vec4(2.0f, 2.0f, 2.0f, 2.0f));"));
        assert.ok(source.includes("RetroFuturaGUI::Flavor& flavor { RetroFuturaGUI::StylingManager::GetAesthetic(\"Sleek\").GetEntry(RetroFuturaGUI::WidgetTypeID::Button) };\n"));
        assert.ok(source.includes("        flavor.SetSize(glm::vec3(40.0f, 20.0f, 0.01f));\n"));
        assert.ok(source.includes("RetroFuturaGUI::Flavor& flavor { RetroFuturaGUI::StylingManager::GetAesthetic(\"Sleek\", RetroFuturaGUI::StyleScope::File).GetEntry(RetroFuturaGUI::WidgetTypeID::Button) };"), "a popup type's entries are its scope's");
        assert.ok(source.includes("RetroFuturaGUI::Flavor& flavor { RetroFuturaGUI::StylingManager::GetAesthetic(\"Sleek\", RetroFuturaGUI::StyleScope::File).GetTitle() };"));
        assert.ok(source.includes("RetroFuturaGUI::Flavor& flavor { RetroFuturaGUI::StylingManager::GetAesthetic(\"Sleek\", RetroFuturaGUI::StyleScope::Popup).GetAnyWidget() };"), "<Popup> is every popup's");
        assert.ok(read(folder, "source/generated/impl/Styles/Styles.cpp").includes("    RegisterAestheticSleek();\n"));
        assert.ok(read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp").includes("_scene->SetAesthetic(\"Sleek\");"));

        writeFileSync(aesthetic, sleek.replace("Name=\"Sleek\"", "Name=\"Shiny\"").replace("    <Button Size", "    <Wheel/>\n    <Title/>\n    <Button Size"));
        writeFileSync(markup, menuScene.replace("<Scene Name=\"MenuScene\" OnUpdate=Slots.Tick>", "<Scene Name=\"MenuScene\" Aesthetic=Aesthetics.Sleek OnUpdate=Slots.Tick>"));
        assert.deepEqual((await generateProject(folder)).problems.map(problem => problem.message).sort(),
        [
            "<Title> isn't a widget type, <AnyWidget> or a popup type.",
            "<Wheel> isn't a widget type, <AnyWidget> or a popup type.",
            "No Aesthetic is named Sleek: Shiny.",
            "The Aesthetic is named Shiny, but its file Sleek.bechaml: the two have to match."
        ].sort());
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("registers a Flavors file's flavors in RegisterStyles, and gives a widget the flavors it names", async () =>
{
    const folder = await sceneProject();
    const flavors = path.join(folder, "source", "code", "Flavors", "Looks.bechaml");
    const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
    const looks = [
        "<Flavors>",
        "    <Flavor Name=\"Metal\" Size={ 32.0, 32.0, 0.05 }>",
        "        <Transition Properties=\"Colors\" Duration=150/>",
        "        <Background Colors:Hover=#FF0000 CornerRadii={ 4.0, 4.0, 4.0, 4.0 }>",
        "            <Glow Width=6.0>",
        "                <Flash Opacities={ 1.0, 0.0 } Widths={ 4.0, 0.0 } StartTime=60 EndTime=400/>",
        "            </Glow>",
        "        </Background>",
        "    </Flavor>",
        "    <Flavor Name=\"Default\">",
        "        <Background CornerRadii={ 2.0, 2.0, 2.0, 2.0 }/>",
        "    </Flavor>",
        "</Flavors>",
        ""].join("\n");

    try
    {
        mkdirSync(path.dirname(flavors), { recursive: true });
        writeFileSync(flavors, looks);
        writeFileSync(markup, menuScene.replace("<Button Name=\"OkButton\" Row=1 Column=1", "<Button Name=\"OkButton\" Row=1 Column=1 Flavors={ Flavors.Metal }"));
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const source = read(folder, "source/generated/impl/Styles/Looks_flavors.cpp");
        assert.ok(source.includes("void App::RegisterFlavorsLooks()\n"));
        assert.ok(source.includes("        RetroFuturaGUI::Flavor& flavor { RetroFuturaGUI::StylingManager::GetFlavor(\"Metal\") };\n"));
        assert.ok(source.includes("        flavor.SetSize(glm::vec3(32.0f, 32.0f, 0.05f));\n"));
        assert.ok(source.includes("        flavor.GetBackground().SetColors(std::array { glm::vec4(1.0f, 0.0f, 0.0f, 1.0f) }, RetroFuturaGUI::ColorState::Hover);\n"));
        assert.ok(source.includes("        flavor.GetBackground().GetGlow().GetFlash().SetOpacities(std::array { 1.0f, 0.0f });\n"), "a flavor's glow may flash, and grow");
        assert.ok(source.includes("        flavor.SetTransition(RetroFuturaGUI::TransitionProperty::Colors, RetroFuturaGUI::Transition { ._Duration = std::chrono::milliseconds(150), ._Easing = RetroFuturaGUI::Easing::EaseInOut });\n"));
        assert.ok(source.includes("        RetroFuturaGUI::Flavor& flavor { RetroFuturaGUI::StylingManager::GetDefaultFlavor() };\n"), "Default is the flavor every widget falls back to");
        assert.ok(read(folder, "source/generated/impl/Styles/Styles.cpp").includes("void App::RegisterStyles()\n{\n    RegisterFlavorsLooks();\n}\n"));
        assert.ok(read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp").includes("okButton->AddFlavor(\"Metal\");"));

        writeFileSync(path.join(path.dirname(flavors), "More.bechaml"), "<Flavors>\n    <Flavor Name=\"Metal\"/>\n    <Flavor>\n        <Wheel/>\n    </Flavor>\n</Flavors>\n");
        writeFileSync(markup, menuScene
            .replace("<Button Name=\"OkButton\" Row=1 Column=1", "<Button Name=\"OkButton\" Row=1 Column=1 Flavors={ Flavors.Nope, Flavors.Default }")
            .replace("<Text String=\"OK\" FontSize=20.0 Colors:Hover=#FF000080/>", "<Text String=\"OK\" Flavors=Flavors.Metal/>"));
        assert.deepEqual((await generateProject(folder)).problems.map(problem => problem.message).sort(),
        [
            "A flavor is named by a string that is a name: <Flavor Name=\"Primary\">.",
            "Another Flavors file names a flavor Metal already: " + path.join("source", "code", "Flavors", "Looks.bechaml") + ".",
            "Every widget has Flavors.Default already, after its own flavors.",
            "Flavors go on a widget, and reach its parts from there.",
            "No flavor is named Nope: Metal."
        ].sort());
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("writes a struct setter from a child element of its fields, a list setter's items into one call, and a mask from a list", async () =>
{
    const folder = await sceneProject();
    const background = "<Background Colors={ 1.0, 0.5, 0.0 } CornerRadii={ 4.0, 4.0, 4.0, 4.0 }/>";

    try
    {
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        writeFileSync(markup, menuScene.replace(background,
            "<Transition Properties={ \"Colors\", \"CornerRadii\" } Duration=150 Easing=\"EaseOut\"/>\n" +
            "            <Transition Properties=\"Size\" Duration=300/>\n" +
            "            <Background>\n" +
            "                <GlassNoise CellSize=96.0/>\n" +
            "                <Gap Edge=\"Top\" Length=80.0 CutsBackground/>\n" +
            "                <PathFill Name=\"hexagon\" Colors=#99EBFF/>\n" +
            "                <Gap Edge=\"Bottom\" Length=10.0 Repeat=-1/>\n" +
            "            </Background>"));
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const setup = read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp");
        assert.ok(setup.includes("okButton->SetTransition(RetroFuturaGUI::TransitionProperty::Colors | RetroFuturaGUI::TransitionProperty::CornerRadii, RetroFuturaGUI::Transition { ._Duration = std::chrono::milliseconds(150), ._Easing = RetroFuturaGUI::Easing::EaseOut });"), "a mask's names are joined, the struct's fields named");
        assert.ok(setup.includes("okButton->SetTransition(RetroFuturaGUI::TransitionProperty::Size, RetroFuturaGUI::Transition { ._Duration = std::chrono::milliseconds(300), ._Easing = RetroFuturaGUI::Easing::EaseInOut });"), "a setter may be called again, a field left out taking its default");
        assert.ok(setup.includes("okButton->GetBackground().SetGlassNoise(RetroFuturaGUI::GlassNoise { ._CellSize = 96.0f, ._Distortion = 12.0f });"));
        assert.ok(setup.includes("okButton->GetBackground().SetImagePathFill(\"hexagon\", RetroFuturaGUI::SvgPathFill { ._Colors = { glm::vec4(0.6f, 0.921569f, 1.0f, 1.0f) } });"), "the setter's other values come from attributes named after them");
        assert.ok(setup.includes("okButton->GetBackground().SetGaps(std::array { RetroFuturaGUI::BorderGap { ._Edge = RetroFuturaGUI::BorderEdge::Top, ._Length = 80.0f, ._Repeat = 1, ._CutsBackground = true }, RetroFuturaGUI::BorderGap { ._Edge = RetroFuturaGUI::BorderEdge::Bottom, ._Length = 10.0f, ._Repeat = -1, ._CutsBackground = false } });"), "a list setter's items, wherever they are, make one call");

        writeFileSync(markup, menuScene.replace(background,
            "<Transition Duration=150 Speed=2.0/>\n" +
            "            <Background GlassNoise=1.0>\n" +
            "                <PathFill Name=\"ring\"/>\n" +
            "            </Background>"));
        assert.deepEqual((await generateProject(folder)).problems.map(problem => problem.message),
        [
            "A GlassNoise is written as a child element named after its setter, its fields as attributes.",
            "<PathFill> needs Colors, which SvgPathFill has no default for.",
            "<Transition> needs Properties."
        ]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("adds a RadioButtonGroup's buttons to its cells, styles their labels as parts, and reads its tracks as a Lasagna's", async () =>
{
    const folder = await sceneProject();

    try
    {
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        const group = (inside: string, attributes = "Rows=2") => menuScene.replace("    </Lasagna>", "        <RadioButtonGroup Name=\"Mode\" Row=0 Column=1 " + attributes + ">\n" + inside + "        </RadioButtonGroup>\n    </Lasagna>");
        writeFileSync(markup, group(
            "            <RadioButton Name=\"First\" Value>\n" +
            "                <Label>\n                    <Text String=\"First mode\"/>\n                </Label>\n" +
            "            </RadioButton>\n" +
            "            <RadioButton Name=\"Second\" Row=1/>\n"));
        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const setup = read(folder, "source/generated/impl/Scenes/MenuScene_setup.cpp");
        assert.ok(setup.includes("mode->SetAxisDefinitions(std::array { 0.5f, 0.5f }, std::array { 1.0f });"), "Rows=2 is two tracks, and Columns left out is one");
        assert.ok(setup.includes("_first = mode.AddRadioButton(\"First\", glm::i64vec2(0, 0));"), "the group builds its button itself, Row and Column 0 when left out");
        assert.ok(setup.includes("_second = mode.AddRadioButton(\"Second\", glm::i64vec2(1, 0));"));
        assert.ok(setup.includes("first->SetValue(true, false);"));
        assert.ok(setup.includes("first->GetLabel().GetText().SetString(\"First mode\", false);"), "the label is a part of its button");
        assert.ok(read(folder, "source/generated/impl/Scenes/MenuScene_p.hpp").includes("RetroFuturaGUI::WidgetReference<RetroFuturaGUI::RadioButton> _first { nullptr };"));

        writeFileSync(markup, group("            <Button Name=\"Stray\"/>\n            <RadioButton Name=\"Third\" Row=-1/>\n", "Rows=1 Columns={ 0.5, 0.25 }"));
        assert.deepEqual((await generateProject(folder)).problems.map(problem => problem.severity + ": " + problem.message),
        [
            "error: A RadioButtonGroup holds only RadioButtons and its parts, not a Button.",
            "warning: The tracks add up to 0.75: each is a share of the size, so together they usually make 1.0.",
            "error: Row takes a whole number from 0 on."
        ]);

        writeFileSync(markup, group("", "Rows=0"));
        assert.deepEqual((await generateProject(folder)).problems.map(problem => problem.message), ["This takes at least one track."]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("loads and unloads scenes only through LoadScene and UnloadScene, each given a scene", async () =>
{
    const folder = await sceneProject();
    const click = "OnClick={ Slots.Save, Slots.LoadScene(Scenes.OtherScene), Slots.UnloadScene(Scenes.MenuScene) }";

    try
    {
        const markup = path.join(folder, "source", "code", "Scenes", "MenuScene.bechaml");
        writeFileSync(markup, menuScene.replace("FontSize=20.0", "FontSize=Dictionary.Sizes.Big(2)"));
        assert.deepEqual((await generateProject(folder)).problems.map(problem => problem.message),
        [
            "Values in parentheses only go with the slot a signal calls, as in OnClick=Slots.LoadScene(Scenes.MainScene)."
        ]);

        writeFileSync(markup, menuScene
            .replace("    <Slot>void Tick()</Slot>", "    <Slot>void Tick()</Slot>\n    <Slot>void UnloadScene()</Slot>")
            .replace(click, "OnClick={ Slots.Save(Scenes.OtherScene), Slots.LoadScene(\"OtherScene\"), Scenes.OtherScene }"));
        assert.deepEqual((await generateProject(folder)).problems.map(problem => problem.message),
        [
            "Every scene has the slot UnloadScene already: name this one differently.",
            "Only LoadScene and UnloadScene take values in parentheses: OnClick=Slots.LoadScene(Scenes.MainScene).",
            "LoadScene takes the scene it means: Slots.LoadScene(Scenes.MainScene).",
            "A signal loads a scene with Slots.LoadScene(Scenes.OtherScene), and takes one out with Slots.UnloadScene(Scenes.MenuScene)."
        ]);
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
        writeFileSync(menu, menuScene.replace("{ Slots.Save, Slots.LoadScene(Scenes.OtherScene), Slots.UnloadScene(Scenes.MenuScene) }", "Slots.Save"));

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
        assert.ok(read(folder, "source/generated/impl/Windows/GeneratedWindow.cpp").includes("        _window->AddScene(scene->GetScene());\n        _scenes.push_back(std::move(scene));\n    }\n}"), "a scene that's loaded goes after the ones shown");
        assert.ok(setup.includes("    if(\"MenuScene\" == sceneName)\n"), "the window queues a scene's files by its name");
        assert.ok(setup.includes("        MenuScene::QueueAssets();\n"));
        assert.ok(setup.includes("    else if(\"OtherScene\" == sceneName)\n"));

        const base = read(folder, "source/generated/impl/Windows/GeneratedWindow.cpp");
        assert.ok(base.includes("        if(!areAssetsLoaded(pending._SceneName))\n        {\n            _pendingScenes.push_back(std::move(pending));\n            continue;\n        }\n"), "a scene asked for waits until its files are loaded");
        assert.ok(base.includes("    _pendingScenes.push_back(PendingScene { ._Change = change, ._SceneName = std::string(sceneName) });\n    queueAssets(sceneName);\n"), "its files are queued when it's asked for");
        assert.ok(base.includes("    queueAssets(sceneName);\n    std::unique_ptr<GeneratedScene> scene { createScene(sceneName) };\n"), "a start scene's files are queued before it's built");

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

const fileScene = [
    "<Scene Name=\"FileScene\">",
    "    <Lasagna Rows=1 Columns=1>",
    "        <Button Name=\"Patterned\" Row=0 Column=0>",
    "            <Text Image=RetroFuturaGUI.Images.Pattern.png/>",
    "            <Background Image=\"Images/Logo.png\"/>",
    "        </Button>",
    "        <Button Name=\"Logo\" Row=0 Column=0>",
    "            <Background Image=Assets.Images.Logo.png/>",
    "        </Button>",
    "    </Lasagna>",
    "</Scene>",
    ""].join("\n");

test("finds the files the markup names, by reference or by a path in an asset folder, and queues them for the scene", async () =>
{
    const folder = await sceneProject();
    const projectFile = path.join(folder, "Project.bechaml");
    const sceneFile = path.join(folder, "source", "code", "Scenes", "FileScene.bechaml");

    try
    {
        writeFileSync(projectFile, readFileSync(projectFile, "utf8").replace("<Assets>{ }</Assets>", "<Assets>{ \"Assets\" }</Assets>"));
        mkdirSync(path.join(folder, "Assets", "Images"), { recursive: true });
        writeFileSync(path.join(folder, "Assets", "Images", "Logo.png"), "");
        mkdirSync(path.join(folder, "RetroFuturaGUI", "Resources", "Images"), { recursive: true });
        writeFileSync(path.join(folder, "RetroFuturaGUI", "Resources", "Images", "Pattern.png"), "");
        writeFileSync(sceneFile, fileScene);

        const result = await generateProject(folder);
        assert.deepEqual(result.problems, []);

        const setup = read(folder, "source/generated/impl/Scenes/FileScene_setup.cpp");
        assert.ok(setup.includes("patterned->GetText().SetImage(\"Resources/Images/Pattern.png\");"), "RetroFuturaGUI's Resources are copied to Resources/");
        assert.ok(setup.includes("patterned->GetBackground().SetImage(\"Assets/Images/Logo.png\");"), "a path is looked up in the project's asset folders, which are copied to Assets/");
        assert.ok(setup.includes("logo->GetBackground().SetImage(\"Assets/Images/Logo.png\");"));
        assert.ok(setup.includes([
            "void App::FileScene_p::QueueAssets()",
            "{",
            "    const u32 sceneID { RetroFuturaGUI::SceneLoader::GetSceneID(\"FileScene\") };",
            "    RetroFuturaGUI::SceneLoader::AddAsset(sceneID, \"Resources/Images/Pattern.png\", RetroFuturaGUI::AssetKind::Texture);",
            "    RetroFuturaGUI::SceneLoader::AddAsset(sceneID, \"Assets/Images/Logo.png\", RetroFuturaGUI::AssetKind::Texture);",
            "}"].join("\n")), "each file is queued once");
        assert.ok(read(folder, "source/generated/impl/Scenes/FileScene_p.hpp").includes("        static void QueueAssets();\n"));
        assert.ok(read(folder, "source/generated/impl/Scenes/OtherScene_setup.cpp").includes("void App::OtherScene_p::QueueAssets()\n{\n}\n"), "a scene naming no file queues nothing");

        writeFileSync(sceneFile, fileScene
            .replace("RetroFuturaGUI.Images.Pattern.png", "RetroFuturaGUI.Images.Missing.png")
            .replace("\"Images/Logo.png\"", "\"../Logo.png\"")
            .replace("Assets.Images.Logo.png", "Dictionary.Images.Logo"));

        const problems = (await generateProject(folder)).problems.map(problem => problem.line + ": " + problem.message);
        assert.deepEqual(problems,
        [
            "4: RetroFuturaGUI's Resources have no Images/Missing.png.",
            "5: A file's path stays inside an asset folder, such as \"Images/Logo.svg\".",
            "8: A file is named Assets.<folders>.<name>.<extension> or RetroFuturaGUI.<folders>.<name>.<extension>, such as Assets.Images.Logo.svg."
        ]);
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});
