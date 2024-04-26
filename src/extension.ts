"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path";
import * as vscode from "vscode";
import * as autoproj from "./autoproj";
import * as commands from "./commands";
import * as tasks from "./tasks";
import * as watcher from "./watcher";
import * as wrappers from "./wrappers";
import * as cpptools from "./cpptools";

export class EventHandler implements vscode.Disposable {
    private _wrapper: wrappers.VSCode;
    private _watcher: watcher.FileWatcher;
    private _workspaces: autoproj.Workspaces;
    private _workspaceRootToPid: Map<string, number>;
    private _cppConfigurationProvider: cpptools.CppConfigurationProvider;

    constructor(wrapper: wrappers.VSCode, fileWatcher: watcher.FileWatcher,
                workspaces: autoproj.Workspaces, cppConfigurationProvider: cpptools.CppConfigurationProvider) {
        this._wrapper = wrapper;
        this._watcher = fileWatcher;
        this._workspaces = workspaces;
        this._cppConfigurationProvider = cppConfigurationProvider;
        this._workspaceRootToPid = new Map();
    }

    public dispose() {
        for (const [, pid] of this._workspaceRootToPid) {
            try {
                this._wrapper.killProcess(pid, "SIGINT");
            } catch (error) {
                // either the user terminated the task or "autoproj watch" failed
            }
        }
        this._workspaceRootToPid.clear();
    }

    public onDidStartTaskProcess(event: vscode.TaskProcessStartEvent) {
        const task = event.execution.task;
        if (task.definition.type === tasks.TaskType.Workspace &&
            task.definition.mode === tasks.WorkspaceTaskMode.Watch) {
            this._workspaceRootToPid.set(task.definition.workspace, event.processId);
        }
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
            this._cppConfigurationProvider.notifyChanges();
        } catch (err) {
            this._wrapper.showErrorMessage(`Could not load installation manifest: ${err.message}`);
        }
    }

    public async onWorkspaceFolderAdded(folder: vscode.WorkspaceFolder): Promise<void> {
        const { added, workspace } = this._workspaces.addFolder(folder.uri.fsPath);
        if (added && workspace) {
            try {
                await workspace.info();
                this._cppConfigurationProvider.notifyChanges();
            } catch (err) {
                this._wrapper.showErrorMessage(`Could not load installation manifest: ${err.message}`);
            }
            /*
            TODO: FIXME!

            try {
                const allTasks = await this._wrapper.fetchTasks(tasks.WORKSPACE_TASK_FILTER);
                const watchTask = allTasks.find((task) => task.definition.mode === tasks.WorkspaceTaskMode.Watch &&
                                                          task.definition.workspace === workspace.root);

                this._wrapper.executeTask(watchTask!);
            } catch (err) {
                this._wrapper.showErrorMessage(`Could not start autoproj watch task: ${err.message}`);
            }
            */
            this.watchManifest(workspace);
        }
    }

    public async onWorkspaceFolderRemoved(folder: vscode.WorkspaceFolder): Promise<void> {
        const deletedWs = this._workspaces.deleteFolder(folder.uri.fsPath);
        if (deletedWs) {
            this.unwatchManifest(deletedWs);

            const pid = this._workspaceRootToPid.get(deletedWs.root);
            if (pid) {
                try {
                    this._wrapper.killProcess(pid, "SIGINT");
                } catch (error) {
                    // either the user stopped the task or it "autoproj watch" failed
                }
                this._workspaceRootToPid.delete(deletedWs.root);
            }
        }
    }

    public watchManifest(ws: autoproj.Workspace): void {
        const manifestPath = autoproj.installationManifestPath(ws.root);
        try {
            this._watcher.startWatching(manifestPath, () => this.onManifestChanged(ws));
        } catch (err) {
            this._wrapper.showErrorMessage(err.message);
        }
    }

    public unwatchManifest(ws: autoproj.Workspace): void {
        try {
            this._watcher.stopWatching(autoproj.installationManifestPath(ws.root));
        } catch (err) {
            this._wrapper.showErrorMessage(err.message);
        }
    }
}

export async function setupExtension(subscriptions: any[], vscodeWrapper: wrappers.VSCode) {
    const fileWatcher = new watcher.FileWatcher();
    const workspaces = new autoproj.Workspaces(null);
    const autoprojTaskProvider = new tasks.AutoprojProvider(workspaces, vscodeWrapper);
    const autoprojCommands = new commands.Commands(workspaces, vscodeWrapper);
    const cppConfigurationProvider = new cpptools.CppConfigurationProvider(workspaces);
    const eventHandler = new EventHandler(vscodeWrapper, fileWatcher, workspaces, cppConfigurationProvider);
    const tasksHandler = new tasks.Handler(vscodeWrapper, workspaces);

    subscriptions.push(vscode.tasks.registerTaskProvider("autoproj", autoprojTaskProvider));
    if (vscode.workspace.workspaceFolders) {
        vscode.workspace.workspaceFolders.forEach((folder) => eventHandler.onWorkspaceFolderAdded(folder));
    }

    autoprojTaskProvider.reloadTasks();
    autoprojCommands.register();
    cppConfigurationProvider.register();

    subscriptions.push(eventHandler);
    subscriptions.push(workspaces);
    subscriptions.push(fileWatcher);
    subscriptions.push(tasksHandler);
    subscriptions.push(cppConfigurationProvider);
    subscriptions.push(vscode.tasks.onDidStartTaskProcess((event) => {
        eventHandler.onDidStartTaskProcess(event);
        tasksHandler.onDidStartTaskProcess(event);
    }));
    subscriptions.push(vscode.workspace.onDidOpenTextDocument((event: vscode.TextDocument) => {
        eventHandler.onDidOpenTextDocument(event);
    }));
    subscriptions.push(vscode.tasks.onDidEndTaskProcess((event) => tasksHandler.onDidEndTaskProcess(event)));
    subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => autoprojTaskProvider.reloadTasks()));
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
