import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Installation } from "@retrofuturagui/roux-protocol";
import { pathDirectories, type MachineEnvironment } from "./Environment.js";
import { compareVersions } from "./Version.js";

//A place where a tool may be, before it is run
export interface Candidate
{
    path: string;
    source: string;
}

export const pathSource = "PATH";

//The given places, then the PATH's folders for each executable name, keeping only files that exist
export function withPathCandidates(environment: MachineEnvironment, executables: readonly string[], candidates: Candidate[]): Candidate[]
{
    const all = [...candidates];

    for (const directory of pathDirectories(environment))
    {
        for (const executable of executables)
            all.push({ path: path.join(directory, executable), source: pathSource });
    }

    return all.filter(candidate => existsSync(candidate.path));
}

//Lists each file once, even when several candidates lead to it (a PATH folder that is also Program Files), and marks the
//ones on the PATH. Runs them all at once; one that answers with no version isn't listed. Newest first
export async function probeCandidates(candidates: Candidate[], readVersion: (file: string) => Promise<string>): Promise<Installation[]>
{
    const unique = new Map<string, Installation>();

    for (const candidate of candidates)
    {
        const key = fileKey(candidate.path);
        const isOnPath = pathSource === candidate.source;
        const known = unique.get(key);

        if (known)
        {
            known.isOnPath ||= isOnPath;
            continue;
        }

        unique.set(key, { version: "", path: candidate.path, source: candidate.source, isOnPath: isOnPath });
    }

    const installations = [...unique.values()];
    const versions = await Promise.all(installations.map(installation => readVersion(installation.path)));

    return installations
        .map((installation, index) => ({ ...installation, version: versions[index] ?? "" }))
        .filter(installation => "" !== installation.version)
        .sort((left, right) => compareVersions(right.version, left.version));
}

//Where the choice saved in Machine.bechaml is among the installations; -1 when nothing was saved or it's gone
export function chosenIndexOf(installations: readonly Installation[], chosenPath: string | undefined): number
{
    if (!chosenPath)
        return -1;

    const key = fileKey(chosenPath);
    return installations.findIndex(installation => key === fileKey(installation.path));
}

//The folders in root whose names start with prefix, ignoring case. Empty when root doesn't exist
export function subdirectories(root: string, prefix: string): string[]
{
    if (!root || !existsSync(root))
        return [];

    try
    {
        const lowerPrefix = prefix.toLowerCase();

        return readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.toLowerCase().startsWith(lowerPrefix))
            .map(entry => path.join(root, entry.name));
    }
    catch
    {
        return [];
    }
}

//What tells two paths to one file apart from two files. The resolved path, without case on Windows
export function fileKey(file: string): string
{
    let resolved = path.resolve(file);

    try
    {
        resolved = realpathSync.native(file);
    }
    catch
    {
        //A path that can't be resolved keeps its plain form
    }

    return "win32" === process.platform ? resolved.toLowerCase() : resolved;
}