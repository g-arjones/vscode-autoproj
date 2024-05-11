import { basename, dirname, join as pathjoin } from "path";
import * as yaml from "js-yaml";
import {
    QuickPickOptions,
    Uri,
    WorkspaceFolder,
    DebugConfiguration,
    QuickPickItem
} from "vscode";
import { fs } from "./cmt/pr";
import * as shlex from "./cmt/shlex";
import * as autoproj from "./autoproj";
import * as tasks from "./tasks";
import * as wrappers from "./wrappers";
import * as path from "path";
import { ShimsWriter } from "./shimsWriter";

interface IWorkspaceItem extends QuickPickItem {
    description: string,
    label: string,
    workspace: autoproj.Workspace,
}

interface IFolderItem extends QuickPickItem {
    description: string,
    label: string,
    folder: {
        name: string,
        uri: Uri
    }
}

export class Commands {
    private _lastDebuggingSession: { ws: WorkspaceFolder | undefined, config: DebugConfiguration } | undefined;
    constructor(private readonly _workspaces: autoproj.Workspaces,
                private readonly _vscode: wrappers.VSCode) {
    }

    public async showWorkspacePicker(): Promise<autoproj.Workspace | undefined> {
        if (this._workspaces.workspaces.size === 0) {
            throw new Error("No Autoproj workspace found");
        }
        if (this._workspaces.workspaces.size === 1) {
            return this._workspaces.workspaces.values().next().value;
        }
        const choices: IWorkspaceItem[] = [...this._workspaces.workspaces.values()].map((workspace) => {
            return {
                description: basename(dirname(workspace.root)),
                label: `$(root-folder) ${workspace.name}`,
                workspace: workspace,
            }
        });
        const ws = await this._vscode.showQuickPick(choices, { placeHolder: "Select a workspace" });
        return ws?.workspace;
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

    public async packagePickerChoices(): Promise<IFolderItem[]> {
        let choices: IFolderItem[] = [];
        let currentFsPaths = this._vscode.workspaceFolders?.map((folder) => folder.uri.fsPath) || [];
        for (const ws of this._workspaces.workspaces.values()) {
            try {
                const wsInfo = await ws.info();
                const buildconfPath = pathjoin(ws.root, "autoproj");
                if (!currentFsPaths.includes(buildconfPath)) {
                    const name = `autoproj`;
                    choices.push({
                        description: `${ws.name} (buildconf)`,
                        label: `$(root-folder) ${name}`,
                        folder: { name: `autoproj (${ws.name})`, uri: Uri.file(buildconfPath) },
                    });
                }
                for (const pkgSet of wsInfo.packageSets.values()) {
                    if (!currentFsPaths.includes(pkgSet.user_local_dir)) {
                        choices.push({
                            description: `${ws.name} (package set)`,
                            label: `$(folder-library) ${pkgSet.name}`,
                            folder: { name: `${pkgSet.name} (package set)`, uri: Uri.file(pkgSet.user_local_dir) }
                        });
                    }
                }
                for (const pkg of wsInfo.packages.values()) {
                    if (!currentFsPaths.includes(pkg.srcdir)) {
                        choices.push({
                            description: ws.name,
                            label: `$(folder) ${pkg.name}`,
                            folder: { name: pkg.name, uri: Uri.file(pkg.srcdir) },
                        });
                    }
                }
            } catch (err) {
                throw new Error(`Could not load installation manifest: ${err.message}`);
            }
        }
        choices.sort((a, b) =>
            a.folder.name < b.folder.name ? -1 : a.folder.name > b.folder.name ? 1 : 0);

        return choices;
    }

    public async addPackageToWorkspace() {
        const options: QuickPickOptions = {
            matchOnDescription: true,
            placeHolder: "Select a package to add to this workspace",
        };

        const choices = await this.packagePickerChoices();
        const selectedOption = await this._vscode.showQuickPick(choices, options);

        if (selectedOption) {
            const wsFolders = this._vscode.workspaceFolders;
            let folders = wsFolders?.map((folder) => { return { name: folder.name, uri: folder.uri }; }) || [];
            folders = folders.concat(selectedOption.folder);

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
                throw (`Could not add folder: ${selectedOption.folder.uri.fsPath}`);
            }
        }
    }

    private _assertWorkspaceNotEmpty(message: string) {
        const workspaces = [...this._workspaces.workspaces.values()];
        if (workspaces.length == 0) {
            throw new Error(message);
        }
    }

    private _assertSingleAutoprojWorkspace(messageEmpty: string, messageMany: string) {
        this._assertWorkspaceNotEmpty(messageEmpty);

        const workspaces = [...this._workspaces.workspaces.values()];
        if (workspaces.length > 1) {
            throw new Error(messageMany);
        }
    }

    public async setupPythonDefaultInterpreter() {
        this._assertSingleAutoprojWorkspace(
            "Cannot setup Python default interpreter for an empty workspace",
            "Cannot setup Python default interpreter for multiple Autoproj workspaces");

        const workspaces = [...this._workspaces.workspaces.values()];
        const pythonShimPath = path.join(workspaces[0].root, ShimsWriter.RELATIVE_SHIMS_PATH, "python");
        this._vscode.getConfiguration().update("python.defaultInterpreterPath", pythonShimPath);
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

    public async saveLastDebuggingSession() {
        if (!this._lastDebuggingSession) {
            throw new Error("You have not started a debugging session yet");
        }
        this._assertWorkspaceNotEmpty("Cannot save a debugging session in an empty workspace");

        const wsConfig = this._vscode.getConfiguration("launch");
        let currentDebugConfigs = wsConfig.configurations as Array<any>;

        const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        if (currentDebugConfigs.some((config) => jsonEqual(config, this._lastDebuggingSession?.config))) {
            return;
        }

        let newConfigurations = currentDebugConfigs.concat(this._lastDebuggingSession.config);
        newConfigurations = newConfigurations.sort((a, b) =>
            a["name"] < b["name"] ? -1 : a["name"] > b["name"] ? 1 : 0);

        wsConfig.update("configurations", newConfigurations)
    }

    public async restartDebugging() {
        if (!this._lastDebuggingSession) {
            throw new Error("You have not started a debugging session yet");
        }
        await this._vscode.startDebugging(this._lastDebuggingSession.ws, this._lastDebuggingSession.config);
    }

    public async getCurrentWorkspaceAndPackage(): Promise<{ workspace: autoproj.Workspace, package: autoproj.IPackage | undefined } | undefined> {
        const currentFile = this._vscode.activeDocumentURI;
        if (currentFile) {
            return this._workspaces.getWorkspaceAndPackage(currentFile)
        }
    }

    public async guessCurrentTestBinaryDir() {
        let defaultUri: Uri;
        const wsAndPkg = await this.getCurrentWorkspaceAndPackage();

        if (wsAndPkg) {
            defaultUri = Uri.file(wsAndPkg.workspace.root);
            if (wsAndPkg.package) {
                const pkg = wsAndPkg.package
                if (pkg.builddir && await fs.exists(path.join(pkg.builddir))) {
                    const testdir = path.join(wsAndPkg.package.builddir, "test");
                    defaultUri = await fs.exists(testdir) ? Uri.file(testdir) : Uri.file(pkg.builddir);
                }
            }
        } else {
            const workspaceList = [...this._workspaces.workspaces.values()];
            defaultUri = Uri.file(workspaceList[0].root)
        }

        return defaultUri;
    }

    public async startDebugging() {
        const workspaceList = [...this._workspaces.workspaces.values()];
        if (workspaceList.length == 0) {
            throw new Error("Cannot debug an empty workspace");
        }

        let name: string;
        const program = await this._vscode.showOpenDialog({
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: "Debug",
            defaultUri: await this.guessCurrentTestBinaryDir(),
            title: "Select an executable to debug"
        });

        if (!program) {
            return;
        }

        let packageSrcDir: string | undefined;
        const programContext = await this._workspaces.getWorkspaceAndPackage(program[0]);
        const programPath = program[0].fsPath;

        if (programContext) {
            name = path.basename(programPath);
            for (const ws of workspaceList) {
                const wsInfo = await ws.info();
                for (const pkg of [...wsInfo.packages.values()]) {
                    if (pkg.builddir && programPath.startsWith(pkg.builddir)) {
                        packageSrcDir = pkg.srcdir;
                        name = `${pkg.name}/${name}`;
                        break;
                    }
                    if (pkg.srcdir && programPath.startsWith(pkg.srcdir)) {
                        packageSrcDir = pkg.srcdir;
                        name = `${pkg.name}/${name}`;
                        break;
                    }
                }
            }
            name += ` (${programContext.workspace.name})`;
        } else {
            throw new Error("The selected program is not in any open Autoproj workspace");
        }

        const args = await this._vscode.showInputBox({
            title: "Program arguments",
            placeHolder: "Optional command line arguments for the program"
        });

        if (args === undefined) {
            return;
        }

        const debuggerPath = path.join(programContext.workspace.root, ShimsWriter.RELATIVE_SHIMS_PATH, "gdb");
        const parentWs = this._vscode.getWorkspaceFolder(Uri.file(packageSrcDir || programContext.workspace.root));
        const config = {
            "name": name,
            "type": "cppdbg",
            "request": "launch",
            "cwd": `${path.dirname(programPath)}`,
            "program": programPath,
            "args": [...shlex.split(args)],
            "stopAtEntry": false,
            "environment": [],
            "externalConsole": false,
            "MIMode": "gdb",
            "miDebuggerPath": debuggerPath,
            "setupCommands": [
                {
                    "description": "Enable pretty-printing for gdb",
                    "text": "-enable-pretty-printing",
                    "ignoreFailures": true
                }
            ]
        }

        this._lastDebuggingSession = { ws: parentWs, config };
        await this._vscode.startDebugging(parentWs, config);
    }

    public async setupRubyExtension() {
        this._assertSingleAutoprojWorkspace(
            "Cannot setup Ruby extension for an empty workspace",
            "Cannot setup Ruby extension for multiple Autoproj workspaces");

        const ws = [...this._workspaces.workspaces.values()][0];
        await this._writeWorkspaceGemfile(ws);
        await this._updateRubyLspConfiguration(ws);

        const message = [
            `A vscode-autoproj.gemfile was created in 'autoproj/overrides.d' on the '${ws.name}' workspace. `,
            'To complete the Ruby integration, please run "autoproj osdeps" on your workspace and restart vscode.'
        ]

        this._vscode.showInformationMessage(message.join(""), { modal: true });
    }

    public async handleError(f: () => void | Promise<void>) {
        try {
            await f();
        } catch (error) {
            await this._vscode.showErrorMessage(error.message);
        }
    }

    public register() {
        this._vscode.registerAndSubscribeCommand("autoproj.addPackageToWorkspace", () => {
            this.handleError(() => this.addPackageToWorkspace());
        });
        this._vscode.registerAndSubscribeCommand("autoproj.updatePackageInfo", () => { this.updatePackageInfo(); });
        this._vscode.registerAndSubscribeCommand("autoproj.setupRubyExtension", () => {
            this.handleError(() => this.setupRubyExtension());
        });
        this._vscode.registerAndSubscribeCommand("autoproj.setupPythonDefaultInterpreter", () => {
            this.handleError(() => this.setupPythonDefaultInterpreter());
        });
        this._vscode.registerAndSubscribeCommand("autoproj.startDebugging", () => {
            this.handleError(() => this.startDebugging());
        });
        this._vscode.registerAndSubscribeCommand("autoproj.restartDebugging", () => {
            this.handleError(() => this.restartDebugging());
        });
        this._vscode.registerAndSubscribeCommand("autoproj.saveLastDebuggingSession", () => {
            this.handleError(() => this.saveLastDebuggingSession());
        });
    }
}
