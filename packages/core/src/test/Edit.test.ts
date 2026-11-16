import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { formatBool, formatColor, formatFloat, formatInteger, formatList, formatString, replaceValue } from "../bechaml/Edit.js";
import { parseBechaml, parseBechamlValue } from "../bechaml/Parser.js";
import type { Document, Value } from "../bechaml/Syntax.js";

const project = readFileSync(new URL("../../src/test/fixtures/Project.bechaml", import.meta.url), "utf8");

function projectValue(document: Document, name: string): Value
{
    const value = document.root?.elements.find(element => name === element.name)?.value;
    assert.ok(value, "<" + name + "> has no value");
    return value;
}

test("replaces one value and leaves every other character as it was", () =>
{
    for (const source of [project, project.replace(/\n/g, "\r\n")])
    {
        const document = parseBechaml(source);
        const result = replaceValue(document, projectValue(document, "Version"), "\"0.2.0\"");

        assert.ok(result.isApplied);
        assert.equal(result.text, source.replace("<Version>\"0.1.0\"</Version>", "<Version>\"0.2.0\"</Version>"));
        assert.deepEqual(result.document.diagnostics, []);

        const platforms = replaceValue(result.document, projectValue(result.document, "Platforms"), formatList(["Windows", "Wii"].map(formatString)));
        assert.ok(platforms.isApplied);
        assert.ok(platforms.text.includes("<Platforms>{ \"Windows\", \"Wii\" }</Platforms>\n") || platforms.text.includes("<Platforms>{ \"Windows\", \"Wii\" }</Platforms>\r\n"));
        assert.ok(platforms.text.includes("<!-- binary and CMake name; may differ from the app name -->"));
    }
});

test("refuses a replacement that isn't exactly one valid value", () =>
{
    const document = parseBechaml(project);
    const version = projectValue(document, "Version");

    for (const replacement of ["\"0.2.0", "\"a\" \"b\"", "Top", "", " \"0.2.0\"", "\"0.2.0\" <!-- new -->"])
    {
        const result = replaceValue(document, version, replacement);
        assert.equal(result.isApplied, false, replacement);
        assert.ok(!result.isApplied && 0 < result.diagnostics.length, replacement);
    }
});

test("writes values that read back as the same values", () =>
{
    const text = "a\"b\\c\nd\te ü 😀";
    const string = parseBechamlValue(formatString(text)).value;
    assert.equal("String" === string.kind ? string.value : undefined, text);
    assert.throws(() => formatString("line\r\nbreak"), RangeError);

    assert.equal(formatFloat(2), "2.0");
    assert.equal(formatFloat(0.15), "0.15");
    assert.equal(formatFloat(-3), "-3.0");

    for (const value of [2, 0.15, 1e-7, 1e21, -3])
    {
        const read = parseBechamlValue(formatFloat(value)).value;
        assert.equal(read.kind, "Float");
        assert.equal("Float" === read.kind ? read.value : undefined, value);
    }

    assert.throws(() => formatFloat(Number.NaN), RangeError);
    assert.equal(formatInteger(25), "25");
    assert.throws(() => formatInteger(2.5), RangeError);
    assert.equal(formatBool(true), "True");
    assert.equal(formatColor(17, 68, 255), "#1144FF");
    assert.equal(formatColor(17, 68, 255, 128), "#1144FF80");
    assert.throws(() => formatColor(256, 0, 0), RangeError);
    assert.equal(formatList([]), "{ }");
    assert.deepEqual(parseBechamlValue(formatList([formatInteger(1), formatColor(0, 0, 0)])).diagnostics, []);
});