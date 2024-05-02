import { basename, dirname, join as pathjoin } from "path";
import * as yaml from "js-yaml";
import { CancellationTokenSource, QuickPickOptions, Uri } from "vscode";
import { fs } from "./cmt/pr";
import * as autoproj from "./autoproj";
import * as tasks from "./tasks";
import * as wrappers from "./wrappers";
import * as path from "path";
import { ShimsWriter } from "./shimsWriter";

export class Commands {
    constructor(private readonly _workspaces: autoproj.Workspaces,
                private readonly _vscode: wrappers.VSCode) {
    }

    public async showWorkspacePicker(): Promise<autoproj.Workspace | undefined> {
        if (this._workspaces.workspaces.size === 0) {
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
        if (this._workspaces.workspaces.size === 1) {
            return this._workspaces.workspaces.values().next().value;
        }
        this._workspaces.forEachWorkspace((workspace: autoproj.Workspace) => {
            addChoice(workspace);
        });
        const options: QuickPickOptions = {
            placeHolder: "Select a workspace",
        };
        const ws = await this._vscode.showQuickPick(choices, options);
        if (ws) {
            return ws.ws;
        }
    }

    public async updatePackageInfo() {
        try {
            const ws = await this.showWorkspacePicker();
            if (ws) {
                const allTasks = await this._vscode.fetchTasks(tasks.WORKSPACE_TASK_FILTER);
                const updateEnvironmentTask = allTasks.find((task) =>
                    task.definition.mode === tasks.WorkspaceTaskMode.UpdateEnvironment &&
                    task.definition.workspace === ws.root);

                this._vscode.executeTask(updateEnvironmentTask!);
            }
        } catch (err) {
            this._vscode.showErrorMessage(err.message);
        }
    }

    public async packagePickerChoices(): Promise<Array<{ label, description, pkg }>> {
        const choices: Array<{ label, description, pkg }> = [];
        const fsPathsObj = {};
        const wsInfos: Array<[autoproj.Workspace, Promise<autoproj.WorkspaceInfo>]> = [];

        this._workspaces.forEachWorkspace((ws) => wsInfos.push([ws, ws.info()]));
        if (this._vscode.workspaceFolders) {
            for (const folder of this._vscode.workspaceFolders) {
                fsPathsObj[folder.uri.fsPath] = true;
            }
        }
        for (const [ws, wsInfoP] of wsInfos) {
            try {
                const wsInfo = await wsInfoP;
                const buildconfPath = pathjoin(ws.root, "autoproj");
                if (!fsPathsObj.hasOwnProperty(buildconfPath)) {
                    const name = `autoproj`;
                    choices.push({
                        description: `${ws.name} (buildconf)`,
                        label: name,
                        pkg: { name: `autoproj (${ws.name})`, srcdir: buildconfPath },
                    });
                }
                for (const pkgSet of wsInfo.packageSets) {
                    if (!fsPathsObj.hasOwnProperty(pkgSet[1].user_local_dir)) {
                        choices.push({
                            description: `${ws.name} (package set)`,
                            label: pkgSet[1].name,
                            pkg: { name: `${pkgSet[1].name} (package set)`, srcdir: pkgSet[1].user_local_dir },
                        });
                    }
                }
                for (const aPkg of wsInfo.packages) {
                    if (!fsPathsObj.hasOwnProperty(aPkg[1].srcdir)) {
                        choices.push({
                            description: ws.name,
                            label: aPkg[1].name,
                            pkg: aPkg[1],
                        });
                    }
                }
            } catch (err) {
                throw new Error(`Could not load installation manifest: ${err.message}`);
            }
        }
        choices.sort((a, b) =>
            a.pkg.name < b.pkg.name ? -1 : a.pkg.name > b.pkg.name ? 1 : 0);
        return choices;
    }

    public async addPackageToWorkspace() {
        const tokenSource = new CancellationTokenSource();
        const options: QuickPickOptions = {
            matchOnDescription: true,
            placeHolder: "Select a package to add to this workspace",
        };
        const choices = this.packagePickerChoices();
        choices.catch((err) => {
            this._vscode.showErrorMessage(err.message);
            tokenSource.cancel();
        });

        const selectedOption = await this._vscode.showQuickPick(choices, options, tokenSource.token);

        tokenSource.dispose();
        if (selectedOption) {
            const wsFolders = this._vscode.workspaceFolders;
            let folders = wsFolders?.map((folder) => { return { name: folder.name, uri: folder.uri }; }) || [];
            folders = folders.concat({
                name: selectedOption.pkg.name,
                uri: Uri.file(selectedOption.pkg.srcdir),
            });

            const buildconfPaths = [...this._workspaces.workspaces.values()]
                .map((folder) => path.join(folder.root, "autoproj"));
            const buildconfs = folders.filter((folder) => buildconfPaths.includes(folder.uri.fsPath));
            folders = folders.filter((folder) => !buildconfs.includes(folder));
            const pkgSets = folders.filter(
                (folder) => buildconfPaths.some((configPath) => folder.uri.fsPath.startsWith(configPath)));
            const pkgs = folders.filter((folder) => !pkgSets.includes(folder));

            [buildconfs, pkgSets, pkgs].forEach(group => {
                group.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
            });

            if (!this._vscode.updateWorkspaceFolders(0, wsFolders?.length || null, ...buildconfs, ...pkgSets, ...pkgs)) {
                this._vscode.showErrorMessage(`Could not add folder: ${selectedOption.pkg.srcdir}`);
            }
        }
    }

    private _assertSingleAutoprojWorkspace(what: string) {
        const workspaces = [...this._workspaces.workspaces.values()];
        if (workspaces.length == 0) {
            throw new Error(`Cannot setup ${what} for an empty workspace`);
        } else if (workspaces.length > 1) {
            throw new Error(`Cannot setup ${what} for multiple Autoproj workspaces`);
        }
    }

    public async setupPythonDefaultInterpreter() {
        try {
            this._assertSingleAutoprojWorkspace("Python default interpreter");
            const workspaces = [...this._workspaces.workspaces.values()];
            const pythonShimPath = path.join(workspaces[0].root, ShimsWriter.RELATIVE_SHIMS_PATH, "python");
            this._vscode.getConfiguration().update("python.defaultInterpreterPath", pythonShimPath);
        } catch (error) {
            await this._vscode.showErrorMessage(error.message);
        }
    }

    private async _writeWorkspaceGemfile(ws: autoproj.Workspace) {
        try {
            const overridesPath = path.join(ws.root, "autoproj", "overrides.d");
            const gemfileContents = [
                '# frozen_string_literal: true',
                '# AUTO GENERATED BY THE VSCODE AUTOPROJ EXTENSION',
                'source "https://rubygems.org"',
                '',
                'gem "ruby-lsp"',
                'gem "debug"',
                ''
            ].join("\n");

            await fs.mkdir_p(overridesPath);
            await fs.writeFile(path.join(overridesPath, "vscode-autoproj.gemfile"), gemfileContents);
        } catch (error) {
            throw new Error(`Could not create the extension's Gemfile in 'autoproj/overrides.d': ${error.message}`);
        }
    }

    private async _updateRubyLspConfiguration(ws: autoproj.Workspace) {
        try {
            const shimsPath = path.join(ws.root, ShimsWriter.RELATIVE_SHIMS_PATH);
            const env: any = yaml.load(await fs.readFile(path.join(ws.root, ".autoproj", "env.yml")));

            // TODO: check if keys exist
            const wsGemfile = env["set"]["BUNDLE_GEMFILE"][0];

            this._vscode.getConfiguration("rubyLsp").update("rubyVersionManager.identifier", "custom");
            this._vscode.getConfiguration("rubyLsp").update("customRubyCommand", `PATH=${shimsPath}:$PATH`);
            this._vscode.getConfiguration("rubyLsp").update("bundleGemfile", wsGemfile);
        } catch (error) {
            throw new Error(`Unable to read the workspaces's environment: ${error.message}`);
        }
    }

    public async setupRubyExtension() {
        try {
            this._assertSingleAutoprojWorkspace("Ruby extension");

            const ws = [...this._workspaces.workspaces.values()][0];
            await this._writeWorkspaceGemfile(ws);
            await this._updateRubyLspConfiguration(ws);

            const message = [
                `A vscode-autoproj.gemfile was created in 'autoproj/overrides.d' on the '${ws.name}' workspace. `,
                'To complete the Ruby integration, please run "autoproj osdeps" on your workspace and restart vscode.'
            ]

            this._vscode.showInformationMessage(message.join(""), { modal: true });
        } catch (error) {
            await this._vscode.showErrorMessage(error.message);
        }
    }

    public register() {
        this._vscode.registerAndSubscribeCommand("autoproj.addPackageToWorkspace", () => {
            this.addPackageToWorkspace();
        });
        this._vscode.registerAndSubscribeCommand("autoproj.updatePackageInfo", () => { this.updatePackageInfo(); });
        this._vscode.registerAndSubscribeCommand("autoproj.setupRubyExtension", () => {
            this.setupRubyExtension();
        });
        this._vscode.registerAndSubscribeCommand("autoproj.setupPythonDefaultInterpreter", () => {
            this.setupPythonDefaultInterpreter();
        });
    }
}
