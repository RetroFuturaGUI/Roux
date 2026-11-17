//The VS Code shell. Shows Roux's panel in a webview and carries its JSON-RPC messages to the core and back. The core runs in
//this extension's own process for now. Builds and the app run as processes of their own, so VS Code stays responsive
import { readFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import type { Core } from "@retrofuturagui/roux-core" with { "resolution-mode": "import" };

class RouxHost
{
    private _core: Core | undefined;
    private _coreFolder: string | undefined; //the workspace folder the core was started for
    private _chosenFolder: string | undefined; //picked in a dialog while no folder is open
    private _panel: vscode.WebviewPanel | undefined;
    private readonly _output = vscode.window.createOutputChannel("Roux");
    private readonly _uiFolder = path.join(path.dirname(require.resolve("@retrofuturagui/roux-ui/package.json")), "src");

    //One panel. Opening it again brings the open one to the front.
    async openPanel(): Promise<void>
    {
        //VS Code opens a folder in one window only, so a development window started beside the project's own one has none
        if (!RouxHost.currentFolder() && !this._chosenFolder)
        {
            const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Use as Roux's project" });
            this._chosenFolder = chosen?.[0]?.fsPath;
        }

        if (this._panel && this.projectStart() === this._coreFolder)
        {
            this._panel.reveal();
            return;
        }

        this._panel?.dispose(); //it shows another folder's core

        const core = await this.startCore();
        const panel = vscode.window.createWebviewPanel("roux", "Roux", vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true, //the build log and the forms keep their state while another tab is shown
            localResourceRoots: [vscode.Uri.file(this._uiFolder)]
        });

        //Events first, so none of the page's first requests' events is missed.
        const removeSink = core.server.addEventSink(notification => void panel.webview.postMessage(notification));
        panel.webview.onDidReceiveMessage(async message =>
        {
            const response = await core.server.handle(message);

            if (response)
                void panel.webview.postMessage(response);
        });
        panel.onDidDispose(() =>
        {
            removeSink();
            this._panel = undefined;
        });

        panel.webview.html = RouxHost.pageHtml(panel.webview, this._uiFolder);
        this._panel = panel;
    }

    //Kept while VS Code runs, so a build started from the panel goes on when the panel is closed
    close(): void
    {
        this._panel?.dispose();
        this._core?.close();
        this._core = undefined;
    }

    //A core started before a folder was opened, or for another one, gives way to one for the folder open now
    private async startCore(): Promise<Core>
    {
        const workspaceFolder = this.projectStart();
        this._output.appendLine("Workspace folders: " + (vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath).join(", ") || "none")
            + "; the active file: " + (vscode.window.activeTextEditor?.document.uri.fsPath ?? "none"));

        if (this._core && workspaceFolder === this._coreFolder)
            return this._core;

        this._core?.close();

        //The core is an ES module, which this CommonJS extension loads through import()
        const roux = await import("@retrofuturagui/roux-core");
        const projectFolder = workspaceFolder ? await roux.findProjectFolder(workspaceFolder) : undefined;
        this._core = new roux.Core(undefined, { projectFolder: projectFolder });
        this._coreFolder = workspaceFolder;
        this._output.appendLine("Project folder: " + (projectFolder ?? "none, since no folder is open"));

        if (!projectFolder)
            void vscode.window.showWarningMessage("Roux: open the project's folder (the one with Project.bechaml), then open the panel again. Until then only Setup works.");

        return this._core;
    }

    //Where the search for Project.bechaml starts. The open folder, else the one picked in the dialog
    private projectStart(): string | undefined
    {
        return RouxHost.currentFolder() ?? this._chosenFolder;
    }

    //Where to look for the project. The first workspace folder, else the folder of the file open in the editor
    private static currentFolder(): string | undefined
    {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (workspaceFolder)
            return workspaceFolder;

        const document = vscode.window.activeTextEditor?.document;
        return document && "file" === document.uri.scheme ? path.dirname(document.uri.fsPath) : undefined;
    }

    //The UI's own index.html, its files reached through webview URIs and only they allowed to run
    private static pageHtml(webview: vscode.Webview, uiFolder: string): string
    {
        const source = webview.cspSource;
        const policy = "default-src 'none'; script-src " + source + "; style-src " + source + " 'unsafe-inline'; img-src " + source + " data:; font-src " + source;

        return readFileSync(path.join(uiFolder, "index.html"), "utf8")
            .replace(/(href|src)="(?![a-z-]+:|#)([^"]+)"/g, (_match, attribute: string, file: string) =>
                attribute + "=\"" + webview.asWebviewUri(vscode.Uri.file(path.join(uiFolder, file))).toString() + "\"")
            .replace("<head>", "<head>\n        <meta http-equiv=\"Content-Security-Policy\" content=\"" + policy + "\"/>");
    }
}

const host = new RouxHost();

export function activate(context: vscode.ExtensionContext): void
{
    context.subscriptions.push(vscode.commands.registerCommand("roux.openPanel", () => host.openPanel()));

    //A button at the end of the editor tabs (shown once the extension runs), and one in the status bar for when no editor is open
    void vscode.commands.executeCommand("setContext", "roux.isActive", true);
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    statusItem.text = "$(flame) Roux";
    statusItem.tooltip = "Open Roux's panel";
    statusItem.command = "roux.openPanel";
    statusItem.show();
    context.subscriptions.push(statusItem);
}

export function deactivate(): void
{
    host.close();
}