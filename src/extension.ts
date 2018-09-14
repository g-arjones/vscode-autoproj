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

function watchManifest(ws: autoproj.Workspace, fileWatcher: watcher.FileWatcher)
{
    let manifestPath = autoproj.installationManifestPath(ws.root);
    try {
        fileWatcher.startWatching(manifestPath, (filePath) => {
            ws.reload().catch(err => {
                    let errMsg = `Could not load installation manifest: ${err.message}`
                    vscode.window.showErrorMessage(errMsg);
                }
            );
        });
    } catch (err) {
        vscode.window.showErrorMessage(err.message);
    }
}

function unwatchManifest(ws: autoproj.Workspace, fileWatcher: watcher.FileWatcher)
{
    try {
        fileWatcher.stopWatching(autoproj.installationManifestPath(ws.root));
    }
    catch (err) {
        vscode.window.showErrorMessage(err.message);
    }
}

function handleNewWorkspaceFolder(
        path: string,
        workspaces: autoproj.Workspaces,
        fileWatcher: watcher.FileWatcher) : void {
    let { added, workspace } = workspaces.addFolder(path);
    if (added && workspace) {
        workspace.info().catch(err => {
                let errMsg = `Could not load installation manifest: ${err.message}`
                vscode.window.showErrorMessage(errMsg);
        })
        vscode.commands.executeCommand('workbench.action.tasks.runTask', `autoproj: ${workspace.name}: Watch`)
        watchManifest(workspace, fileWatcher);
    }
}

function initializeWorkspacesFromVSCodeFolders(workspaces: autoproj.Workspaces,
                                               fileWatcher: watcher.FileWatcher) {
    if (vscode.workspace.workspaceFolders != undefined) {
        vscode.workspace.workspaceFolders.forEach((folder) => {
            handleNewWorkspaceFolder(folder.uri.fsPath, workspaces, fileWatcher);
        });
    }
}

function setupEvents(extensionContext: vscode.ExtensionContext,
                     workspaces: autoproj.Workspaces, taskProvider: tasks.AutoprojProvider,
                     fileWatcher: watcher.FileWatcher) {
    extensionContext.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            event.added.forEach((folder) => {
                handleNewWorkspaceFolder(folder.uri.fsPath, workspaces, fileWatcher);
            });
            event.removed.forEach((folder) => {
                let deletedWs = workspaces.deleteFolder(folder.uri.fsPath);
                if (deletedWs) {
                    unwatchManifest(deletedWs, fileWatcher);
                    deletedWs.readWatchPID().
                        then((pid) => process.kill(pid, 'SIGINT')).
                        catch(() => {})
                }
            });
            taskProvider.reloadTasks();
        })
    );
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(extensionContext: vscode.ExtensionContext) {
    let fileWatcher = new watcher.FileWatcher();
    let vscodeWrapper = new wrappers.VSCode(extensionContext);
    let outputChannel = vscode.window.createOutputChannel('Autoproj');
    let workspaces = new autoproj.Workspaces(null, outputChannel);
    let autoprojTaskProvider = new tasks.AutoprojProvider(workspaces);
    let autoprojContext = new context.Context(vscodeWrapper, workspaces, outputChannel);
    let autoprojCommands = new commands.Commands(autoprojContext, vscodeWrapper);

    extensionContext.subscriptions.push(vscode.workspace.registerTaskProvider('autoproj', autoprojTaskProvider));
    initializeWorkspacesFromVSCodeFolders(workspaces, fileWatcher);
    autoprojTaskProvider.reloadTasks();
    setupEvents(extensionContext, workspaces, autoprojTaskProvider, fileWatcher);
    autoprojCommands.register();

    extensionContext.subscriptions.push(workspaces);
    extensionContext.subscriptions.push(outputChannel);
    extensionContext.subscriptions.push(autoprojContext);
    extensionContext.subscriptions.push(fileWatcher);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
