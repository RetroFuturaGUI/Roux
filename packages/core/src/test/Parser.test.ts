import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { LineMap } from "../bechaml/LineMap.js";
import { parseBechaml, parseBechamlValue } from "../bechaml/Parser.js";
import { isToken, printSyntax, type Element, type SyntaxChild, type Value } from "../bechaml/Syntax.js";

//The plan's examples (.bechaml/Plan.md), copied as they are
const fixtureFolder = new URL("../../src/test/fixtures/", import.meta.url);
const fixtures = readdirSync(fixtureFolder)
    .filter(name => name.endsWith(".bechaml"))
    .map(name => ({ name: name, text: readFileSync(new URL(name, fixtureFolder), "utf8") }));

//"line:column message" for each diagnostic
function errors(source: string): string[]
{
    const lineMap = new LineMap(source);

    return parseBechaml(source).diagnostics.map(diagnostic =>
    {
        const position = lineMap.position(diagnostic.start);
        return position.line + ":" + position.column + " " + diagnostic.message;
    });
}

//Every node's children follow each other without gaps from its start to its end, and every token holds its own text
function assertLossless(source: string): void
{
    const document = parseBechaml(source);
    assert.equal(printSyntax(document), source);

    const visit = (node: SyntaxChild) =>
    {
        assert.equal(source.slice(node.start, node.end), printSyntax(node));

        if (isToken(node))
        {
            assert.ok(node.start < node.end, "a token is never empty");
            return;
        }

        let position = node.start;

        for (const child of node.children)
        {
            assert.equal(child.start, position);
            visit(child);
            position = child.end;
        }

        assert.equal(position, node.end);
    };

    visit(document);
}

function element(parent: Element | undefined, name: string): Element
{
    const found = parent?.elements.find(child => name === child.name);
    assert.ok(found, "<" + name + "> is missing");
    return found;
}

function attributeValue(owner: Element, name: string): Value | undefined
{
    const attribute = owner.attributes.find(entry => name === entry.name);
    assert.ok(attribute, name + " is missing");
    return attribute.value;
}

test("reads every example of the plan without errors and gives it back byte for byte", () =>
{
    assert.ok(8 <= fixtures.length);

    for (const fixture of fixtures)
    {
        for (const source of [fixture.text, fixture.text.replace(/\n/g, "\r\n"), "\uFEFF" + fixture.text])
        {
            assert.deepEqual(errors(source), [], fixture.name);
            assertLossless(source);
        }
    }
});

test("reads a widget's parts, setters, color states and signal, and a scene's slots", () =>
{
    const source = fixtures.find(fixture => "ButtonParts.bechaml" === fixture.name)?.text ?? "";
    const button = parseBechaml(source).root;

    assert.equal(button?.name, "Button");
    assert.ok(button);
    assert.deepEqual(button.elements.map(child => child.name), ["Text", "Border", "Indicator"]);
    const name = attributeValue(button, "Name");
    assert.equal("String" === name?.kind ? name.value : undefined, "OkButton");
    assert.equal(attributeValue(button, "RowSpan")?.kind, "Integer");

    const flavors = attributeValue(button, "Flavors");
    assert.equal(flavors?.kind, "List");
    assert.deepEqual("List" === flavors?.kind ? flavors.items.map(item => "Reference" === item.kind ? item.segments.join("/") : item.kind) : [], ["Flavors/Primary", "Flavors/Wide"]);

    const hover = element(button, "Border").attributes.find(attribute => "Colors:Hover" === attribute.name);
    assert.equal(hover?.setter, "Colors");
    assert.equal(hover?.state, "Hover");
    assert.equal(hover?.value?.kind, "Reference");

    assert.equal(element(element(button, "Indicator"), "Background").attributes[0]?.state, "Enabled");

    const onClick = attributeValue(button, "OnClick");
    assert.deepEqual("Reference" === onClick?.kind ? onClick.segments : [], ["Slots", "Print"]);

    const scene = parseBechaml(fixtures.find(fixture => "Scene.bechaml" === fixture.name)?.text ?? "").root;
    assert.ok(scene);
    const slots = scene.elements.filter(child => "Slot" === child.name);
    assert.deepEqual(slots.map(slot => slot.rawText?.text), ["void Accept()", "void Save()", "void UpdateMeter()"]);
    assert.ok(slots[1]?.attributes.some(attribute => "Async" === attribute.name && undefined === attribute.value));
});

test("reads a prefab, an instance's named children with @, and calls on named widgets", () =>
{
    const prefab = parseBechaml(fixtures.find(fixture => "Prefab.bechaml" === fixture.name)?.text ?? "").root;
    assert.equal(prefab?.name, "Prefab");
    assert.ok(prefab);
    const root = element(prefab, "Lasagna");
    const buttonUp = root.elements.find(child => "Button" === child.name && root.elements.indexOf(child) === 2);
    assert.ok(buttonUp);
    const onClick = attributeValue(buttonUp, "OnClick");
    assert.deepEqual("Reference" === onClick?.kind ? onClick.segments : [], ["@ActualSlider", "StepUp"]);

    const instance = parseBechaml(fixtures.find(fixture => "PrefabInstance.bechaml" === fixture.name)?.text ?? "").root;
    assert.equal(instance?.name, "Prefab:StepperSlider");
    assert.ok(instance);
    assert.deepEqual(instance.elements.map(child => child.name), ["@ButtonUp", "Button"]);
    assert.deepEqual(element(instance, "@ButtonUp").elements.map(child => child.name), ["Text"]);

    //A prefab's slots don't count as its root container.
    assert.deepEqual(parseBechaml("<Prefab Name=\"A\">\n    <Slot>void Go()</Slot>\n    <Lasagna/>\n</Prefab>").diagnostics, []);

    const layout = parseBechaml("<Layout Name=\"Tall\">\n    <@RootLasagna Rows=4 Columns=1/>\n    <@OkButton Row=3 Column=0/>\n</Layout>");
    assert.deepEqual(layout.diagnostics, []);
    assert.deepEqual(layout.root?.elements.map(child => child.name), ["@RootLasagna", "@OkButton"]);
});

test("reads the values a signal hands its slot in parentheses, and reports them anywhere else", () =>
{
    const source = "<Button OnClick={ Slots.LoadScene(Scenes.MainScene), Slots.UnloadScene( Scenes.Note ) }/>";
    assert.deepEqual(errors(source), []);
    assertLossless(source);

    const onClick = parseBechaml(source).root?.attributes[0]?.value;
    const calls = "List" === onClick?.kind ? onClick.items : [];
    assert.deepEqual(calls.map(call => "Reference" === call.kind ? [call.segments.join("."), (call.arguments ?? []).map(argument => "Reference" === argument.kind ? argument.segments.join(".") : "")] : []),
    [
        ["Slots.LoadScene", ["Scenes.MainScene"]],
        ["Slots.UnloadScene", ["Scenes.Note"]]
    ]);

    assert.deepEqual(errors("<Text Colors=Dictionary.Colors.Accent(1)/>"), ["1:38 Values in parentheses only go with the slot a signal calls, as in OnClick=Slots.LoadScene(Scenes.MainScene)."]);
    assert.deepEqual(errors("<Button OnClick=Slots.LoadScene(Scenes.MainScene/>"), ["1:32 The call isn't closed: ) is missing."]);
    assertLossless("<Button OnClick=Slots.LoadScene(Scenes.MainScene/>");
});

test("reads every kind of value", () =>
{
    const source = "<Values>{ True, False, 16, -3, 56.7, 1e-3, \"a\\\"b\\\\c\\nd\\te\", #16161D, #1144FF80, { 1.0, 2 }, Dictionary.Colors.Accent, { }, }</Values>";
    const document = parseBechaml(source);
    assert.deepEqual(document.diagnostics, []);

    const list = document.root?.value;
    assert.equal(list?.kind, "List");

    const items = "List" === list?.kind ? list.items : [];
    const summary = items.map(item =>
    {
        switch (item.kind)
        {
            case "Bool":
            case "Integer":
            case "Float":
            case "String":
                return item.kind + " " + JSON.stringify(item.value);
            case "Color":
                return "Color " + [item.red, item.green, item.blue, item.alpha].join(" ");
            case "List":
                return "List " + item.items.map(inner => inner.kind).join(" ");
            case "Reference":
                return "Reference " + item.segments.join(" ");
            case "Invalid":
                return "Invalid";
        }
    });

    assert.deepEqual(summary,
        [
            "Bool true",
            "Bool false",
            "Integer 16",
            "Integer -3",
            "Float 56.7",
            "Float 0.001",
            "String \"a\\\"b\\\\c\\nd\\te\"",
            "Color 22 22 29 255",
            "Color 17 68 255 128",
            "List Float Integer",
            "Reference Dictionary Colors Accent",
            "List "
        ]);
});

test("keeps a slot's C++ signature as it is, < and > included", () =>
{
    const source = "<Scene>\n    <Button>\n        <Slot Signal=\"OnClick\">std::vector<int> Values(std::map<int, float> table)</Slot>\n    </Button>\n</Scene>\n";
    const document = parseBechaml(source);

    assert.deepEqual(document.diagnostics, []);
    assert.equal(element(element(document.root, "Button"), "Slot").rawText?.text, "std::vector<int> Values(std::map<int, float> table)");
    assertLossless(source);
});

test("reports mistakes at their line and column", () =>
{
    const cases: [string, string[]][] =
    [
        ["<Scene>\n    <Button Name=\"A\">\n</Scene>", ["2:6 <Button> isn't closed: </Button> is missing before </Scene>."]],
        ["<Scene>\n</Button>\n</Scene>", ["2:1 </Button> closes nothing: <Scene> is open here."]],
        ["<Scene>", ["1:2 <Scene> isn't closed: </Scene> is missing."]],
        ["<Text>\"OK\"<Border/></Text>", ["1:12 <Text> holds either one value or elements, not both."]],
        ["<A>1 2</A>", ["1:6 <A> holds one value; this is a second one."]],
        ["<Border Width=2.0 Width=3.0/>", ["1:19 Width is given twice on <Border>."]],
        ["<Window Width=1280, Height=720/>", ["1:19 Attributes are separated by spaces, not commas."]],
        ["<Window Height\"720\"/>", ["1:15 Height needs = before its value."]],
        ["<A Size=.5/>", ["1:9 .5 needs a digit before the point: write 0.5."]],
        ["<A Size=5./>", ["1:9 5. needs a digit after the point: write 5.0."]],
        ["<A Size=+5/>", ["1:9 Numbers have no + sign: write 5."]],
        ["<A Size=2px/>", ["1:9 2px isn't a number."]],
        ["<A IsOn=true/>", ["1:9 Write True: bools are True and False."]],
        ["<A Position=Top/>", ["1:13 Top needs quotes: \"Top\". Text and enum values are strings."]],
        ["<A Color=#12345/>", ["1:10 #12345 isn't a color: write # and 6 or 8 hex digits, #RRGGBB or #RRGGBBAA."]],
        ["<A Path=\"C:\\Users\"/>", ["1:12 \\U isn't an escape. Strings know \\\", \\\\, \\n and \\t; paths take / instead of \\."]],
        ["<A Name=\"open/>", ["1:2 <A> isn't closed: > is missing.", "1:9 The string isn't closed: \" is missing before the end of the line."]],
        ["<A <!-- note --> Width=1/>", ["1:4 Comments can't go inside a tag."]],
        ["<A>{ 1, <!-- x --> 2 }</A>", ["1:9 Comments can't go inside a list."]],
        ["<A>{ 1 2 }</A>", ["1:8 A comma is missing between the list's values."]],
        ["<A>{ , 1 }</A>", ["1:6 A value is missing before this comma."]],
        ["<A>{ 1, 2</A>", ["1:4 The list isn't closed: } is missing."]],
        ["<A Width=/>", ["1:4 Width= needs a value."]],
        ["<A Colors:Hover:Clicked=#FFFFFF/>", ["1:4 Colors:Hover:Clicked has more than one colon. A colon names one color state, as in Colors:Hover."]],
        ["<A>Colors:Hover</A>", ["1:4 Colors:Hover isn't a value: a colon only goes in attribute names, as in Colors:Hover."]],
        ["<A/><B/>", ["1:6 A file has one root element; <B> is a second one."]],
        ["<!-- only a comment -->", ["1:1 The file has no root element. It needs one, such as <Scene>."]],
        ["hello <A/>", ["1:1 Text can't go outside the root element."]],
        ["<?xml version=\"1.0\"?>\n<A/>", ["1:1 An XML declaration isn't needed: .bechaml files are always UTF-8."]],
        ["<A><!-- open</A>", ["1:2 <A> isn't closed: </A> is missing.", "1:4 The comment isn't closed: --> is missing."]],
        ["<A></A >\n</A>", ["2:1 </A> closes nothing: no element is open here."]],
        ["<Window.WindowBar/>", ["1:2 <Window.WindowBar> isn't an element name: names have no ., and a : only names a color state, as in <RotateZ:Hover>, or comes after Prefab. A part is an element of its own inside its widget, such as <Border> inside <Button>."]],
        ["<@Inner.ButtonUp/>", ["1:2 <@Inner.ButtonUp> isn't an element name: names have no ., and a : only names a color state, as in <RotateZ:Hover>, or comes after Prefab. A part is an element of its own inside its widget, such as <Border> inside <Button>."]],
        ["<Prefab:Stepper:Slider/>", ["1:2 <Prefab:Stepper:Slider> isn't an element name: names have no ., and a : only names a color state, as in <RotateZ:Hover>, or comes after Prefab. A part is an element of its own inside its widget, such as <Border> inside <Button>."]],
        ["<RotateZ:Hover:Clicked/>", ["1:2 <RotateZ:Hover:Clicked> isn't an element name: names have no ., and a : only names a color state, as in <RotateZ:Hover>, or comes after Prefab. A part is an element of its own inside its widget, such as <Border> inside <Button>."]],
        ["<A OnClick=@Bars/>", ["1:12 @Bars names a widget; a value calls one of its functions, such as @Bars.StepUp."]],
        ["<A OnClick=@/>", ["1:12 @ isn't a value."]],
        ["<Prefab/>", ["1:2 <Prefab> needs a Name, written as a string: Name=\"StepperSlider\".", "1:2 <Prefab> needs its root container inside it, such as <Lasagna>."]],
        ["<Prefab Name=\"A\"><Lasagna/><Button/></Prefab>", ["1:29 A prefab holds one root container; put <Button> inside it."]],
        ["<Scene><Prefab Name=\"A\"><Lasagna/></Prefab></Scene>", ["1:9 <Prefab> only starts a prefab file; a prefab is placed as <Prefab:Name>, such as <Prefab:StepperSlider>."]]
    ];

    for (const [source, expected] of cases)
    {
        assert.deepEqual(errors(source), expected, source);
        assertLossless(source);
    }
});

test("counts lines across \\r\\n, \\n and \\r", () =>
{
    const lineMap = new LineMap("ab\r\ncd\ne\rf");
    assert.deepEqual(lineMap.position(0), { line: 1, column: 1 });
    assert.deepEqual(lineMap.position(3), { line: 1, column: 4 });
    assert.deepEqual(lineMap.position(4), { line: 2, column: 1 });
    assert.deepEqual(lineMap.position(7), { line: 3, column: 1 });
    assert.deepEqual(lineMap.position(9), { line: 4, column: 1 });
});

test("reads a single value, as typed into a form", () =>
{
    assert.equal(parseBechamlValue("\"0.2.0\"").value.kind, "String");
    assert.deepEqual(parseBechamlValue("\"0.2.0\"").diagnostics, []);
    assert.equal(parseBechamlValue("").diagnostics[0]?.message, "No value is given.");
    assert.equal(parseBechamlValue("\"a\" \"b\"").diagnostics[0]?.message, "Only one value can go here.");
    assert.equal(parseBechamlValue("Top").diagnostics.length, 1);
});

//A tiny seeded random generator, so a failing case can be found again.
function random(seed: number): () => number
{
    return () =>
    {
        seed = (seed + 0x6D2B79F5) | 0;
        let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

test("never throws and stays lossless on broken files", { timeout: 60000 }, () =>
{
    const next = random(1);
    const pieces = ["<", ">", "/", "=", "\"", "{", "}", ",", "#", ".", ":", "!--", "-->", " ", "\n", "\r", "\\", "A", "1", "</", "/>", "<Slot>", "</Slot>", "😀"];

    for (const fixture of fixtures)
    {
        for (let round = 0; 300 > round; ++round)
        {
            let source = fixture.text;

            for (let change = 1 + Math.floor(next() * 4); 0 < change; --change)
            {
                const at = Math.floor(next() * (source.length + 1));
                const length = Math.floor(next() * 12);
                const piece = pieces[Math.floor(next() * pieces.length)] ?? "";
                const kind = next();

                if (0.4 > kind)
                    source = source.slice(0, at) + source.slice(at + length);
                else if (0.8 > kind)
                    source = source.slice(0, at) + piece + source.slice(at);
                else
                    source = source.slice(0, at) + source.slice(at, at + length) + source.slice(at);
            }

            assertLossless(source);
        }
    }
});