import { formatString } from "./Edit.js";
import { parseBechaml, parseBechamlValue } from "./Parser.js";
import { isToken, type Diagnostic, type Document, type Element, type Token } from "./Syntax.js";

//One step from an element to a child: <Charset Name="Emoji"> is { name: "Charset", key: { attribute: "Name", value: "Emoji" } }
export interface PathStep
{
    readonly name: string;
    readonly key?: { readonly attribute: string; readonly value: string };
    //When the element is added: the siblings it goes after, the last of them. Its own name when left out
    readonly after?: readonly string[];
}

//Steps from the root element, which isn't named in the path
export type ElementPath = readonly PathStep[];

//Changes a file element by element, keeping every other character, its layout and its line endings. Each change is
//checked by reading the file again: one that would add an error is refused, and every change after a refusal is skipped,
//so a caller either writes all of its changes or none
export class BechamlEditor
{
    private _document: Document;
    private _refusal: readonly Diagnostic[] | undefined;

    constructor(document: Document)
    {
        this._document = document;
    }

    get document(): Document
    {
        return this._document;
    }

    get text(): string
    {
        return this._document.source;
    }

    //Why the first refused change was refused; undefined while every change went through
    get refusal(): readonly Diagnostic[] | undefined
    {
        return this._refusal;
    }

    find(path: ElementPath): Element | undefined
    {
        let element = this._document.root;

        for (const step of path)
        {
            if (!element)
                return undefined;

            element = findChild(element, step);
        }

        return element;
    }

    //Finds the element, adding the missing ones along the path, each after its last sibling of the same name (or of a name in its step's after)
    ensure(path: ElementPath): Element | undefined
    {
        for (let length = 1; path.length >= length; ++length)
        {
            const step = path[length - 1];

            if (!step || this.find(path.slice(0, length)))
                continue;

            const parent = this.find(path.slice(0, length - 1));

            if (!parent || !this.insertChild(parent, "<" + step.name + keyText(step) + "/>", step.after ?? [step.name]))
                return undefined;
        }

        return this.find(path);
    }

    //Sets an element's value, adding the element when it's missing. valueText is written as it is, so it has to be one
    //value: formatString's, formatList's and so on.
    setValue(path: ElementPath, valueText: string): boolean
    {
        if (!this.isValue(valueText))
            return false;

        const element = this.find(path);

        if (!element)
        {
            const step = path[path.length - 1];
            const parent = this.ensure(path.slice(0, -1));

            if (!step || !parent)
                return this.refuse("There's no element to set the value in.");

            return this.insertChild(parent, "<" + step.name + keyText(step) + ">" + valueText + "</" + step.name + ">", step.after ?? [step.name]);
        }

        if (element.value)
            return this.splice(element.value.start, element.value.end, valueText);

        const end = tagEnd(element);

        if (!end)
            return this.refuse("<" + element.name + "> has no end to its tag.");

        if (element.isSelfClosing)
            return this.splice(trimmedStart(this.text, end.start), element.end, ">" + valueText + "</" + element.name + ">");

        const close = closeTagStart(element);
        const between = this.text.slice(end.end, close);

        if (/^[ \t\r\n]*$/.test(between))
            return this.splice(end.end, close, valueText);

        return this.splice(end.end, end.end, valueText);
    }

    setAttribute(path: ElementPath, name: string, valueText: string): boolean
    {
        if (!this.isValue(valueText))
            return false;

        const element = this.ensure(path);

        if (!element)
            return this.refuse("There's no element to set " + name + " on.");

        const attribute = element.attributes.find(entry => name === entry.name);

        if (attribute?.value)
            return this.splice(attribute.value.start, attribute.value.end, valueText);

        if (attribute)
            return this.splice(attribute.end, attribute.end, "=" + valueText);

        const last = element.attributes[element.attributes.length - 1] ?? element.nameToken;

        if (!last)
            return this.refuse("<" + element.name + "> has no name.");

        return this.splice(last.end, last.end, " " + name + "=" + valueText);
    }

    //Removes the attribute and the spaces before it. A missing one is fine: there's nothing to remove
    removeAttribute(path: ElementPath, name: string): boolean
    {
        const element = this.find(path);
        const attribute = element?.attributes.find(entry => name === entry.name);

        if (!element || !attribute)
            return !this._refusal;

        const index = element.children.indexOf(attribute);
        const before = element.children[index - 1];
        const start = before && isToken(before) && "Whitespace" === before.kind ? before.start : attribute.start;
        return this.splice(start, attribute.end, "");
    }

    //Removes the element. When it has its line to itself, the whole line goes, with a comment after it on that line
    remove(path: ElementPath): boolean
    {
        const element = this.find(path);

        if (!element)
            return !this._refusal;

        const source = this.text;
        const lineStart = startOfLine(source, element.start);

        if (!/^[ \t]*$/.test(source.slice(lineStart, element.start)))
            return this.splice(element.start, element.end, "");

        const lineBreak = this.lineBreakAfter(element);

        if (undefined === lineBreak)
            return this.splice(element.start, element.end, "");

        const breakLength = source.startsWith("\r\n", lineBreak) ? 2 : 1;
        return this.splice(lineStart, lineBreak + breakLength, "");
    }

    private isValue(valueText: string): boolean
    {
        if (this._refusal)
            return false;

        const parsed = parseBechamlValue(valueText);

        if (0 < parsed.diagnostics.length)
        {
            this._refusal = parsed.diagnostics;
            return false;
        }

        return true;
    }

    //Puts the new element on a line of its own, indented like its siblings: after the last sibling named in afterNames, else
    //after the last child, else as the first child.
    private insertChild(parent: Element, elementText: string, afterNames: readonly string[]): boolean
    {
        const source = this.text;
        const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
        const anchor = parent.elements.findLast(element => afterNames.includes(element.name)) ?? parent.elements[parent.elements.length - 1];

        if (anchor)
        {
            const at = this.lineBreakAfter(anchor) ?? anchor.end;
            return this.splice(at, at, lineEnding + lineIndent(source, anchor.start) + elementText);
        }

        const parentIndent = lineIndent(source, parent.start);
        const indent = parentIndent + this.indentUnit();
        const end = tagEnd(parent);

        if (!end)
            return this.refuse("<" + parent.name + "> has no end to its tag.");

        if (parent.isSelfClosing)
            return this.splice(trimmedStart(source, end.start), parent.end, ">" + lineEnding + indent + elementText + lineEnding + parentIndent + "</" + parent.name + ">");

        const hasLineBreak = /[\r\n]/.test(source.slice(end.end, closeTagStart(parent)));
        return this.splice(end.end, end.end, lineEnding + indent + elementText + (hasLineBreak ? "" : lineEnding + parentIndent));
    }

    //Where the element's line ends: past spaces and comments on the same line, at the line break. Undefined when something
    //else follows on that line.
    private lineBreakAfter(element: Element): number | undefined
    {
        const parent = this.parentOf(element);
        const siblings = parent ? parent.children : this._document.children;

        for (const child of siblings.slice(siblings.indexOf(element) + 1))
        {
            if (!isToken(child))
                return undefined;

            if ("Comment" === child.kind)
                continue;

            if ("Whitespace" !== child.kind)
                return undefined;

            const lineBreak = child.text.search(/[\r\n]/);

            if (0 <= lineBreak)
                return child.start + lineBreak;
        }

        return undefined;
    }

    private parentOf(target: Element): Element | undefined
    {
        const visit = (element: Element): Element | undefined =>
        {
            if (element.elements.includes(target))
                return element;

            for (const child of element.elements)
            {
                const found = visit(child);

                if (found)
                    return found;
            }

            return undefined;
        };

        const root = this._document.root;
        return root && root !== target ? visit(root) : undefined;
    }

    //How far the root's children are indented, four spaces when it has none.
    private indentUnit(): string
    {
        const root = this._document.root;
        const first = root?.elements[0];

        if (!root || !first)
            return "    ";

        const rootIndent = lineIndent(this.text, root.start);
        const childIndent = lineIndent(this.text, first.start);
        return childIndent.length > rootIndent.length && childIndent.startsWith(rootIndent) ? childIndent.slice(rootIndent.length) : "    ";
    }

    private splice(start: number, end: number, replacement: string): boolean
    {
        if (this._refusal)
            return false;

        const text = this.text.slice(0, start) + replacement + this.text.slice(end);
        const edited = parseBechaml(text);

        if (edited.diagnostics.length > this._document.diagnostics.length)
        {
            this._refusal = edited.diagnostics;
            return false;
        }

        this._document = edited;
        return true;
    }

    private refuse(message: string): boolean
    {
        this._refusal ??= [{ start: 0, end: 0, message: message }];
        return false;
    }
}

export function findChild(parent: Element, step: PathStep): Element | undefined
{
    return parent.elements.find(element => step.name === element.name && (!step.key || step.key.value === stringAttribute(element, step.key.attribute)));
}

//An attribute's string value; undefined when it's missing or isn't a string.
export function stringAttribute(element: Element, name: string): string | undefined
{
    const value = element.attributes.find(attribute => name === attribute.name)?.value;
    return "String" === value?.kind ? value.value : undefined;
}

function keyText(step: PathStep): string
{
    return step.key ? " " + step.key.attribute + "=" + formatString(step.key.value) : "";
}

//The > or /> that ends the element's own tag.
function tagEnd(element: Element): Token | undefined
{
    return element.children.find((child): child is Token => isToken(child) && ("TagEnd" === child.kind || "SelfCloseTagEnd" === child.kind));
}

function closeTagStart(element: Element): number
{
    return element.children.findLast(child => isToken(child) && "OpenCloseTag" === child.kind)?.start ?? element.end;
}

//Moves back over spaces before offset, so "<A />" loses its space along with the "/>".
function trimmedStart(source: string, offset: number): number
{
    while (0 < offset && /[ \t\r\n]/.test(source[offset - 1] ?? ""))
        --offset;

    return offset;
}

function startOfLine(source: string, offset: number): number
{
    let start = offset;

    while (0 < start && "\n" !== source[start - 1] && "\r" !== source[start - 1])
        --start;

    return start;
}

//The spaces and tabs a line starts with.
function lineIndent(source: string, offset: number): string
{
    const start = startOfLine(source, offset);
    return /^[ \t]*/.exec(source.slice(start, offset))?.[0] ?? "";
}
