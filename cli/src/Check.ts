import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { LineMap, parseBechaml } from "@retrofuturagui/roux-core";

export interface CheckReport
{
    //"file:line:column: error: message"
    readonly lines: readonly string[];
    readonly fileCount: number;
    readonly errorCount: number;
}

const skippedFolders = new Set(["node_modules", "out", "build"]);

//Reads every .bechaml file in the given files and folders. Folders are searched with their subfolders, except hidden ones
//and the skipped ones above. A file named on its own is read whatever its extension
export async function checkPaths(paths: readonly string[], workingDirectory: string): Promise<CheckReport>
{
    const lines: string[] = [];
    const files: string[] = [];
    let errorCount = 0;

    for (const given of paths)
    {
        const full = path.resolve(workingDirectory, given);
        const info = await stat(full).catch(() => undefined);

        if (!info)
        {
            lines.push(given + ": error: There is no such file or folder.");
            ++errorCount;
            continue;
        }

        if (info.isDirectory())
            files.push(...await findBechamlFiles(full));
        else
            files.push(full);
    }

    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

    const uniqueFiles = [...new Set(files)].sort();

    for (const file of uniqueFiles)
    {
        const shown = shownPath(file, workingDirectory);
        let source: string;

        try
        {
            source = decoder.decode(await readFile(file));
        }
        catch (error)
        {
            lines.push(shown + ": error: " + (error instanceof TypeError ? "The file isn't UTF-8." : "The file can't be read."));
            ++errorCount;
            continue;
        }

        const document = parseBechaml(source);
        const lineMap = new LineMap(source);

        for (const diagnostic of document.diagnostics)
        {
            const position = lineMap.position(diagnostic.start);
            lines.push(shown + ":" + position.line + ":" + position.column + ": error: " + diagnostic.message);
        }

        errorCount += document.diagnostics.length;
    }

    return { lines: lines, fileCount: uniqueFiles.length, errorCount: errorCount };
}

async function findBechamlFiles(folder: string): Promise<string[]>
{
    const found: string[] = [];

    for (const entry of await readdir(folder, { withFileTypes: true }))
    {
        const full = path.join(folder, entry.name);

        if (entry.isDirectory())
        {
            if (!entry.name.startsWith(".") && !skippedFolders.has(entry.name))
                found.push(...await findBechamlFiles(full));
        }
        else if (entry.isFile() && entry.name.endsWith(".bechaml"))
        {
            found.push(full);
        }
    }

    return found;
}

//Relative to the working folder when the file is inside it, so the line stays short and still opens on a click
function shownPath(file: string, workingDirectory: string): string
{
    const relative = path.relative(workingDirectory, file);
    return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}