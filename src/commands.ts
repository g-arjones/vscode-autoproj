import { basename, relative, dirname, join as pathjoin } from 'path';
import * as context from './context';
import * as wrappers from './wrappers';
import * as vscode from 'vscode'
import * as autoproj from './autoproj';

function findInsertIndex(array, predicate) {
    for (let i = 0; i < array.length; ++i) {
        let element = array[i];
        if (predicate(element)) {
            return i;
        }
    }
    return 0
}

export class Commands
{
    private readonly _context: context.Context;
    private readonly _vscode : wrappers.VSCode;

    constructor(context: context.Context, vscode : wrappers.VSCode)
    {
        this._context = context;
        this._vscode  = vscode;
    }

    async showWorkspacePicker(): Promise<autoproj.Workspace | undefined>
    {
        if (this._context.workspaces.workspaces.size == 0) {
            throw new Error("No Autoproj workspace found")
        }
        let choices: { label, description, ws }[] = [];
        function addChoice(ws: autoproj.Workspace)
        {
            const choice = {
                label: basename(ws.root),
                description: basename(dirname(ws.root)),
                ws: ws
            }
            choices.push(choice);
        }
        if (this._context.workspaces.workspaces.size == 1) {
            return this._context.workspaces.workspaces.values().next().value;
        }
        this._context.workspaces.forEachWorkspace((ws) => {
            addChoice(ws);
        })
        const options: vscode.QuickPickOptions = {
            placeHolder: 'Select a workspace'
        }
        const ws = await this._vscode.showQuickPick(choices, options);
        if (ws) {
            return ws.ws;
        }
    }

    async updatePackageInfo()
    {
        try {
            let ws = await this.showWorkspacePicker();
            if (ws) {
                await this._context.updateWorkspaceInfo(ws);
            }
        }
        catch (err) {
            this._vscode.showErrorMessage(err.message);
        }
    }

    showOutputChannel()
    {
        this._context.outputChannel.show();
    }

    async packagePickerChoices(): Promise<{ label, description, pkg }[]>
    {
        let choices: { label, description, pkg }[] = [];
        let fsPathsObj = {};
        const wsInfos: [autoproj.Workspace, Promise<autoproj.WorkspaceInfo>][] = [];

        this._context.workspaces.forEachWorkspace((ws) => wsInfos.push([ws, ws.info()]));
        if (this._vscode.workspaceFolders) {
            for (const folder of this._vscode.workspaceFolders) {
                fsPathsObj[folder.uri.fsPath] = true;
            }
        }
        for (const [ws, wsInfoP] of wsInfos) {
            try {
                const wsInfo = await wsInfoP;
                if (!fsPathsObj.hasOwnProperty(ws.root)) {
                    let name = `autoproj`
                    choices.push({
                        label: name,
                        description: `${ws.name} Build Configuration`,
                        pkg: { name: 'autoproj', srcdir: pathjoin(ws.root, 'autoproj') }
                    });
                }
                for (const aPkg of wsInfo.packages) {
                    if (!fsPathsObj.hasOwnProperty(aPkg[1].srcdir)) {
                        choices.push({
                            label: aPkg[1].name,
                            description: basename(wsInfo.path),
                            pkg: aPkg[1]
                        });
                    }
                }
            }
            catch (err) {
                throw new Error(
                    `Could not load installation manifest: ${err.message}`);
            }
        }
        choices.sort((a, b) =>
            a.pkg.name < b.pkg.name ? -1 : a.pkg.name > b.pkg.name ? 1 : 0);
        return choices;
    }

    async addPackageToWorkspace()
    {
        const tokenSource = new vscode.CancellationTokenSource();
        const options: vscode.QuickPickOptions = {
            placeHolder: 'Select a package to add to this workspace'
        }
        const choices = this.packagePickerChoices();
        choices.catch((err) => {
            this._vscode.showErrorMessage(err.message);
            tokenSource.cancel();
        })

        const selectedOption = await this._vscode.showQuickPick(choices,
            options, tokenSource.token);

        tokenSource.dispose();
        if (selectedOption) {
            const name = selectedOption.pkg.name;
            const wsFolders = this._vscode.workspaceFolders;
            let start = 0;
            if (wsFolders) {
                start = findInsertIndex(wsFolders, ((f) => name < f.name))
            }

            const folder = {
                name: name,
                uri: vscode.Uri.file(selectedOption.pkg.srcdir) };
            if (!this._vscode.updateWorkspaceFolders(start, null, folder)) {
                this._vscode.showErrorMessage(
                    `Could not add folder: ${selectedOption.pkg.srcdir}`);
            }
        }
    }

    register()
    {
        this._vscode.registerAndSubscribeCommand('autoproj.updatePackageInfo', () => { this.updatePackageInfo() });
        this._vscode.registerAndSubscribeCommand('autoproj.showOutputChannel', () => { this.showOutputChannel() });
        this._vscode.registerAndSubscribeCommand('autoproj.addPackageToWorkspace', () => { this.addPackageToWorkspace() });
    }
}
