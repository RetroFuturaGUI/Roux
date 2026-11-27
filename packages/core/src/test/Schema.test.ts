import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { buildSchema, readTags, type AstNode } from "../schema/SchemaBuilder.js";
import { splitDump } from "../schema/SchemaFile.js";
import { parseClangVersion } from "../setup/Clang.js";

const source = path.join(path.sep, "library", "source");
const file = (relative: string) => path.join(source, ...relative.split("/"));

//A doc comment as Clang writes it: each @bechaml line is an unknown inline command and the text after it
function comment(...tags: string[]): AstNode
{
    const inner: AstNode[] = [{ kind: "TextComment", text: " Does something" }];

    for (const tag of tags)
        inner.push({ kind: "TextComment", text: " " }, { kind: "InlineCommandComment", name: "bechaml" }, { kind: "TextComment", text: " " + tag });

    return { kind: "FullComment", inner: [{ kind: "ParagraphComment", inner: inner }] };
}

function method(name: string, qualType: string, params: [string, string][], ...rest: AstNode[]): AstNode
{
    return { kind: "CXXMethodDecl", name: name, type: { qualType: qualType }, inner: [...params.map(([parameter, type]): AstNode => ({ kind: "ParmVarDecl", name: parameter, type: { qualType: type } })), ...rest] };
}

const isPublic: AstNode = { kind: "AccessSpecDecl", access: "public" };

//The library as Clang would dump it: Clang writes a location's file only when it changes
const library: AstNode[] =
[
    {
        kind: "NamespaceDecl", name: "RetroFuturaGUI", loc: { file: file("OpenGlHelpers/IncludeHelper.hpp") }, inner:
        [
            { kind: "EnumDecl", name: "WidgetTypeID", inner: ["None", "Lasagna", "Button"].map(value => ({ kind: "EnumConstantDecl", name: value })) },
            { kind: "EnumDecl", name: "ColorState", inner: ["Enabled", "Hover"].map(value => ({ kind: "EnumConstantDecl", name: value })) }
        ]
    },
    {
        kind: "NamespaceDecl", name: "RetroFuturaGUI", loc: { file: file("Widgets/Interfaces/IWidget.hpp") }, inner:
        [
            {
                kind: "CXXRecordDecl", name: "IWidget", tagUsed: "class", completeDefinition: true, inner:
                [
                    isPublic,
                    method("SetEnabled", "void (const bool, const bool)", [["enable", "const bool"], ["emitSignal", "const bool"]]),
                    method("SetName", "void (std::string_view)", [["name", "std::string_view"]], comment("internal")),
                    method("Connect_OnEnable", "void (const typename Signal<>::Slot &, const bool)", [["slot", "const typename Signal<>::Slot &"], ["async", "const bool"]]),
                    { kind: "AccessSpecDecl", access: "protected" },
                    method("SetHidden", "void (bool)", [["hidden", "bool"]])
                ]
            }
        ]
    },
    {
        kind: "NamespaceDecl", name: "RetroFuturaGUI", loc: { file: file("Widgets/Parts/Background.hpp") }, inner:
        [
            {
                kind: "CXXRecordDecl", name: "Background", tagUsed: "class", completeDefinition: true, inner:
                [
                    isPublic,
                    method("SetColors", "void (std::span<const glm::vec4>, const ColorState)", [["colors", "std::span<const glm::vec4>"], ["state", "const ColorState"]]),
                    method("SetFont", "void (std::string_view, const f32)", [["family", "std::string_view"], ["size", "const f32"]], comment("group FontFamily FontSize", "default size=16")),
                    method("SetSize", "void (const glm::vec2 &)", [["size", "const glm::vec2 &"]], comment("internal")),
                    method("SetBuiltInColors", "void (const StyleKey &, std::span<const glm::vec4>)", [["key", "const StyleKey &"], ["colors", "std::span<const glm::vec4>"]]),
                    method("SetWidth", "void (const f32)", [["width", "const f32"]], comment("frobnicate"))
                ]
            }
        ]
    },
    {
        kind: "NamespaceDecl", name: "RetroFuturaGUI", loc: { file: file("Widgets/Button.hpp") }, inner:
        [
            {
                kind: "CXXRecordDecl", name: "Button", tagUsed: "class", completeDefinition: true, bases: [{ access: "public", type: { qualType: "IWidget" } }], inner:
                [
                    isPublic,
                    { kind: "CXXConstructorDecl", name: "Button", inner: [["name", "std::string_view"], ["projection", "Projection *"], ["parentWidget", "IWidget *"], ["parentWidgetTypeID", "const WidgetTypeID"], ["parentWindow", "GLFWwindow *"]].map(([name, type]) => ({ kind: "ParmVarDecl", name: name, type: { qualType: type } })) },
                    method("GetBackground", "Background &()", []),
                    method("GetBackground", "const Background &() const", []),
                    method("Connect_OnClick", "void (const typename Signal<>::Slot &, const bool)", [["slot", "const typename Signal<>::Slot &"], ["async", "const bool"]]),
                    method("SetEnabled", "void (const bool)", [["enable", "const bool"]])
                ]
            },
            { kind: "CXXRecordDecl", name: "CellPlacement", tagUsed: "struct", completeDefinition: true, inner: [{ kind: "FieldDecl", name: "_Row", type: { qualType: "uSize" } }] },
            {
                kind: "CXXRecordDecl", name: "Lasagna", tagUsed: "class", completeDefinition: true, inner:
                [
                    isPublic,
                    { kind: "FunctionTemplateDecl", name: "AddWidget", inner: [{ kind: "TemplateTypeParmDecl", name: "T" }, method("AddWidget", "T *(std::string_view, const CellPlacement &)", [["name", "std::string_view"], ["placement", "const CellPlacement &"]])] }
                ]
            },
            { kind: "CXXRecordDecl", name: "Unused", tagUsed: "class", completeDefinition: true, inner: [isPublic, method("SetValue", "void (int)", [["value", "int"]])] },
            { kind: "CXXRecordDecl", name: "MessagePopup", tagUsed: "class", completeDefinition: true, inner: [comment("popup Message Warning Error")] }
        ]
    },
    {
        kind: "NamespaceDecl", name: "PlatformBridge", loc: { file: file("../PlatformBridge/Fonts.hpp") }, inner:
        [
            { kind: "NamespaceDecl", name: "Fonts", inner: [{ kind: "EnumDecl", name: "Slant", inner: [{ kind: "EnumConstantDecl", name: "Roman" }] }] }
        ]
    }
];

test("reads the @bechaml lines of a doc comment", () =>
{
    assert.deepEqual(readTags(comment("group A B", "internal")), ["group A B", "internal"]);
    assert.deepEqual(readTags(comment()), []);
});

test("splits Clang's filtered dump into one declaration each", () =>
{
    const roots = splitDump("{\n  \"kind\": \"NamespaceDecl\",\n  \"name\": \"A\"\n}\n{\n  \"kind\": \"NamespaceDecl\",\n  \"name\": \"B\"\n}\n");
    assert.deepEqual(roots.map(root => root.name), ["A", "B"]);
});

test("reads Clang's version", () =>
{
    assert.equal(parseClangVersion("clang version 23.1.5 (https://github.com/llvm/llvm-project 392dfff)\nTarget: x86_64-pc-windows-msvc"), "23.1.5");
    assert.equal(parseClangVersion("Apple clang version 17.0.0 (clang-1700.0.13.3)"), "17.0.0");
});

test("keeps what the generator may call: widgets with what they inherit, their parts, placements and popups", () =>
{
    const { classes, enums, problems } = buildSchema(library, source);

    assert.deepEqual(Object.keys(classes), ["Background", "Button", "CellPlacement", "Lasagna", "MessagePopup"], "Unused is reached by nothing");
    assert.deepEqual(enums["PlatformBridge::Fonts::Slant"], { cpp: "PlatformBridge::Fonts::Slant", header: "../PlatformBridge/Fonts.hpp", values: ["Roman"] });
    assert.equal(enums["ColorState"]?.cpp, "RetroFuturaGUI::ColorState");

    const button = classes["Button"];
    assert.equal(button?.header, "Widgets/Button.hpp");
    assert.equal(button?.role, "widget");
    assert.deepEqual(button?.parts, { Background: { getter: "GetBackground", type: "Background" } }, "the const getter is no part");
    assert.deepEqual(Object.keys(button?.signals ?? {}), ["OnClick", "OnEnable"]);
    assert.deepEqual(button?.setters["Enabled"], [{ call: "SetEnabled", params: [{ name: "enable", type: "bool" }] }], "Button's own SetEnabled hides IWidget's");
    assert.ok(!("Name" in (button?.setters ?? {})), "internal");
    assert.ok(!("Hidden" in (button?.setters ?? {})), "protected");
    assert.deepEqual(button?.constructorArgs, []);

    const background = classes["Background"];
    assert.equal(background?.role, "part");
    assert.deepEqual(background?.setters["Colors"]?.[0]?.params, [{ name: "colors", type: "std::span<const glm::vec4>" }, { name: "state", type: "ColorState", isState: true }]);
    assert.deepEqual(background?.setters["Font"]?.[0]?.group, ["FontFamily", "FontSize"]);
    assert.deepEqual(background?.setters["Font"]?.[0]?.defaults, { size: "16" });
    assert.deepEqual(Object.keys(background?.setters ?? {}), ["Colors", "Font", "Width"], "no internal setter, no StyleKey one");

    assert.deepEqual(classes["Lasagna"]?.container, { add: "AddWidget", placement: "CellPlacement" });
    assert.deepEqual(classes["CellPlacement"], { cpp: "RetroFuturaGUI::CellPlacement", header: "Widgets/Button.hpp", role: "placement", bases: [], parts: {}, setters: {}, signals: {}, slots: {}, fields: { Row: { member: "_Row", type: "uSize" } }, constructorArgs: [] });
    assert.deepEqual(classes["MessagePopup"]?.popupScopes, ["Message", "Warning", "Error"]);
    assert.deepEqual(problems, ["Background::SetWidth: @bechaml frobnicate isn't one of group, default, name, internal, slot, children, setter, add, named."]);
});

//A field as Clang writes it, with its initializer: { 1.0f } is an InitListExpr around the literal.
function field(name: string, type: string, initializer: AstNode | undefined, ...rest: AstNode[]): AstNode
{
    return { kind: "FieldDecl", name: name, type: { qualType: type }, inner: [...rest, ...(initializer ? [{ kind: "InitListExpr", inner: [initializer] }] : [])] };
}

test("keeps slots, children setters and the structs constructors and children take, with their fields' names and defaults", () =>
{
    const bar: AstNode[] =
    [
        {
            kind: "NamespaceDecl", name: "RetroFuturaGUI", loc: { file: file("Widgets/Window/Window.hpp") }, inner:
            [
                { kind: "EnumDecl", name: "WidgetTypeID", inner: ["MenuBar", "Lasagna"].map(value => ({ kind: "EnumConstantDecl", name: value })) },
                {
                    kind: "CXXRecordDecl", name: "Window", tagUsed: "class", completeDefinition: true, inner:
                    [
                        isPublic,
                        method("ToggleMaximize", "void ()", [], comment("slot", "name Maximize")),
                        method("Minimize", "void ()", [], comment("slot")),
                        method("Show", "void (const bool)", [["show", "const bool"]], comment("setter", "name Shown"))
                    ]
                },
                {
                    kind: "CXXRecordDecl", name: "MenuBar", tagUsed: "class", completeDefinition: true, inner:
                    [
                        isPublic,
                        {
                            kind: "CXXRecordDecl", name: "FlexDefinition", tagUsed: "struct", completeDefinition: true, inner:
                            [
                                field("_FlexSizing", "FlexSizing", { kind: "DeclRefExpr", referencedDecl: { kind: "EnumConstantDecl", name: "Fixed" } }),
                                field("_Width", "f32", { kind: "FloatingLiteral", value: "1" }),
                                field("_Offset", "f32", { kind: "UnaryOperator", opcode: "-", inner: [{ kind: "FloatingLiteral", value: "0.5" }] }),
                                field("_IsWindowDrag", "bool", { kind: "CXXBoolLiteralExpr", value: false }),
                                field("_Callback", "Callback", { kind: "CallExpr" })
                            ]
                        },
                        { kind: "FunctionTemplateDecl", name: "AddWidget", inner: [{ kind: "TemplateTypeParmDecl", name: "T" }, method("AddWidget", "T *(std::string_view, const uSize)", [["name", "std::string_view"], ["index", "const uSize"]])] },
                        method("SetFlexDefinition", "void (std::span<FlexDefinition>)", [["flexDefinitions", "std::span<FlexDefinition>"]], comment("children"))
                    ]
                },
                {
                    kind: "CXXRecordDecl", name: "AxisDefinition", tagUsed: "struct", completeDefinition: true, inner:
                    [
                        { kind: "FieldDecl", name: "_RowDefinition", type: { qualType: "std::vector<f32>" }, inner: [comment("name Rows"), { kind: "InitListExpr" }] }
                    ]
                },
                {
                    kind: "CXXRecordDecl", name: "Lasagna", tagUsed: "class", completeDefinition: true, inner:
                    [
                        isPublic,
                        { kind: "CXXConstructorDecl", name: "Lasagna", inner: [["name", "std::string_view"], ["projection", "Projection *"], ["parentWidget", "IWidget *"], ["parentWidgetTypeID", "const WidgetTypeID"], ["parentWindow", "GLFWwindow *"], ["axisDefinition", "const AxisDefinition &"]].map(([name, type]) => ({ kind: "ParmVarDecl", name: name, type: { qualType: type } })) }
                    ]
                }
            ]
        }
    ];

    const { classes, problems } = buildSchema(bar, source);

    assert.deepEqual(problems, []);
    assert.deepEqual(Object.keys(classes), ["AxisDefinition", "Lasagna", "MenuBar", "MenuBar::FlexDefinition", "Window"]);
    assert.deepEqual(classes["Window"]?.setters["Shown"], [{ call: "Show", params: [{ name: "show", type: "bool" }] }], "a method tagged setter is one under its name");
    assert.deepEqual(classes["Window"]?.slots, { Maximize: { call: "ToggleMaximize", params: [] }, Minimize: { call: "Minimize", params: [] } });
    assert.deepEqual(classes["MenuBar"]?.container, { add: "AddWidget", placement: "uSize", children: { call: "SetFlexDefinition", type: "MenuBar::FlexDefinition" } });
    assert.ok(!("FlexDefinition" in (classes["MenuBar"]?.setters ?? {})), "a children setter is no attribute");

    const flex = classes["MenuBar::FlexDefinition"];
    assert.equal(flex?.cpp, "RetroFuturaGUI::MenuBar::FlexDefinition");
    assert.equal(flex?.role, "struct");
    assert.deepEqual(flex?.fields,
    {
        FlexSizing: { member: "_FlexSizing", type: "FlexSizing", default: "\"Fixed\"" },
        Width: { member: "_Width", type: "f32", default: "1.0" },
        Offset: { member: "_Offset", type: "f32", default: "-0.5" },
        IsWindowDrag: { member: "_IsWindowDrag", type: "bool", default: "False" },
        Callback: { member: "_Callback", type: "Callback" }
    });

    assert.equal(classes["AxisDefinition"]?.role, "struct", "Lasagna's constructor takes it");
    assert.deepEqual(classes["AxisDefinition"]?.fields, { Rows: { member: "_RowDefinition", type: "std::vector<f32>", default: "{ }" } });
});
