//Roux's regions in CMakeLists.txt (Roux plan, 6.2). A region runs from "# >>> Roux: <name>" to "# <<< Roux", and Roux
//rewrites everything inside it except kept blocks, "#<!--" … "#-->", which hold the project's own lines. Every line
//outside the regions is left as it is

//What Roux writes into one region
export interface RegionContent
{
    readonly name: string;
    readonly description: string; //What the start marker says after the name
    readonly lines: readonly string[]; //Without the markers.
}

export interface RegionProblem
{
    readonly line: number; //Counted from 1, in the text that was read
    readonly severity: "error" | "warning";
    readonly message: string;
}

//The new text, or undefined when an error leaves the file as it is; problems hold the warnings too
export interface RegionUpdate
{
    readonly text: string | undefined;
    readonly problems: readonly RegionProblem[];
}

interface KeptBlock
{
    readonly lines: string[];
    readonly line: number; //Where it starts, counted from 0
    readonly anchor: string | undefined; //Roux's line above it, trimmed; undefined at the region's start
    readonly occurrence: number; //Which of the region's lines with the anchor's text it follows, counted from 0
}

interface FoundRegion
{
    readonly name: string;
    readonly start: number;
    end: number;
    readonly kept: KeptBlock[];
}

const startExpression = /^\s*# >>> Roux: ([A-Za-z][A-Za-z0-9]*)(?:[.\s]|$)/;
const endExpression = /^\s*# <<< Roux\s*$/;
const markerExpression = /(?:>>>|<<<)\s*Roux/;
const keptStartExpression = /^\s*#<!--/;
const keptEndExpression = /^\s*#-->/;

export function startMarker(content: RegionContent): string
{
    return "# >>> Roux: " + content.name + ". " + content.description;
}

export const endMarker = "# <<< Roux";

//A CMakeLists.txt holding nothing but the regions, for a project that has none yet
export function newCMakeListsText(contents: readonly RegionContent[]): string
{
    //It names no marker, since a line looking like one is refused.
    const lines = ["# Roux rewrites its regions below on every Generate. The rest is the project's: add your own lines outside", "# the regions, or inside them in a kept block, which starts with a #<!-- line and ends with a #--> line.", ""];

    for (const content of contents)
        lines.push(startMarker(content), ...content.lines, endMarker, "");

    return lines.join("\n");
}

//Rewrites the regions of text with contents, in their order. A region the file is missing is added next to the ones
//around it; a file without any is refused, since Roux can't tell where its lines would belong
export function updateRegions(text: string, contents: readonly RegionContent[], fileName: string): RegionUpdate
{
    const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    const found = findRegions(lines);

    if (found.problems.some(problem => "error" === problem.severity))
        return { text: undefined, problems: found.problems };

    const problems = [...found.problems];
    const known = new Map(contents.map(content => [content.name, content]));
    const present = found.regions.filter(region => known.has(region.name));

    for (const region of found.regions.filter(region => !known.has(region.name)))
        problems.push({ line: region.start + 1, severity: "warning", message: "Roux writes no region named " + region.name + ", so it leaves it as it is." });

    if (0 === present.length)
    {
        const names = contents.map(content => content.name).join(", ");
        problems.push({ line: 1, severity: "error", message: fileName + " has none of Roux's regions (" + names + "). Mark where each belongs with \"# >>> Roux: <name>\" and \"# <<< Roux\" lines; Roux fills them on the next Generate." });
        return { text: undefined, problems: problems };
    }

    //A missing region goes after the nearest region before it in contents' order, else before the nearest one after it
    const presentNames = new Set(present.map(region => region.name));
    const insertedAfter = new Map<string, RegionContent[]>();
    const insertedBefore = new Map<string, RegionContent[]>();

    for (const [index, content] of contents.entries())
    {
        if (presentNames.has(content.name))
            continue;

        const previous = contents.slice(0, index).reverse().find(other => presentNames.has(other.name));
        const next = contents.slice(index + 1).find(other => presentNames.has(other.name));

        if (previous)
            insertedAfter.set(previous.name, [...insertedAfter.get(previous.name) ?? [], content]);
        else if (next)
            insertedBefore.set(next.name, [...insertedBefore.get(next.name) ?? [], content]);
    }

    const output: string[] = [];
    let index = 0;

    for (const region of present)
    {
        output.push(...lines.slice(index, region.start));

        for (const content of insertedBefore.get(region.name) ?? [])
            output.push(...regionLines(content, [], problems), "");

        output.push(...regionLines(known.get(region.name) as RegionContent, region.kept, problems));

        for (const content of insertedAfter.get(region.name) ?? [])
            output.push("", ...regionLines(content, [], problems));

        index = region.end + 1;
    }

    output.push(...lines.slice(index));
    return { text: output.join(lineEnding), problems: problems };
}

//The regions and their kept blocks, or the first marker that doesn't fit. Roux never guesses where something began or
//ended, so it stops there.
function findRegions(lines: readonly string[]): { regions: FoundRegion[]; problems: RegionProblem[] }
{
    const regions: FoundRegion[] = [];
    let region: FoundRegion | undefined;
    let kept: KeptBlock | undefined;
    //Roux's lines of the open region so far, trimmed, so a kept block can be tied to the one above it
    let rouxLines: string[] = [];

    const error = (index: number, message: string) => ({ regions: regions, problems: [{ line: index + 1, severity: "error" as const, message: message }] });

    for (const [index, line] of lines.entries())
    {
        const start = startExpression.exec(line);
        const isEnd = endExpression.test(line);

        if (kept)
        {
            if (keptEndExpression.test(line))
            {
                kept.lines.push(line);
                kept = undefined;
                continue;
            }

            if (keptStartExpression.test(line))
                return error(index, "A kept block starts inside the one of line " + (kept.line + 1) + ", which needs its #--> first.");

            if (start || isEnd)
                return error(index, "A region marker is inside the kept block of line " + (kept.line + 1) + ", which needs its #--> first.");

            kept.lines.push(line);
            continue;
        }

        if (start?.[1])
        {
            const name = start[1];
            const twice = regions.find(other => name === other.name);

            if (region)
                return error(index, "Region " + name + " starts inside region " + region.name + " of line " + (region.start + 1) + ", which needs its \"" + endMarker + "\" first.");

            if (twice)
                return error(index, "There's a region " + name + " already, at line " + (twice.start + 1) + ".");

            region = { name: name, start: index, end: -1, kept: [] };
            rouxLines = [];
            continue;
        }

        if (isEnd)
        {
            if (!region)
                return error(index, "\"" + endMarker + "\" ends a region that never started.");

            region.end = index;
            regions.push(region);
            region = undefined;
            continue;
        }

        if (markerExpression.test(line))
            return error(index, "This looks like a Roux marker but isn't one: a region starts with \"# >>> Roux: <name>\" and ends with \"" + endMarker + "\".");

        if (keptStartExpression.test(line))
        {
            if (!region)
                return error(index, "A kept block (#<!--) only belongs inside a Roux region; outside them every line is kept anyway.");

            const anchor = rouxLines.findLast(rouxLine => "" !== rouxLine);
            const occurrence = undefined === anchor ? 0 : rouxLines.filter(rouxLine => anchor === rouxLine).length - 1;
            kept = { lines: [line], line: index, anchor: anchor, occurrence: occurrence };
            region.kept.push(kept);
            continue;
        }

        if (keptEndExpression.test(line))
            return error(index, "#--> ends a kept block that never started.");

        if (region)
            rouxLines.push(line.trim());
    }

    if (kept)
        return error(kept.line, "The kept block has no #--> to end it.");

    if (region)
        return error(region.start, "Region " + region.name + " has no \"" + endMarker + "\" to end it.");

    return { regions: regions, problems: [] };
}

//The region as Roux writes it, each kept block back below the line it followed. A block whose line Roux no longer
//writes goes to the region's end, with a warning; it's never dropped.
function regionLines(content: RegionContent, kept: readonly KeptBlock[], problems: RegionProblem[]): string[]
{
    const placed = new Map<number, KeptBlock[]>();
    const moved: KeptBlock[] = [];

    for (const block of kept)
    {
        const at = undefined === block.anchor ? -1 : lineOf(content.lines, block.anchor, block.occurrence);

        if (undefined === at)
        {
            moved.push(block);
            problems.push({ line: block.line + 1, severity: "warning", message: "The kept block starting here followed \"" + block.anchor + "\", which Roux no longer writes, so it moved to the end of region " + content.name + "." });
            continue;
        }

        placed.set(at, [...placed.get(at) ?? [], block]);
    }

    const lines = [startMarker(content), ...(placed.get(-1) ?? []).flatMap(block => block.lines)];

    for (const [index, line] of content.lines.entries())
        lines.push(line, ...(placed.get(index) ?? []).flatMap(block => block.lines));

    lines.push(...moved.flatMap(block => block.lines), endMarker);
    return lines;
}

//The index of the occurrence-th line whose trimmed text is text.
function lineOf(lines: readonly string[], text: string, occurrence: number): number | undefined
{
    let seen = -1;

    for (const [index, line] of lines.entries())
    {
        if (text === line.trim() && occurrence === ++seen)
            return index;
    }

    return undefined;
}