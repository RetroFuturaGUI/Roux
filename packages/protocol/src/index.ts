//The messages between the UI and the core: JSON-RPC 2.0 requests from the UI, events (notifications) from the core.
//Every host carries the same messages, whatever its transport.

export type JsonRpcId = number | string;

export interface JsonRpcRequest
{
    jsonrpc: "2.0";
    id: JsonRpcId;
    method: string;
    params?: unknown;
}

export interface JsonRpcNotification
{
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
}

export interface JsonRpcError
{
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcSuccess
{
    jsonrpc: "2.0";
    id: JsonRpcId;
    result: unknown;
}

export interface JsonRpcFailure
{
    jsonrpc: "2.0";
    id: JsonRpcId | null;
    error: JsonRpcError;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

//The error codes JSON-RPC 2.0 reserves.
export const JsonRpcErrorCode =
{
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603
} as const;

export type CheckStatus = "ok" | "warning" | "error" | "skipped" | "checking";

//One installation of a component that Setup found.
export interface Installation
{
    version: string;
    path: string;
    source: string; //where it was found: "Program Files", "Visual Studio 2022 Community (bundled)", ...
    isOnPath: boolean;
}

//How a fix runs. terminal: in a terminal window of its own, where an elevation or password prompt can be answered; Setup
//checks again once the window is closed. capture: quietly, its output shown in the row (a dry run). environment: sets a
//user environment variable. link: a download page to open.
export type FixKind = "terminal" | "capture" | "environment" | "link";

//What Setup offers when a component is missing or wrong. Nothing runs without a click, and the command shows first. The
//UI names a fix by its id only: the core keeps what it runs.
export interface Fix
{
    id: string;
    label: string;
    command: string;
    kind: FixKind;
    after?: string; //the id of the fix that has to run first: Install after its dry run.
}

//The result of one Setup check, one row of the Setup tab.
export interface CheckResult
{
    component: string;
    status: CheckStatus;
    detail: string;
    installations: Installation[];
    chosenIndex: number; //-1 when nothing was found.
    fixes: Fix[];
}

//A problem in a .bechaml file, where it is in the file.
export interface FileProblem
{
    line: number;
    column: number;
    message: string;
}

//What one platform's block (<Windows>) in Project.bechaml says.
export interface PlatformSettings
{
    language: string;
    standard: string;
    compiler: string;
    compilerFlags: string[]; //Names out of the core's compilerFlags, such as "Wall"; only C and C++ use them.
}

export type RemovedSlots = "Delete" | "CommentOut";

//Project.bechaml as the Project tab shows it. A missing element reads as empty.
export interface ProjectValues
{
    name: string;
    identifier: string;
    version: string;
    cmakeVersion: string;
    platforms: string[];
    platformSettings: Record<string, PlatformSettings>;
    allowNonRoyaltyFreeCodecs: boolean;
    features: string[];
    appSettings: string;
    startWindow: string;
    assets: string[];
    authors: string[];
    license: string;
    removedSlots: RemovedSlots;
}

export type AppSettingValue = string | string[];

export interface Charset
{
    name: string;
    blocks: string[];
}

//The App Settings file as the App tab shows it. "All" is the file's top level, every other scope a platform's or group's block (<Windows>, <Desktop>).
//Keys: appName, fontFamily, fontSize, fontUnit, transitions, layoutFile, renderers, requires and "font:<charset>".
//A key is there only when the scope sets it.
export interface AppValues
{
    scopes: Record<string, Record<string, AppSettingValue>>;
    charsets: Charset[];
}

//One file the tabs edit. values is undefined while the file is missing or has problems: the tab is then read-only.
export interface SettingsFile<V>
{
    path: string;
    relativePath: string; //from the project folder, with /.
    exists: boolean;
    problems: FileProblem[];
    values?: V;
}

export interface ProjectSnapshot
{
    folder: string;
    project: SettingsFile<ProjectValues>;
    app?: SettingsFile<AppValues>; //missing while Project.bechaml can't be read, since it names the file.
}

export type ProjectEdit =
    | { key: "name" | "identifier" | "version" | "cmakeVersion" | "appSettings" | "startWindow" | "license"; value: string }
    | { key: "removedSlots"; value: RemovedSlots }
    | { key: "platforms" | "features" | "assets" | "authors"; value: string[] }
    | { key: "allowNonRoyaltyFreeCodecs"; value: boolean }
    | { key: "platform"; platform: string; value: PlatformSettings };

export type AppEdit =
    | { kind: "set"; scope: string; key: string; value: AppSettingValue }
    | { kind: "reset"; scope: string; keys: string[] }
    | { kind: "charset"; index: number; charset: Charset } //index past the last one adds a set.
    | { kind: "removeCharset"; index: number };

//An edit that wasn't valid isn't written; message says why.
export interface EditAnswer
{
    isWritten: boolean;
    message: string;
    snapshot: ProjectSnapshot;
}

export type BuildStep = "generate" | "configure" | "build" | "run";
export type StepState = "idle" | "waiting" | "running" | "ok" | "failed" | "stopped" | "skipped";

export interface StepStatus
{
    step: BuildStep;
    state: StepState;
    summary: string;  //"1 error, 2 warnings", "Exited with code 0".
    startedAt: number; //Date.now() when it started, 0 when it hasn't.
    endedAt: number;
}

export type LogSeverity = "error" | "warning" | "command" | "note" | "";

//One line of a step's output. location is set when the line names a file: an error, a warning, a CMake message.
export interface LogLine
{
    text: string;
    severity: LogSeverity;
    location?: { file: string; line: number; column: number };
}

//What the Build tab builds: the platform and build type, saved in Project.user.bechaml.
export interface BuildTarget
{
    platforms: string[];
    buildTypes: string[];
    platform: string;
    buildType: string;
    buildFolder: string; //relative to the project, with /.
    summary: string;     //"C++ 23 · MSVC · Visual Studio Community 2022".
    unavailable: string; //why this computer can't build the target; empty when it can.
}

export interface BuildState
{
    target: BuildTarget;
    steps: StepStatus[];
    isRunning: boolean;
}

//A picture in an asset folder, as the Assets tab shows it
export interface AssetFile
{
    path: string;      //inside its folder, with /: "Images/Logo.png"
    size: number;      //in bytes
    modified: number;  //when it was last written, in milliseconds since 1970, so a page knows when its preview is stale
    reference: string; //how markup names it: Assets.Images.Logo.png, or "Images/My Logo.png" for a name a reference can't hold
}

//One asset folder: one of the project's, or RetroFuturaGUI's premade Resources.
export interface AssetSection
{
    folder: string;      //relative to the project, with /: "Resources", "RetroFuturaGUI/Resources"
    isReadOnly: boolean; //RetroFuturaGUI's, which the tab only shows.
    files: AssetFile[];
}

export interface AssetList
{
    sections: AssetSection[];
    destination: string;  //where added files go, relative to the project: "Resources/Images". Empty while the project names no asset folder
    extensions: string[]; //the kinds of file the tab shows and takes: ".png", ".svg"
}

//What happens to an added file whose name is taken: it replaces the one there, or is saved under a free name ("Logo 2.png")
export type AssetClash = "replace" | "keepBoth";

//Requests from the UI: method name, its parameters and its result.
export interface Methods
{
    "setup.runChecks": { params: Record<string, never>; result: { checks: CheckResult[] } };
    "setup.choose": { params: { component: string; path: string }; result: CheckResult }; //saved in Machine.bechaml.
    "setup.runFix": { params: { component: string; fixId: string }; result: { isDone: boolean; output: string } };
    "project.load": { params: Record<string, never>; result: ProjectSnapshot };
    "project.create": { params: Record<string, never>; result: ProjectSnapshot };
    "project.edit": { params: { edit: ProjectEdit }; result: EditAnswer };
    "app.create": { params: Record<string, never>; result: ProjectSnapshot };
    "app.edit": { params: { edit: AppEdit }; result: EditAnswer };
    "build.load": { params: Record<string, never>; result: { state: BuildState; logs: Partial<Record<BuildStep, LogLine[]>> } };
    "build.setTarget": { params: { platform: string; buildType: string }; result: BuildState };
    "build.start": { params: { steps: BuildStep[] }; result: { isStarted: boolean; message: string } }; //runs on; events report it.
    "build.stop": { params: Record<string, never>; result: BuildState };
    "build.clean": { params: Record<string, never>; result: { state: BuildState; message: string } };
    "assets.list": { params: Record<string, never>; result: AssetList };
    "assets.preview": { params: { folder: string; path: string }; result: { dataUrl: string } }; //"" for a file a page can't show
    "assets.clashes": { params: { names: string[] }; result: { clashes: string[] } }; //the names taken in the destination
    "assets.uploadStart": { params: { name: string; onClash: AssetClash }; result: { uploadId: string; savedAs: string } };
    "assets.uploadChunk": { params: { uploadId: string; data: string }; result: { received: number } }; //data in base64
    "assets.uploadEnd": { params: { uploadId: string }; result: { savedAs: string } }; //savedAs relative to the project
}

//Events from the core: name and parameters.
export interface Events
{
    "setup.checkStarted": { component: string };
    "setup.checkFinished": CheckResult;
    "project.changed": ProjectSnapshot; //Project.bechaml or the App Settings file changed on disk, not through the tabs.
    "build.changed": BuildState; //a step started, ended or changed its summary.
    "build.log": { step: BuildStep; lines: LogLine[] }; //new output, a few times a second at most.
}

export type MethodName = keyof Methods;
export type EventName = keyof Events;
