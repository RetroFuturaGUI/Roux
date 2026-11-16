import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Installation } from "@retrofuturagui/roux-protocol";
import { variable, type MachineEnvironment } from "./Environment.js";
import { commandLine, FixList, type Check } from "./Fixes.js";
import { runProcess } from "./Process.js";
import { chosenIndexOf, fileKey } from "./Tool.js";

//The ports RetroFuturaGUI's CMakeLists.txt finds, plus libopenmpt for the TrackerModules feature
const basePorts = ["glfw3", "glm", "glew", "glad", "freetype", "harfbuzz", "sheenbidi", "stb", "assimp", "lunasvg", "ffmpeg", "miniaudio"];

//ffmpeg features that make a build GPL or not redistributable at all, which a commercial build can't ship
const forbiddenFfmpegFeatures = ["gpl", "nonfree", "x264", "x265", "postproc", "fdk-aac", "avisynthplus"];

export function requiredPorts(hasTrackerModules: boolean): string[]
{
    return hasTrackerModules ? [...basePorts, "libopenmpt"] : basePorts;
}

//vcpkg's triplet for this computer: x64-windows, arm64-linux and so on
export function hostTriplet(environment: MachineEnvironment, architecture: string = process.arch): string
{
    const system = "win32" === environment.platform ? "windows" : "darwin" === environment.platform ? "osx" : "linux";
    return ("arm64" === architecture ? "arm64" : "x64") + "-" + system;
}

function vcpkgExecutable(environment: MachineEnvironment, root: string): string
{
    return path.join(root, "win32" === environment.platform ? "vcpkg.exe" : "vcpkg");
}

function isVcpkgRoot(environment: MachineEnvironment, root: string): boolean
{
    return existsSync(vcpkgExecutable(environment, root)) && existsSync(path.join(root, "scripts", "buildsystems", "vcpkg.cmake"));
}

//"vcpkg package management program version 2026-10-29-139f2e5..." is 2026-10-29
export function parseVcpkgVersion(output: string): string
{
    return /version (\d{4}-\d{2}-\d{2})/.exec(output)?.[1] ?? "";
}

//The vcpkgs on this computer: the one VCPKG_ROOT names, and the usual places. Which one builds is chosen like any
//installation; RetroFuturaGUI's CMakeLists.txt reads VCPKG_ROOT, so a choice that isn't VCPKG_ROOT offers to set it
export async function findVcpkg(environment: MachineEnvironment, chosenPath?: string): Promise<Check>
{
    const fixes = new FixList();
    const component = "VCPKG_ROOT";
    const set = variable(environment, "VCPKG_ROOT");
    const places: Installation[] = [];
    const add = (root: string, source: string) =>
    {
        if (root && isVcpkgRoot(environment, root) && !places.some(place => fileKey(place.path) === fileKey(root)))
            places.push({ version: "", path: root, source: source, isOnPath: false });
    };

    add(set, "VCPKG_ROOT");
    add("win32" === environment.platform ? "C:\\vcpkg" : "/opt/vcpkg", "win32" === environment.platform ? "C:\\vcpkg" : "/opt/vcpkg");
    add(path.join(environment.homeDirectory, "vcpkg"), "in your home folder");

    const versions = await Promise.all(places.map(async place => parseVcpkgVersion(await runProcess(vcpkgExecutable(environment, place.path), ["version"]) ?? "")));
    const installations = places.map((place, index) => ({ ...place, version: versions[index] || "unknown version" }));

    if (0 === installations.length)
    {
        const root = "win32" === environment.platform ? "C:\\vcpkg" : path.join(environment.homeDirectory, "vcpkg");
        const bootstrap = path.join(root, "win32" === environment.platform ? "bootstrap-vcpkg.bat" : "bootstrap-vcpkg.sh");
        const clone = fixes.terminal("Install", "git clone https://github.com/microsoft/vcpkg " + commandLine(root, []) + " && " + commandLine(bootstrap, ["-disableMetrics"]));
        addSetFix(fixes, environment, root, clone);
        const detail = set ? "VCPKG_ROOT is " + set + ", which holds no vcpkg; none found elsewhere" : "not found";
        return fixes.check({ component: component, status: "error", detail: detail, installations: [], chosenIndex: -1 });
    }

    const chosen = chosenIndexOf(installations, chosenPath);
    const fromVariable = installations.findIndex(installation => "VCPKG_ROOT" === installation.source);
    const index = 0 <= chosen ? chosen : Math.max(0, fromVariable);
    const root = installations[index]?.path ?? "";

    if (0 <= fromVariable && fromVariable === index)
        return fixes.check({ component: component, status: "ok", detail: 0 <= chosen ? "chosen for this computer" : "", installations: installations, chosenIndex: index });

    addSetFix(fixes, environment, root);
    const why = !set ? "VCPKG_ROOT isn't set, and RetroFuturaGUI's CMakeLists.txt needs it" : "VCPKG_ROOT is " + set + (0 > fromVariable ? ", which holds no vcpkg" : ", not the chosen one");
    return fixes.check({ component: component, status: "warning", detail: why, installations: installations, chosenIndex: index });
}

//Sets VCPKG_ROOT for the user: setx on Windows, ~/.profile elsewhere.
function addSetFix(fixes: FixList, environment: MachineEnvironment, root: string, after?: string): void
{
    const shown = "win32" === environment.platform ? commandLine("setx", ["VCPKG_ROOT", root]) : "echo 'export VCPKG_ROOT=\"" + root + "\"' >> ~/.profile";
    fixes.environment("Set VCPKG_ROOT", "VCPKG_ROOT", root, shown, after);
}

//The executable must be at least as new as the ports tree it was cloned with, or reading the ports fails ("schema
//version 2 is not supported"). The tree names its executable's release in scripts/vcpkg-tool-metadata.txt
export async function checkVcpkgTool(environment: MachineEnvironment, root: string | undefined): Promise<Check>
{
    const fixes = new FixList();
    const component = "vcpkg tool";

    if (!root)
        return fixes.check({ component: component, status: "skipped", detail: "needs vcpkg", installations: [], chosenIndex: -1 });

    const tool = parseVcpkgVersion(await runProcess(vcpkgExecutable(environment, root), ["version"]) ?? "");
    const metadata = await readFile(path.join(root, "scripts", "vcpkg-tool-metadata.txt"), "utf8").catch(() => "");
    const expected = /VCPKG_TOOL_RELEASE_TAG=(\d{4}-\d{2}-\d{2})/.exec(metadata)?.[1] ?? "";
    return vcpkgToolCheck(environment, root, tool, expected, fixes);
}

export function vcpkgToolCheck(environment: MachineEnvironment, root: string, tool: string, expected: string, fixes: FixList): Check
{
    const component = "vcpkg tool";
    const bootstrap = path.join(root, "win32" === environment.platform ? "bootstrap-vcpkg.bat" : "bootstrap-vcpkg.sh");

    if (!tool)
    {
        fixes.terminal("Bootstrap", commandLine(bootstrap, ["-disableMetrics"]), root);
        return fixes.check({ component: component, status: "error", detail: "the vcpkg executable doesn't run", installations: [], chosenIndex: -1 });
    }

    if (expected && tool < expected)
    {
        fixes.terminal("Bootstrap", commandLine(bootstrap, ["-disableMetrics"]), root);
        return fixes.check({ component: component, status: "error", detail: "the executable (" + tool + ") is older than its ports tree (" + expected + ")", installations: [], chosenIndex: -1 });
    }

    return fixes.check({ component: component, status: "ok", detail: tool + (expected ? ", as new as its ports tree" : ""), installations: [], chosenIndex: -1 });
}

//What vcpkg has installed, from its own database: installed/vcpkg/status, then the updates written since, in order. A
//later paragraph about the same package, feature and triplet wins. Keys are "port:feature:triplet", feature empty for
//the port itself
export async function readVcpkgStatus(root: string): Promise<Map<string, boolean>>
{
    const database = path.join(root, "installed", "vcpkg");
    const updates = (await readdir(path.join(database, "updates")).catch(() => [])).sort();
    const texts = await Promise.all([path.join(database, "status"), ...updates.map(name => path.join(database, "updates", name))].map(file => readFile(file, "utf8").catch(() => "")));
    return parseVcpkgStatus(texts);
}

export function parseVcpkgStatus(texts: readonly string[]): Map<string, boolean>
{
    const installed = new Map<string, boolean>();

    for (const text of texts)
    {
        for (const paragraph of text.split(/\r?\n\s*\r?\n/))
        {
            const fields = new Map<string, string>();

            for (const line of paragraph.split(/\r?\n/))
            {
                const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);

                if (match?.[1])
                    fields.set(match[1], match[2] ?? "");
            }

            const port = fields.get("Package");
            const triplet = fields.get("Architecture");

            if (port && triplet)
                installed.set(port + ":" + (fields.get("Feature") ?? "") + ":" + triplet, /install ok installed/.test(fields.get("Status") ?? ""));
        }
    }

    return installed;
}

export function checkPorts(environment: MachineEnvironment, root: string | undefined, status: Map<string, boolean> | undefined, triplet: string, required: readonly string[]): Check
{
    const fixes = new FixList();
    const component = "Ports";

    if (!root || !status)
        return fixes.check({ component: component, status: "skipped", detail: "needs vcpkg", installations: [], chosenIndex: -1 });

    const missing = required.filter(port => !status.get(port + "::" + triplet));

    if (0 === missing.length)
        return fixes.check({ component: component, status: "ok", detail: required.length + " ports for " + triplet + ": " + required.join(", "), installations: [], chosenIndex: -1 });

    //Classic mode, run in the vcpkg folder so no project's vcpkg.json is taken for a manifest.
    const executable = vcpkgExecutable(environment, root);
    const args = ["install", ...missing, "--triplet", triplet];
    const dryRun = fixes.capture("Dry run", executable, [...args, "--dry-run"], root);
    fixes.terminal("Install", commandLine(executable, args), root, dryRun);
    return fixes.check({ component: component, status: "error", detail: missing.join(", ") + " missing for " + triplet + ". The dry run lists what else would be built or rebuilt, which a shared vcpkg can drag along", installations: [], chosenIndex: -1 });
}

export function checkFfmpegLicensing(status: Map<string, boolean> | undefined, triplet: string): Check
{
    const fixes = new FixList();
    const component = "FFmpeg licensing";

    if (!status)
        return fixes.check({ component: component, status: "skipped", detail: "needs vcpkg", installations: [], chosenIndex: -1 });

    if (!status.get("ffmpeg::" + triplet))
        return fixes.check({ component: component, status: "skipped", detail: "ffmpeg isn't installed for " + triplet + " yet", installations: [], chosenIndex: -1 });

    const forbidden = forbiddenFfmpegFeatures.filter(feature => status.get("ffmpeg:" + feature + ":" + triplet));

    if (0 < forbidden.length)
    {
        return fixes.check({
            component: component,
            status: "error",
            detail: "ffmpeg is built with " + forbidden.join(", ") + ", which a commercial build can't ship. Remove it (vcpkg remove ffmpeg:" + triplet + " --recurse) and install it without them",
            installations: [],
            chosenIndex: -1
        });
    }

    return fixes.check({ component: component, status: "ok", detail: "no gpl, no nonfree", installations: [], chosenIndex: -1 });
}