"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path";
import * as vscode from "vscode";
import * as autoproj from "./autoproj";
import * as commands from "./commands";
import * as tasks from "./tasks";
import * as watcher from "./fileWatcher";
import * as wrappers from "./wrappers";
import * as cpptools from "./cpptools";
import { ShimsWriter } from "./shimsWriter";
import { WatchManager } from "./workspaceWatcher";

export class EventHandler implements vscode.Disposable {
    private _wrapper: wrappers.VSCode;
    private _fileWatcher: watcher.FileWatcher;
    private _workspaces: autoproj.Workspaces;
    private _cppConfigurationProvider: cpptools.CppConfigurationProvider;
    private _shimsWriter: ShimsWriter;
    private _watchManager: WatchManager;

    constructor(wrapper: wrappers.VSCode, workspaces: autoproj.Workspaces,
                cppConfigurationProvider: cpptools.CppConfigurationProvider, watchManager: WatchManager) {
        this._wrapper = wrapper;
        this._fileWatcher = new watcher.FileWatcher();
        this._workspaces = workspaces;
        this._cppConfigurationProvider = cppConfigurationProvider;
        this._shimsWriter = new ShimsWriter();
        this._watchManager = watchManager;
    }

    public dispose() {
        this._fileWatcher.dispose();
    }

    public onDidOpenTextDocument(event: vscode.TextDocument) {
        const docName = path.basename(event.uri.fsPath);
        const docDir = path.dirname(event.uri.fsPath);

        for (const [, ws] of this._workspaces.workspaces) {
            if ((docDir === path.join(ws.root, "autoproj")) && (docName.startsWith("manifest."))) {
                this._wrapper.setTextDocumentLanguage(event, "yaml");
                break;
            }
        }
    }

    public async onManifestChanged(ws: autoproj.Workspace): Promise<void> {
        try {
            await ws.reload();
        } catch (err) {
            this._wrapper.showErrorMessage(`Could not load installation manifest: ${err.message}`);
        }
        this._watchManager.start(ws);
        this._cppConfigurationProvider.notifyChanges();
    }

    public async writeShims(workspace: autoproj.Workspace) {
        try {
            await this._shimsWriter.writeOpts(workspace);
            await this._shimsWriter.writePython(workspace);
            await this._shimsWriter.writeGdb(workspace);
            await this._shimsWriter.writeRuby(workspace);
        } catch (err) {
            await this._wrapper.showErrorMessage(`Could create file: ${err.message}`);
        }
    }

    public async onWorkspaceFolderAdded(folder: vscode.WorkspaceFolder): Promise<void> {
        const { added, workspace } = this._workspaces.addFolder(folder.uri.fsPath);
        if (added && workspace) {
            try {
                await workspace.info();
            } catch (err) {
                this._wrapper.showErrorMessage(`Could not load installation manifest: ${err.message}`);
            }
            this._cppConfigurationProvider.notifyChanges();
            this.watchManifest(workspace);
            await this.writeShims(workspace);
            this._watchManager.start(workspace);
        }
    }

    public async onWorkspaceFolderRemoved(folder: vscode.WorkspaceFolder): Promise<void> {
        this._cppConfigurationProvider.notifyChanges();
        const deletedWs = this._workspaces.deleteFolder(folder.uri.fsPath);
        if (deletedWs) {
            this.unwatchManifest(deletedWs);
            await this._watchManager.stop(deletedWs);
        }
    }

    public watchManifest(ws: autoproj.Workspace): void {
        const manifestPath = autoproj.installationManifestPath(ws.root);
        try {
            this._fileWatcher.startWatching(manifestPath, () => this.onManifestChanged(ws));
        } catch (err) {
            this._wrapper.showErrorMessage(err.message);
        }
    }

    public unwatchManifest(ws: autoproj.Workspace): void {
        try {
            this._fileWatcher.stopWatching(autoproj.installationManifestPath(ws.root));
        } catch (err) {
            this._wrapper.showErrorMessage(err.message);
        }
    }
}

export async function setupExtension(subscriptions: vscode.Disposable[], vscodeWrapper: wrappers.VSCode) {
    const workspaces = new autoproj.Workspaces(null);
    const autoprojTaskProvider = new tasks.AutoprojProvider(workspaces, vscodeWrapper);
    const autoprojPackageTaskProvider = new tasks.AutoprojPackageTaskProvider(autoprojTaskProvider);
    const autoprojWorkspaceTaskProvider = new tasks.AutoprojWorkspaceTaskProvider(autoprojTaskProvider);
    const autoprojCommands = new commands.Commands(workspaces, vscodeWrapper);
    const cppConfigurationProvider = new cpptools.CppConfigurationProvider(workspaces);
    const outputChannel = vscode.window.createOutputChannel("Autoproj", { log: true });
    const watchManager = new WatchManager(outputChannel, vscodeWrapper);
    const tasksHandler = new tasks.Handler(vscodeWrapper, workspaces);
    const eventHandler = new EventHandler(vscodeWrapper, workspaces, cppConfigurationProvider, watchManager);

    subscriptions.push(vscode.tasks.registerTaskProvider("autoproj-workspace", autoprojWorkspaceTaskProvider));
    subscriptions.push(vscode.tasks.registerTaskProvider("autoproj-package", autoprojPackageTaskProvider));

    if (vscode.workspace.workspaceFolders) {
        vscode.workspace.workspaceFolders.forEach((folder) => eventHandler.onWorkspaceFolderAdded(folder));
    }

    autoprojTaskProvider.reloadTasks();
    autoprojCommands.register();
    cppConfigurationProvider.register();

    subscriptions.push(eventHandler);
    subscriptions.push(workspaces);
    subscriptions.push(tasksHandler);
    subscriptions.push(cppConfigurationProvider);
    subscriptions.push(outputChannel);
    subscriptions.push(watchManager);
    subscriptions.push(vscode.tasks.onDidStartTaskProcess((event) => { tasksHandler.onDidStartTaskProcess(event); }));
    subscriptions.push(vscode.tasks.onDidEndTaskProcess((event) => tasksHandler.onDidEndTaskProcess(event)));
    subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => autoprojTaskProvider.reloadTasks()));
    subscriptions.push(vscode.workspace.onDidOpenTextDocument((event: vscode.TextDocument) => {
        eventHandler.onDidOpenTextDocument(event);
    }));
    subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        event.added.forEach((folder) => eventHandler.onWorkspaceFolderAdded(folder));
        event.removed.forEach((folder) => eventHandler.onWorkspaceFolderRemoved(folder));
        autoprojTaskProvider.reloadTasks();
    }));
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(extensionContext: vscode.ExtensionContext) {
    const vscodeWrapper = new wrappers.VSCode(extensionContext);
    await setupExtension(extensionContext.subscriptions, vscodeWrapper);
}

// this method is called when your extension is deactivated
export function deactivate() {
    // no-op
}
