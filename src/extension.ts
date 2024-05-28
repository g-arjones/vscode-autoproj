"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path";
import * as vscode from "vscode";
import * as autoproj from "./autoproj";
import * as commands from "./commands";
import * as tasks from "./tasks";
import * as watcher from "./fileWatcher";
import * as cpptools from "./cpptools";
import { BundleManager } from "./bundleWatcher";
import { ConfigManager } from "./configManager";
import { WatchManager } from "./workspaceWatcher";

export class EventHandler implements vscode.Disposable {
    private _fileWatcher: watcher.FileWatcher;
    private _workspaces: autoproj.Workspaces;
    private _cppConfigurationProvider: cpptools.CppConfigurationProvider;
    private _watchManager: WatchManager;
    private _configManager: ConfigManager;

    constructor(workspaces: autoproj.Workspaces,
                cppConfigurationProvider: cpptools.CppConfigurationProvider,
                watchManager: WatchManager, configManager: ConfigManager) {
        this._fileWatcher = new watcher.FileWatcher();
        this._workspaces = workspaces;
        this._cppConfigurationProvider = cppConfigurationProvider;
        this._watchManager = watchManager;
        this._configManager = configManager;
    }

    public dispose() {
        this._fileWatcher.dispose();
    }

    public async onDidOpenTextDocument(event: vscode.TextDocument) {
        const docName = path.basename(event.uri.fsPath);
        const docDir = path.dirname(event.uri.fsPath);

        for (const [, ws] of this._workspaces.workspaces) {
            if ((docDir === path.join(ws.root, "autoproj")) && (docName.startsWith("manifest."))) {
                await vscode.languages.setTextDocumentLanguage(event, "yaml");
                break;
            }
        }
    }

    public async onManifestChanged(ws: autoproj.Workspace): Promise<void> {
        try {
            await ws.reload();
        } catch (err) {
            vscode.window.showErrorMessage(`Could not load installation manifest: ${err.message}`);
        }
        this._watchManager.start(ws);
        this._cppConfigurationProvider.notifyChanges();
    }

    public async onWorkspaceFolderAdded(folder: vscode.WorkspaceFolder): Promise<void> {
        const { added, workspace } = this._workspaces.addFolder(folder.uri.fsPath);
        if (added && workspace) {
            try {
                await workspace.info();
            } catch (err) {
                vscode.window.showErrorMessage(`Could not load installation manifest: ${err.message}`);
            }
            await this._configManager.setupExtension();
            this._cppConfigurationProvider.notifyChanges();
            this.watchManifest(workspace);
            this._watchManager.start(workspace);
        }
    }

    public async onWorkspaceFolderRemoved(folder: vscode.WorkspaceFolder): Promise<void> {
        this._cppConfigurationProvider.notifyChanges();
        const deletedWs = this._workspaces.deleteFolder(folder.uri.fsPath);
        if (deletedWs) {
            this.unwatchManifest(deletedWs);
            this._configManager.onWorkspaceRemoved(deletedWs);
            await this._watchManager.stop(deletedWs);
        }
        this._configManager.cleanupTestMate();
    }

    public watchManifest(ws: autoproj.Workspace): void {
        const manifestPath = autoproj.installationManifestPath(ws.root);
        try {
            this._fileWatcher.startWatching(manifestPath, () => this.onManifestChanged(ws));
        } catch (err) {
            vscode.window.showErrorMessage(err.message);
        }
    }

    public unwatchManifest(ws: autoproj.Workspace): void {
        try {
            this._fileWatcher.stopWatching(autoproj.installationManifestPath(ws.root));
        } catch (err) {
            vscode.window.showErrorMessage(err.message);
        }
    }
}

export async function setupExtension(subscriptions: vscode.Disposable[]) {
    const workspaces = new autoproj.Workspaces();
    const autoprojTaskProvider = new tasks.AutoprojProvider(workspaces);
    const autoprojPackageTaskProvider = new tasks.AutoprojPackageTaskProvider(autoprojTaskProvider);
    const autoprojWorkspaceTaskProvider = new tasks.AutoprojWorkspaceTaskProvider(autoprojTaskProvider);
    const cppConfigurationProvider = new cpptools.CppConfigurationProvider(workspaces);
    const outputChannel = vscode.window.createOutputChannel("Autoproj", { log: true });
    const bundleManager = new BundleManager(outputChannel);
    const autoprojCommands = new commands.Commands(workspaces, outputChannel);
    const watchManager = new WatchManager(outputChannel);
    const tasksHandler = new tasks.Handler(workspaces);
    const configManager = new ConfigManager(bundleManager, workspaces);
    const eventHandler = new EventHandler(workspaces, cppConfigurationProvider, watchManager, configManager);

    subscriptions.push(vscode.tasks.registerTaskProvider("autoproj-workspace", autoprojWorkspaceTaskProvider));
    subscriptions.push(vscode.tasks.registerTaskProvider("autoproj-package", autoprojPackageTaskProvider));

    if (vscode.workspace.workspaceFolders) {
        vscode.workspace.workspaceFolders.forEach((folder) => eventHandler.onWorkspaceFolderAdded(folder));
        configManager.cleanupTestMate();
    }

    autoprojTaskProvider.reloadTasks();
    autoprojCommands.register(subscriptions);
    cppConfigurationProvider.register();

    subscriptions.push(bundleManager);
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
    await setupExtension(extensionContext.subscriptions);
}

// this method is called when your extension is deactivated
export function deactivate() {
    // no-op
}
