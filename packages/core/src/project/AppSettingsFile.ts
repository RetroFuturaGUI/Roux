import type { AppEdit, AppSettingValue, AppValues, Charset } from "@retrofuturagui/roux-protocol";
import { formatFloat, formatInteger, formatList, formatString } from "../bechaml/Edit.js";
import { BechamlEditor, findChild, stringAttribute, type ElementPath } from "../bechaml/Editor.js";
import type { Diagnostic, Document, Element } from "../bechaml/Syntax.js";
import { capabilityNames, platformGroups, platformNames } from "./Catalog.js";
import { duplicate, isStringList, ValueReader } from "./Values.js";

export const allScope = "All";

//The keys that are an element of their own in a scope.
const elementKeys: Record<string, string> =
{
    appName: "AppName",
    transitions: "Transitions",
    layoutFile: "LayoutFile",
    renderers: "Renderers",
    requires: "Requires"
};

const listKeys = new Set(["renderers", "requires"]);

//The keys that are attributes of the scope's <DefaultFont>.
const fontAttributes: Record<string, string> =
{
    fontFamily: "Family",
    fontSize: "Size",
    fontUnit: "Unit"
};

const fontKeyPrefix = "font:";

//The other elements App Settings know, besides the keys' own.
const otherElements = ["DefaultFont", "Charsets", "CharsetFont", "WindowSystems"];

//A platform's or group's block is named after it: <Windows>, <Desktop>.
function isScope(name: string): boolean
{
    return platformNames.includes(name) || Object.hasOwn(platformGroups, name);
}

//A new block goes after the other platforms' and groups' blocks.
function scopePath(scope: string): ElementPath
{
    return allScope === scope ? [] : [{ name: scope, after: [...Object.keys(platformGroups), ...platformNames] }];
}

function charsetFontStep(charset: string)
{
    return { name: "CharsetFont", key: { attribute: "Charset", value: charset } };
}

function charsetStep(name: string)
{
    return { name: "Charset", key: { attribute: "Name", value: name } };
}

export function readAppSettings(document: Document, fileName: string): { values: AppValues; problems: Diagnostic[] }
{
    const root = document.root;
    const reader = new ValueReader();
    reader.rootIs(root, "AppSettings", fileName);

    const scopes: Record<string, Record<string, AppSettingValue>> = {};

    if (root)
        scopes[allScope] = readScope(root, reader);

    for (const block of root?.elements ?? [])
    {
        if (isScope(block.name))
            scopes[block.name] = readScope(block, reader);
        else if (!Object.values(elementKeys).includes(block.name) && !otherElements.includes(block.name))
            reader.problems.push({ start: (block.nameToken ?? block).start, end: (block.nameToken ?? block).end, message: "<" + block.name + "> is neither an App Setting nor a platform or group. They are " + [...Object.keys(platformGroups), ...platformNames].join(", ") + "." });
    }

    const charsets: Charset[] = [];

    for (const charset of (root && findChild(root, { name: "Charsets" }))?.elements ?? [])
    {
        if ("Charset" === charset.name)
            charsets.push({ name: stringAttribute(charset, "Name") ?? "", blocks: reader.strings(charset, "{ \"Hiragana\", \"Katakana\" }") });
    }

    return { values: { scopes: scopes, charsets: charsets }, problems: reader.problems };
}

//What a scope sets itself: a key only when its element or attribute is there.
function readScope(scope: Element, reader: ValueReader): Record<string, AppSettingValue>
{
    const settings: Record<string, AppSettingValue> = {};

    for (const [key, name] of Object.entries(elementKeys))
    {
        const element = findChild(scope, { name: name });

        if (element)
            settings[key] = listKeys.has(key) ? reader.strings(element, "{ \"OpenGL\" }") : reader.string(element, "\"Off\"");
    }

    const font = findChild(scope, { name: "DefaultFont" });

    for (const [key, name] of Object.entries(fontAttributes))
    {
        const attribute = font?.attributes.find(entry => name === entry.name);

        if (attribute)
            settings[key] = "fontSize" === key ? reader.numberText(attribute.value, "The font size") : reader.stringValue(attribute.value, font, "\"Noto Sans\"");
    }

    for (const element of scope.elements)
    {
        const charset = "CharsetFont" === element.name ? stringAttribute(element, "Charset") : undefined;

        if (undefined !== charset)
            settings[fontKeyPrefix + charset] = reader.string(element, "\"Noto Sans CJK JP\"");
    }

    return settings;
}

//Checks that a value from outside has the shape of an edit, so the rest of the core can trust the types.
export function isAppEdit(edit: unknown): edit is AppEdit
{
    if ("object" !== typeof edit || null === edit || !("kind" in edit))
        return false;

    const fields = edit as Record<string, unknown>;

    switch (fields.kind)
    {
        case "set":
            return "string" === typeof fields.scope && "string" === typeof fields.key && ("string" === typeof fields.value || isStringList(fields.value));
        case "reset":
            return "string" === typeof fields.scope && isStringList(fields.keys);
        case "charset":
        {
            const charset = fields.charset as Partial<Charset> | null;
            return Number.isInteger(fields.index) && "object" === typeof charset && null !== charset && "string" === typeof charset.name && isStringList(charset.blocks);
        }
        case "removeCharset":
            return Number.isInteger(fields.index);
        default:
            return false;
    }
}

//Empty when the edit can be written, else why it can't.
export function appEditMistake(values: AppValues, edit: AppEdit): string
{
    if ("charset" === edit.kind)
    {
        if (0 > edit.index || values.charsets.length < edit.index)
            return "There's no character set " + edit.index + ".";

        if ("" === edit.charset.name.trim())
            return "A character set needs a name.";

        if (values.charsets.some((charset, index) => index !== edit.index && edit.charset.name === charset.name))
            return "There's a character set named " + edit.charset.name + " already.";

        if (edit.charset.blocks.some(block => "" === block.trim()))
            return "A Unicode block needs a name.";

        const twice = duplicate(edit.charset.blocks);
        return undefined === twice ? "" : twice + " is listed twice.";
    }

    if ("removeCharset" === edit.kind)
        return 0 <= edit.index && values.charsets.length > edit.index ? "" : "There's no character set " + edit.index + ".";

    if (allScope !== edit.scope && !isScope(edit.scope))
        return edit.scope + " isn't a platform or group.";

    const keys = "set" === edit.kind ? [edit.key] : edit.keys;

    for (const key of keys)
    {
        if (!Object.hasOwn(elementKeys, key) && !Object.hasOwn(fontAttributes, key) && !values.charsets.some(charset => fontKeyPrefix + charset.name === key))
            return key + " isn't an App Setting.";
    }

    if ("reset" === edit.kind)
        return "";

    const isList = listKeys.has(edit.key);

    if (isList !== Array.isArray(edit.value))
        return isList ? edit.key + " is a list." : edit.key + " is a single value.";

    if (Array.isArray(edit.value))
    {
        if (edit.value.some(item => "" === item.trim()))
            return "An entry needs a name.";

        const twice = duplicate(edit.value);

        if (undefined !== twice)
            return twice + " is listed twice.";

        const unknown = "requires" === edit.key ? edit.value.find(need => !capabilityNames.includes(need)) : undefined;
        return undefined === unknown ? "" : unknown + " isn't one of " + capabilityNames.join(", ") + ".";
    }

    switch (edit.key)
    {
        case "fontFamily":
            return "" === edit.value.trim() ? "A font family is needed; Reset removes the font." : "";
        case "fontSize":
            return /^\d+(\.\d+)?$/.test(edit.value) && 0 < Number(edit.value) ? "" : "A size is a number above 0, such as 25.";
        case "fontUnit":
            return "Points" === edit.value || "Pixels" === edit.value ? "" : "The unit is Points or Pixels.";
        case "transitions":
            return "Off" === edit.value || "On" === edit.value ? "" : "Transitions are Off or On.";
        default:
            return "";
    }
}

//The edited file's text, or why it can't be written. A reset that leaves a <DefaultFont> without attributes or a
//platform's or group's block without settings removes them too.
export function editAppSettings(document: Document, values: AppValues, edit: AppEdit): { text: string } | { message: string }
{
    const mistake = appEditMistake(values, edit);

    if (mistake)
        return { message: mistake };

    const editor = new BechamlEditor(document);

    switch (edit.kind)
    {
        case "set":
            setKey(editor, edit.scope, edit.key, edit.value);
            break;
        case "reset":
            for (const key of edit.keys)
                resetKey(editor, edit.scope, key);

            removeIfEmpty(editor, [...scopePath(edit.scope), { name: "DefaultFont" }], element => 0 === element.attributes.length);

            if (allScope !== edit.scope)
                removeIfEmpty(editor, scopePath(edit.scope), element => 0 === element.elements.length);

            break;
        case "charset":
            writeCharset(editor, values, edit.index, edit.charset);
            break;
        case "removeCharset":
        {
            const name = values.charsets[edit.index]?.name ?? "";
            editor.remove([{ name: "Charsets" }, charsetStep(name)]);

            for (const scope of Object.keys(values.scopes))
                editor.remove([...scopePath(scope), charsetFontStep(name)]);

            break;
        }
    }

    if (editor.refusal)
        return { message: "Can't write this: " + (editor.refusal[0]?.message ?? "the file would have an error.") };

    return { text: editor.text };
}

function setKey(editor: BechamlEditor, scope: string, key: string, value: AppSettingValue): void
{
    const path = scopePath(scope);

    if (Array.isArray(value))
    {
        editor.setValue([...path, { name: elementKeys[key] ?? key }], formatList(value.map(formatString)));
        return;
    }

    const attribute = fontAttributes[key];

    if (attribute)
    {
        const text = "fontSize" !== key ? formatString(value) : value.includes(".") ? formatFloat(Number(value)) : formatInteger(Number(value));
        editor.setAttribute([...path, { name: "DefaultFont" }], attribute, text);
        return;
    }

    const element = key.startsWith(fontKeyPrefix) ? charsetFontStep(key.slice(fontKeyPrefix.length)) : { name: elementKeys[key] ?? key };
    editor.setValue([...path, element], formatString(value));
}

function resetKey(editor: BechamlEditor, scope: string, key: string): void
{
    const path = scopePath(scope);
    const attribute = fontAttributes[key];

    if (attribute)
        editor.removeAttribute([...path, { name: "DefaultFont" }], attribute);
    else if (key.startsWith(fontKeyPrefix))
        editor.remove([...path, charsetFontStep(key.slice(fontKeyPrefix.length))]);
    else
        editor.remove([...path, { name: elementKeys[key] ?? key }]);
}

function removeIfEmpty(editor: BechamlEditor, path: ElementPath, isEmpty: (element: Element) => boolean): void
{
    const element = editor.find(path);

    if (element && isEmpty(element))
        editor.remove(path);
}

//Adds or changes a character set. A new name renames the set's fonts in every scope along with it.
function writeCharset(editor: BechamlEditor, values: AppValues, index: number, charset: Charset): void
{
    const blocks = formatList(charset.blocks.map(formatString));
    const old = values.charsets[index];

    if (!old)
    {
        editor.setValue([{ name: "Charsets" }, charsetStep(charset.name)], blocks);
        return;
    }

    if (old.name !== charset.name)
    {
        editor.setAttribute([{ name: "Charsets" }, charsetStep(old.name)], "Name", formatString(charset.name));

        for (const scope of Object.keys(values.scopes))
        {
            if (editor.find([...scopePath(scope), charsetFontStep(old.name)]))
                editor.setAttribute([...scopePath(scope), charsetFontStep(old.name)], "Charset", formatString(charset.name));
        }
    }

    editor.setValue([{ name: "Charsets" }, charsetStep(charset.name)], blocks);
}

export function newAppSettingsText(appName: string): string
{
    return [
        "<AppSettings>",
        "    <AppName>" + formatString(appName) + "</AppName>",
        "    <Renderers>{ \"OpenGL\" }</Renderers>",
        "    <Requires>{ }</Requires>",
        "</AppSettings>",
        ""
    ].join("\n");
}
