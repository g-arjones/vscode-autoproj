import { basename, dirname, join as pathjoin, relative } from "path";
import { CancellationTokenSource, QuickPickOptions, Uri } from "vscode";
import * as autoproj from "./autoproj";
import { Context } from "./context";
import * as wrappers from "./wrappers";

function findInsertIndex(array, predicate) {
    for (let i = 0; i < array.length; ++i) {
        const element = array[i];
        if (predicate(element)) {
            return i;
        }
    }
    return 0;
}

export class Commands {
    constructor(private readonly context: Context,
                private readonly vscode: wrappers.VSCode) {
    }

    public async showWorkspacePicker(): Promise<autoproj.Workspace | undefined> {
        if (this.context.workspaces.workspaces.size === 0) {
            throw new Error("No Autoproj workspace found");
        }
        const choices: Array<{ label, description, ws }> = [];
        function addChoice(workspace: autoproj.Workspace) {
            const choice = {
                description: basename(dirname(workspace.root)),
                label: basename(workspace.root),
                ws: workspace,
            };
            choices.push(choice);
        }
        if (this.context.workspaces.workspaces.size === 1) {
            return this.context.workspaces.workspaces.values().next().value;
        }
        this.context.workspaces.forEachWorkspace((workspace: autoproj.Workspace) => {
            addChoice(workspace);
        });
        const options: QuickPickOptions = {
            placeHolder: "Select a workspace",
        };
        const ws = await this.vscode.showQuickPick(choices, options);
        if (ws) {
            return ws.ws;
        }
    }

    public async updatePackageInfo() {
        try {
            const ws = await this.showWorkspacePicker();
            if (ws) {
                await this.context.updateWorkspaceInfo(ws);
            }
        } catch (err) {
            this.vscode.showErrorMessage(err.message);
        }
    }

    public showOutputChannel() {
        this.context.outputChannel.show();
    }

    public async packagePickerChoices(): Promise<Array<{ label, description, pkg }>> {
        const choices: Array<{ label, description, pkg }> = [];
        const fsPathsObj = {};
        const wsInfos: Array<[autoproj.Workspace, Promise<autoproj.WorkspaceInfo>]> = [];

        this.context.workspaces.forEachWorkspace((ws) => wsInfos.push([ws, ws.info()]));
        if (this.vscode.workspaceFolders) {
            for (const folder of this.vscode.workspaceFolders) {
                fsPathsObj[folder.uri.fsPath] = true;
            }
        }
        for (const [ws, wsInfoP] of wsInfos) {
            try {
                const wsInfo = await wsInfoP;
                if (!fsPathsObj.hasOwnProperty(ws.root)) {
                    const name = `autoproj`;
                    choices.push({
                        description: `${ws.name} Build Configuration`,
                        label: name,
                        pkg: { name: "autoproj", srcdir: pathjoin(ws.root, "autoproj") },
                    });
                }
                for (const aPkg of wsInfo.packages) {
                    if (!fsPathsObj.hasOwnProperty(aPkg[1].srcdir)) {
                        choices.push({
                            description: basename(wsInfo.path),
                            label: aPkg[1].name,
                            pkg: aPkg[1],
                        });
                    }
                }
            } catch (err) {
                throw new Error(
                    `Could not load installation manifest: ${err.message}`);
            }
        }
        choices.sort((a, b) =>
            a.pkg.name < b.pkg.name ? -1 : a.pkg.name > b.pkg.name ? 1 : 0);
        return choices;
    }

    public async addPackageToWorkspace() {
        const tokenSource = new CancellationTokenSource();
        const options: QuickPickOptions = {
            placeHolder: "Select a package to add to this workspace",
        };
        const choices = this.packagePickerChoices();
        choices.catch((err) => {
            this.vscode.showErrorMessage(err.message);
            tokenSource.cancel();
        });

        const selectedOption = await this.vscode.showQuickPick(choices,
            options, tokenSource.token);

        tokenSource.dispose();
        if (selectedOption) {
            const name = selectedOption.pkg.name;
            const wsFolders = this.vscode.workspaceFolders;
            let start = 0;
            if (wsFolders) {
                start = findInsertIndex(wsFolders, ((f) => name < f.name));
            }

            const folder = {
                name,
                uri: Uri.file(selectedOption.pkg.srcdir) };
            if (!this.vscode.updateWorkspaceFolders(start, null, folder)) {
                this.vscode.showErrorMessage(
                    `Could not add folder: ${selectedOption.pkg.srcdir}`);
            }
        }
    }

    public register() {
        this.vscode.registerAndSubscribeCommand("autoproj.updatePackageInfo", () => { this.updatePackageInfo(); });
        this.vscode.registerAndSubscribeCommand("autoproj.showOutputChannel", () => { this.showOutputChannel(); });
        this.vscode.registerAndSubscribeCommand("autoproj.addPackageToWorkspace", () => {
            this.addPackageToWorkspace();
        });
    }
}
