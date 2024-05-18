import { basename, dirname, join as pathjoin } from "path";
import {
    QuickPickOptions,
    Uri,
    WorkspaceFolder,
    DebugConfiguration,
    QuickPickItem,
    MessageItem,
    ConfigurationTarget,
    LogOutputChannel
} from "vscode";
import { fs } from "./cmt/pr";
import * as progress from "./progress";
import * as shlex from "./cmt/shlex";
import * as autoproj from "./autoproj";
import * as wrappers from "./wrappers";
import * as path from "path";
import { asyncSpawn, getLogger, IAsyncExecution, isSubdirOf } from "./util";
import { ShimsWriter } from "./shimsWriter";
import { BundleManager } from "./bundleWatcher";

interface IWorkspaceItem extends QuickPickItem {
    workspace: autoproj.Workspace,
}

interface IFolderItem extends QuickPickItem {
    folder: {
        name: string,
        uri: Uri
    }
}

interface ITestExecuable {
    name: string,
    workspace: autoproj.Workspace,
    path: string,
    package?: autoproj.IPackage
}

interface IPackageItem extends QuickPickItem {
    workspace: autoproj.Workspace,
    package: autoproj.IPackage
}

export class Commands {
    private _lastDebuggingSession: { ws: WorkspaceFolder | undefined, config: DebugConfiguration } | undefined;
    private _updateEnvExecutions: Map<string, IAsyncExecution>;

    constructor(private readonly _workspaces: autoproj.Workspaces,
                private readonly _vscode: wrappers.VSCode,
                private readonly _channel: LogOutputChannel,
                private readonly _bundleManager: BundleManager)
    {
        this._updateEnvExecutions = new Map();
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

    public async updateWorkspaceEnvironment() {
        let returnCode: number | null;
        const ws = await this.showWorkspacePicker();

        if (ws && !this._updateEnvExecutions.has(ws.root)) {
            const rubyopts = `-r${path.join(ws.root, ShimsWriter.RELATIVE_OPTS_PATH, "rubyopt.rb")}`;
            const env = { ...process.env, RUBYOPT: rubyopts };
            const logger = getLogger(this._channel, ws.name);
            const execution = asyncSpawn(logger, ws.autoprojExePath(), ["envsh"], { env: env });
            const view = progress.createProgressView(this._vscode, `Updating '${ws.name}' workspace environment`);

            this._updateEnvExecutions.set(ws.root, execution);
            view.show();

            try {
                returnCode = await execution.returnCode;
            } catch (err) {
                throw new Error(`Could not update '${ws.name}' workspace environment: ${err.message}`);
            } finally {
                view.close();
                this._updateEnvExecutions.delete(ws.root);
            }

            if (returnCode !== 0) {
                this._channel.show();
                throw new Error(`Failed while updating '${ws.name}' workspace`);
            }
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
                (folder) => buildconfPaths.some((configPath) => isSubdirOf(folder.uri.fsPath, configPath)));
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

        const experiments = this._vscode.getConfiguration("python.experiments");
        const optOutFrom = experiments.get<string[]>("optOutFrom") || [];
        experiments.update("optOutFrom", [...new Set([...optOutFrom, "pythonTestAdapter"])], ConfigurationTarget.Global);
    }

    public async addPackageToTestMate() {
        let packages: IPackageItem[] = (await this._workspaces.getPackagesInCodeWorkspace()).map((item) => {
            const ws = item.workspace;
            const pkg = item.package;

            return {
                description: ws.name,
                label: `$(folder) ${pkg.name}`,
                package: pkg,
                workspace: ws
            }
        });

        if (packages.length == 0) {
            this._vscode.showErrorMessage("No packages to add");
            return;
        }

        packages = packages.filter((pkg) => pkg.package.builddir);
        packages = packages.sort((a, b) =>
            a.package.name < b.package.name ? -1 : a.package.name > b.package.name ? 1 : 0);

        const options: QuickPickOptions = {
            matchOnDescription: true,
            placeHolder: "Select a package to add to TestMate C++",
        };

        const selectedPackage = await this._vscode.showQuickPick(packages, options);
        if (!selectedPackage) {
            return;
        }

        const ws = selectedPackage.workspace;
        const pkg = selectedPackage.package;
        const advancedExecutable = {
            "name": pkg.name,
            "pattern": path.join(pkg.builddir, "**", "*{test,Test,TEST}*"),
            "cwd": "${absDirpath}",
            "testGrouping": {
                "groupByLabel": {
                    "label": pkg.name,
                    "description": ws.name,
                    "groupByTags": {
                        "description": "${baseFilename}",
                        "tags": [], "tagFormat": "${tag}"
                    }
                },
            },
            "gtest": {
                "debug.enableOutputColouring": true,
            },
            "executionWrapper": {
                "path": ws.autoprojExePath(),
                "args": ["exec", "--use-cache", "${cmd}", "${argsFlat}"]
            },
            "debug.configTemplate": {
                "type": "cppdbg",
                "MIMode": "gdb",
                "program": "${exec}",
                "args": "${argsArray}",
                "cwd": "${cwd}",
                "miDebuggerPath": path.join(ws.root, ShimsWriter.RELATIVE_SHIMS_PATH, "gdb")
            }
        }

        const testMateConfig = this._vscode.getConfiguration("testMate.cpp.test");
        let advancedExecutables = testMateConfig.get<any[]>("advancedExecutables") || [];

        const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        if (advancedExecutables.some((config) => jsonEqual(config, advancedExecutable))) {
            return;
        }

        advancedExecutables.push(advancedExecutable);
        advancedExecutables = advancedExecutables.sort((a, b) =>
            a["name"] < b["name"] ? -1 : a["name"] > b["name"] ? 1 : 0);

        testMateConfig.update("advancedExecutables", advancedExecutables)
    }

    public async enableCmakeDebuggingSymbols() {
        this._assertWorkspaceNotEmpty("Cannot enable CMake debugging symbols on an empty workspace");
        const ws = await this.showWorkspacePicker();

        if (!ws) {
            return;
        }

        try {
            const overridesPath = path.join(ws.root, "autoproj", "overrides.d");
            const rbfileContents = [
                '# frozen_string_literal: true',
                '# AUTO GENERATED BY THE VSCODE AUTOPROJ EXTENSION',
                '',
                'Autoproj.workspace.manifest.each_autobuild_package do |pkg|',
                '   next unless pkg.kind_of?(Autobuild::CMake)',
                '',
                '   pkg.define "CMAKE_BUILD_TYPE", "Debug"',
                'end',
                ''
            ].join("\n");

            await fs.mkdir_p(overridesPath);
            await fs.writeFile(path.join(overridesPath, "vscode-autoproj-cmake-build-type.rb"), rbfileContents);

            const config = this._vscode.getConfiguration("autoproj")
            const supressNotice = config.get<boolean>("supressCmakeBuildTypeOverrideNotice");

            if (!supressNotice) {
                const message = [
                    "A vscode-autoproj-cmake-build-type.rb file was created in 'autoproj/overrides.d' ",
                    `on the '${ws.name}' workspace. You can revert this operation by simply removing `,
                    'that file. Rebuild for changes to take effect.'
                ]

                const ok: MessageItem = { title: "OK", isCloseAffordance: true };
                const supress: MessageItem = { title: "Don't show this again", isCloseAffordance: false };
                const item = await this._vscode.showInformationMessage(message.join(""), { modal: true }, ok, supress);

                if (item && !item.isCloseAffordance) {
                    config.update("supressCmakeBuildTypeOverrideNotice", true);
                }
            }
        } catch (error) {
            throw new Error(`Could not create overrides script: ${error.message}`);
        }
    }

    private async _updateRubyLspConfiguration(ws: autoproj.Workspace, extensionGemfile: string) {
        const shimsPath = path.join(ws.root, ShimsWriter.RELATIVE_SHIMS_PATH);
        this._vscode.getConfiguration("rubyLsp").update("rubyVersionManager.identifier", "custom");
        this._vscode.getConfiguration("rubyLsp").update("customRubyCommand", `PATH=${shimsPath}:$PATH`);
        this._vscode.getConfiguration("rubyLsp").update("bundleGemfile", extensionGemfile);
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

    public async showTestExecutablePicker(workspaceList: autoproj.Workspace[]): Promise<ITestExecuable | undefined> {
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

        let parentPackage: autoproj.IPackage | undefined;
        const programContext = await this._workspaces.getWorkspaceAndPackage(program[0]);
        const programPath = program[0].fsPath;

        if (programContext) {
            name = path.basename(programPath);
            for (const ws of workspaceList) {
                const wsInfo = await ws.info();
                for (const pkg of [...wsInfo.packages.values()]) {
                    if (pkg.builddir && isSubdirOf(programPath, pkg.builddir)) {
                        parentPackage = pkg;
                        name = `${pkg.name}/${name}`;
                        break;
                    }
                    if (pkg.srcdir && isSubdirOf(programPath, pkg.srcdir)) {
                        parentPackage = pkg;
                        name = `${pkg.name}/${name}`;
                        break;
                    }
                }
            }
            name += ` (${programContext.workspace.name})`;
        } else {
            throw new Error("The selected program is not in any open Autoproj workspace");
        }

        return {
            name: name,
            workspace: programContext.workspace,
            path: programPath,
            package: parentPackage
        }
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

        const testExecutable = await this.showTestExecutablePicker(workspaceList);
        if (!testExecutable) {
            return;
        }

        const args = await this._vscode.showInputBox({
            title: "Program arguments",
            placeHolder: "Optional command line arguments for the program"
        });

        if (args === undefined) {
            return;
        }

        const debuggerPath = path.join(testExecutable.workspace.root, ShimsWriter.RELATIVE_SHIMS_PATH, "gdb");
        const srcdir = Uri.file(testExecutable.package?.srcdir || testExecutable.workspace.root);
        const parentWs = this._vscode.getWorkspaceFolder(srcdir);
        const config = {
            "name": testExecutable.name,
            "type": "cppdbg",
            "request": "launch",
            "cwd": path.dirname(testExecutable.path),
            "program": testExecutable.path,
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
        const bundle = this._bundleManager.getWatcher(ws);
        if (await bundle.queueInstall() === 0) {
            await this._updateRubyLspConfiguration(ws, bundle.extensionGemfile);
        }
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
        this._vscode.registerAndSubscribeCommand("autoproj.updateWorkspaceEnvironment", () => {
            this.handleError(() => this.updateWorkspaceEnvironment())
        });
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
        this._vscode.registerAndSubscribeCommand("autoproj.enableCmakeDebuggingSymbols", () => {
            this.handleError(() => this.enableCmakeDebuggingSymbols());
        });
        this._vscode.registerAndSubscribeCommand("autoproj.addPackageToTestMate", () => {
            this.handleError(() => this.addPackageToTestMate());
        });
    }
}
