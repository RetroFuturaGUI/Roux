import type { FileProblem } from "@retrofuturagui/roux-protocol";
import { LineMap } from "../bechaml/LineMap.js";
import type { Diagnostic, Element, Value } from "../bechaml/Syntax.js";

//Reads typed values out of elements, collecting a diagnostic for each value of the wrong kind. A missing element or value
//reads as empty, since the forms show what isn't set as empty
export class ValueReader
{
    readonly problems: Diagnostic[] = [];

    string(element: Element | undefined, example: string): string
    {
        return this.stringValue(element?.value, element, example);
    }

    stringValue(value: Value | undefined, where: Element | undefined, example: string): string
    {
        if (!value)
            return "";

        if ("String" === value.kind)
            return value.value;

        this.problems.push({ start: value.start, end: value.end, message: "<" + (where?.name ?? "") + "> holds a string, such as " + example + "." });
        return "";
    }

    strings(element: Element | undefined, example: string): string[]
    {
        const value = element?.value;

        if (!value)
            return [];

        if ("List" === value.kind && value.items.every(item => "String" === item.kind))
            return value.items.map(item => "String" === item.kind ? item.value : "");

        this.problems.push({ start: value.start, end: value.end, message: "<" + (element?.name ?? "") + "> holds a list of strings, such as " + example + "." });
        return [];
    }

    bool(element: Element | undefined): boolean
    {
        const value = element?.value;

        if (!value)
            return false;

        if ("Bool" === value.kind)
            return value.value;

        this.problems.push({ start: value.start, end: value.end, message: "<" + (element?.name ?? "") + "> holds True or False." });
        return false;
    }

    //A number as the form shows it: "25", "12.5".
    numberText(value: Value | undefined, what: string): string
    {
        if (!value)
            return "";

        if ("Integer" === value.kind || "Float" === value.kind)
            return String(value.value);

        this.problems.push({ start: value.start, end: value.end, message: what + " is a number, such as 25." });
        return "";
    }

    rootIs(root: Element | undefined, name: string, fileName: string): void
    {
        if (root && name !== root.name)
            this.problems.push({ start: root.start, end: root.start, message: fileName + "'s root element is <" + name + ">, not <" + root.name + ">." });
    }
}

export function toFileProblems(source: string, diagnostics: readonly Diagnostic[]): FileProblem[]
{
    const lineMap = new LineMap(source);

    return diagnostics.map(diagnostic =>
    {
        const position = lineMap.position(diagnostic.start);
        return { line: position.line, column: position.column, message: diagnostic.message };
    });
}

//A path relative to the project, with forward slashes. Empty when it's fine, else why it isn't.
export function relativePathMistake(path: string): string
{
    if (path.includes("\\"))
        return "Paths use /, not \\.";

    if (/^[A-Za-z]:|^\//.test(path))
        return "The path is relative to the project folder, not absolute.";

    if (path.split("/").some(part => "" === part.trim()))
        return "The path has an empty part.";

    return "";
}

export function isStringList(value: unknown): value is string[]
{
    return Array.isArray(value) && value.every(item => "string" === typeof item);
}

//The first name given twice, if one is.
export function duplicate(names: readonly string[]): string | undefined
{
    return names.find((name, index) => names.indexOf(name) !== index);
}