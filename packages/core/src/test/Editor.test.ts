import assert from "node:assert/strict";
import { test } from "node:test";
import { BechamlEditor } from "../bechaml/Editor.js";
import { parseBechaml } from "../bechaml/Parser.js";

function editor(source: string): BechamlEditor
{
    const document = parseBechaml(source);
    assert.deepEqual(document.diagnostics, []);
    return new BechamlEditor(document);
}

const windows = { name: "Platform", key: { attribute: "Name", value: "Windows" } };

test("replaces a value, fills an empty element and adds a missing one under its last sibling", () =>
{
    const edit = editor("<Project>\n    <Name>\"A\"</Name>   <!-- the binary -->\n    <LayoutFile/>\n    <Empty></Empty>\n</Project>\n");

    assert.ok(edit.setValue([{ name: "Name" }], "\"B\""));
    assert.ok(edit.setValue([{ name: "LayoutFile" }], "\"x.ini\""));
    assert.ok(edit.setValue([{ name: "Empty" }], "{ }"));
    assert.ok(edit.setValue([{ name: "Version" }], "\"0.1.0\""));
    assert.equal(edit.text, "<Project>\n    <Name>\"B\"</Name>   <!-- the binary -->\n    <LayoutFile>\"x.ini\"</LayoutFile>\n    <Empty>{ }</Empty>\n    <Version>\"0.1.0\"</Version>\n</Project>\n");
});

test("adds a new element after the comment on its sibling's line, keeping \\r\\n", () =>
{
    const edit = editor("<Project>\r\n    <Name>\"A\"</Name>   <!-- the binary -->\r\n</Project>\r\n");

    assert.ok(edit.setValue([{ name: "Version" }], "\"0.1.0\""));
    assert.equal(edit.text, "<Project>\r\n    <Name>\"A\"</Name>   <!-- the binary -->\r\n    <Version>\"0.1.0\"</Version>\r\n</Project>\r\n");
});

test("builds a keyed block with its children, opening a self-closing parent", () =>
{
    const edit = editor("<Project>\n    <Platform Name=\"Linux\">\n        <Compiler>\"GCC\"</Compiler>\n    </Platform>\n    <License>\"MIT\"</License>\n</Project>\n");

    assert.ok(edit.setAttribute([windows, { name: "Language" }], "Name", "\"C++\""));
    assert.ok(edit.setAttribute([windows, { name: "Language" }], "Standard", "\"23\""));
    assert.ok(edit.setValue([windows, { name: "Compiler" }], "\"MSVC\""));
    assert.equal(edit.text,
        "<Project>\n" +
        "    <Platform Name=\"Linux\">\n" +
        "        <Compiler>\"GCC\"</Compiler>\n" +
        "    </Platform>\n" +
        "    <Platform Name=\"Windows\">\n" +
        "        <Language Name=\"C++\" Standard=\"23\"/>\n" +
        "        <Compiler>\"MSVC\"</Compiler>\n" +
        "    </Platform>\n" +
        "    <License>\"MIT\"</License>\n" +
        "</Project>\n");

    const empty = editor("<AppSettings/>");
    assert.ok(empty.setValue([{ name: "AppName" }], "\"Test\""));
    assert.equal(empty.text, "<AppSettings>\n    <AppName>\"Test\"</AppName>\n</AppSettings>");
});

test("removes an element with its line and comment, or only itself when it shares the line", () =>
{
    const edit = editor("<A>\n    <B/>   <!-- note -->\n    <C/> <D/>\n</A>\n");

    assert.ok(edit.remove([{ name: "B" }]));
    assert.ok(edit.remove([{ name: "D" }]));
    assert.ok(edit.remove([{ name: "Missing" }]));
    assert.equal(edit.text, "<A>\n    <C/> \n</A>\n");
});

test("sets, completes and removes attributes", () =>
{
    const edit = editor("<A>\n    <Slot Async/>\n    <Font Family=\"Noto Sans\" Size=25/>\n</A>");

    assert.ok(edit.setAttribute([{ name: "Slot" }], "Async", "False"));
    assert.ok(edit.setAttribute([{ name: "Font" }], "Size", "18"));
    assert.ok(edit.setAttribute([{ name: "Font" }], "Unit", "\"Points\""));
    assert.ok(edit.removeAttribute([{ name: "Font" }], "Family"));
    assert.equal(edit.text, "<A>\n    <Slot Async=False/>\n    <Font Size=18 Unit=\"Points\"/>\n</A>");
});

test("refuses an invalid value and skips every change after it", () =>
{
    const source = "<A>\n    <B>1</B>\n</A>";
    const edit = editor(source);

    assert.equal(edit.setValue([{ name: "B" }], "Top"), false);
    assert.equal(edit.setValue([{ name: "B" }], "2"), false);
    assert.equal(edit.text, source);
    assert.match(edit.refusal?.[0]?.message ?? "", /needs quotes/);

    const mixed = editor("<A>\n    <B>1</B>\n</A>");
    assert.equal(mixed.setValue([{ name: "B" }, { name: "C" }], "2"), false, "a value and elements can't mix");
    assert.equal(mixed.text, "<A>\n    <B>1</B>\n</A>");
});
