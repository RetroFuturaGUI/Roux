import { parseBechaml, parseBechamlValue } from "./Parser.js";
import type { Diagnostic, Document, Value } from "./Syntax.js";

export type EditResult =
    | { readonly isApplied: true; readonly text: string; readonly document: Document }
    | { readonly isApplied: false; readonly diagnostics: readonly Diagnostic[] };

//Replaces one value's text and leaves every other character of the file as it was. A replacement that isn't exactly one
//valid value is refused, and so is an edit after which the file would have more errors, so an invalid value is never
//written. The refusal's diagnostics count from the start of the replacement, or of the file when the file is to blame
export function replaceValue(document: Document, target: Value, replacement: string): EditResult
{
    const parsed = parseBechamlValue(replacement);

    if (0 < parsed.diagnostics.length)
        return { isApplied: false, diagnostics: parsed.diagnostics };

    const text = document.source.slice(0, target.start) + replacement + document.source.slice(target.end);
    const edited = parseBechaml(text);

    if (edited.diagnostics.length > document.diagnostics.length)
        return { isApplied: false, diagnostics: edited.diagnostics };

    return { isApplied: true, text: text, document: edited };
}

//Writes a string with the escapes it needs. A string stays on one line, so a line break other than \n can't be written
export function formatString(text: string): string
{
    if (text.includes("\r"))
        throw new RangeError("A .bechaml string can't hold a carriage return.");

    return "\"" + text.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + "\"";
}

//2 becomes 2.0, so the value stays a float when it is read again
export function formatFloat(value: number): string
{
    if (!Number.isFinite(value))
        throw new RangeError(value + " can't be written as a .bechaml number.");

    const text = String(value);
    return /[.e]/.test(text) ? text : text + ".0";
}

export function formatInteger(value: number): string
{
    if (!Number.isSafeInteger(value))
        throw new RangeError(value + " isn't a whole number that .bechaml can hold.");

    return String(value);
}

export function formatBool(value: boolean): string
{
    return value ? "True" : "False";
}

//Channels from 0 to 255. The alpha is left out when the color is opaque
export function formatColor(red: number, green: number, blue: number, alpha = 255): string
{
    const channels = 255 === alpha ? [red, green, blue] : [red, green, blue, alpha];

    for (const channel of channels)
    {
        if (!Number.isInteger(channel) || 0 > channel || 255 < channel)
            throw new RangeError("A color channel is a whole number from 0 to 255, not " + channel + ".");
    }

    return "#" + channels.map(channel => channel.toString(16).toUpperCase().padStart(2, "0")).join("");
}

//Takes values already written, such as formatString's: { "Video", "Audio" }
export function formatList(items: readonly string[]): string
{
    return 0 === items.length ? "{ }" : "{ " + items.join(", ") + " }";
}
