'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as tasks from './tasks';
import * as wrappers from './wrappers';
import * as context from './context';
import * as autoproj from './autoproj';
import * as commands from './commands';
import * as watcher from './watcher';

export class EventHandler {
    private _wrapper: wrappers.VSCode;
    private _watcher: watcher.FileWatcher;
    private _workspaces: autoproj.Workspaces;

    constructor(wrapper: wrappers.VSCode, fileWatcher: watcher.FileWatcher,
                workspaces: autoproj.Workspaces) {
        this._wrapper = wrapper;
        this._watcher = fileWatcher;
        this._workspaces = workspaces;
    }

    async onManifestChanged(ws: autoproj.Workspace): Promise<void> {
        try {
            await ws.reload();
        } catch (err) {
            this._wrapper.showErrorMessage(`Could not load installation manifest: ${err.message}`);
        }
    }

    async onWorkspaceFolderAdded(folder: vscode.WorkspaceFolder): Promise<void> {
        const { added, workspace } = this._workspaces.addFolder(folder.uri.fsPath);
        if (added && workspace) {
            try {
                await workspace.info();
            } catch(err) {
                let errMsg = `Could not load installation manifest: ${err.message}`
                this._wrapper.showErrorMessage(errMsg);
            }
            this._wrapper.executeCommand('workbench.action.tasks.runTask', `autoproj: ${workspace.name}: Watch`)
            this.watchManifest(workspace);
        }
    }

    async onWorkspaceFolderRemoved(folder: vscode.WorkspaceFolder): Promise<void> {
        const deletedWs = this._workspaces.deleteFolder(folder.uri.fsPath);
        if (deletedWs) {
            this.unwatchManifest(deletedWs);
            try {
                let pid: number = await deletedWs.readWatchPID();
                this._wrapper.killProcess(pid, 'SIGINT');
            } catch(err) {
                this._wrapper.showErrorMessage(`Could not stop autoproj watch process: ${err.message}`);
            }
        }
    }

    watchManifest(ws: autoproj.Workspace): void {
        let manifestPath = autoproj.installationManifestPath(ws.root);
        try {
            this._watcher.startWatching(manifestPath, () => this.onManifestChanged(ws));
        } catch (err) {
            this._wrapper.showErrorMessage(err.message);
        }
    }

    unwatchManifest(ws: autoproj.Workspace): void {
        try {
            this._watcher.stopWatching(autoproj.installationManifestPath(ws.root));
        }
        catch (err) {
            this._wrapper.showErrorMessage(err.message);
        }
    }
}

export function setupExtension(subscriptions: any[], vscodeWrapper: wrappers.VSCode) {
    let fileWatcher = new watcher.FileWatcher();
    let outputChannel = vscode.window.createOutputChannel('Autoproj');
    let workspaces = new autoproj.Workspaces(null, outputChannel);
    let autoprojTaskProvider = new tasks.AutoprojProvider(workspaces);
    let autoprojContext = new context.Context(vscodeWrapper, workspaces, outputChannel);
    let autoprojCommands = new commands.Commands(autoprojContext, vscodeWrapper);
    let eventHandler = new EventHandler(vscodeWrapper, fileWatcher, workspaces);

    subscriptions.push(vscode.workspace.registerTaskProvider('autoproj', autoprojTaskProvider));
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
    let vscodeWrapper = new wrappers.VSCode(extensionContext);
    setupExtension(extensionContext.subscriptions, vscodeWrapper);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
