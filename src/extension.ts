"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as autoproj from "./autoproj";
import * as commands from "./commands";
import * as context from "./context";
import * as tasks from "./tasks";
import * as watcher from "./watcher";
import * as wrappers from "./wrappers";

export class EventHandler {
    private wrapper: wrappers.VSCode;
    private watcher: watcher.FileWatcher;
    private workspaces: autoproj.Workspaces;

    constructor(wrapper: wrappers.VSCode, fileWatcher: watcher.FileWatcher,
                workspaces: autoproj.Workspaces) {
        this.wrapper = wrapper;
        this.watcher = fileWatcher;
        this.workspaces = workspaces;
    }

    public async onManifestChanged(ws: autoproj.Workspace): Promise<void> {
        try {
            await ws.reload();
        } catch (err) {
            this.wrapper.showErrorMessage(`Could not load installation manifest: ${err.message}`);
        }
    }

    public async onWorkspaceFolderAdded(folder: vscode.WorkspaceFolder): Promise<void> {
        const { added, workspace } = this.workspaces.addFolder(folder.uri.fsPath);
        if (added && workspace) {
            try {
                await workspace.info();
            } catch (err) {
                const errMsg = `Could not load installation manifest: ${err.message}`;
                this.wrapper.showErrorMessage(errMsg);
            }
            this.wrapper.executeCommand("workbench.action.tasks.runTask", `autoproj: ${workspace.name}: Watch`);
            this.watchManifest(workspace);
        }
    }

    public async onWorkspaceFolderRemoved(folder: vscode.WorkspaceFolder): Promise<void> {
        const deletedWs = this.workspaces.deleteFolder(folder.uri.fsPath);
        if (deletedWs) {
            this.unwatchManifest(deletedWs);
            try {
                const pid: number = await deletedWs.readWatchPID();
                this.wrapper.killProcess(pid, "SIGINT");
            } catch (err) {
                this.wrapper.showErrorMessage(`Could not stop autoproj watch process: ${err.message}`);
            }
        }
    }

    public watchManifest(ws: autoproj.Workspace): void {
        const manifestPath = autoproj.installationManifestPath(ws.root);
        try {
            this.watcher.startWatching(manifestPath, () => this.onManifestChanged(ws));
        } catch (err) {
            this.wrapper.showErrorMessage(err.message);
        }
    }

    public unwatchManifest(ws: autoproj.Workspace): void {
        try {
            this.watcher.stopWatching(autoproj.installationManifestPath(ws.root));
        } catch (err) {
            this.wrapper.showErrorMessage(err.message);
        }
    }
}

export function setupExtension(subscriptions: any[], vscodeWrapper: wrappers.VSCode) {
    const fileWatcher = new watcher.FileWatcher();
    const outputChannel = vscode.window.createOutputChannel("Autoproj");
    const workspaces = new autoproj.Workspaces(null, outputChannel);
    const autoprojTaskProvider = new tasks.AutoprojProvider(workspaces, vscodeWrapper);
    const autoprojContext = new context.Context(workspaces, outputChannel);
    const autoprojCommands = new commands.Commands(autoprojContext, vscodeWrapper);
    const eventHandler = new EventHandler(vscodeWrapper, fileWatcher, workspaces);

    subscriptions.push(vscode.workspace.registerTaskProvider("autoproj", autoprojTaskProvider));
    if (vscode.workspace.workspaceFolders) {
        vscode.workspace.workspaceFolders.forEach((folder) => eventHandler.onWorkspaceFolderAdded(folder));
    }

    autoprojTaskProvider.reloadTasks();
    autoprojCommands.register();

    subscriptions.push(workspaces);
    subscriptions.push(outputChannel);
    subscriptions.push(autoprojContext);
    subscriptions.push(fileWatcher);
    subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        event.added.forEach((folder) => eventHandler.onWorkspaceFolderAdded(folder));
        event.removed.forEach((folder) => eventHandler.onWorkspaceFolderRemoved(folder));
        autoprojTaskProvider.reloadTasks();
    }));
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(extensionContext: vscode.ExtensionContext) {
    const vscodeWrapper = new wrappers.VSCode(extensionContext);
    setupExtension(extensionContext.subscriptions, vscodeWrapper);
}

// this method is called when your extension is deactivated
export function deactivate() {
    // no-op
}
