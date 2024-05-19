"use strict";

import * as FS from "fs";
import * as YAML from "js-yaml";
import * as os from "os";
import * as Path from "path";
import * as Autoproj from "../src/autoproj";
import * as vscode from "vscode";
import * as util from "../src/util";
import * as progress from "../src/progress";
import { workspaceBuilderRegistry } from "./hooks";
import { GlobalMock, IGlobalMock, IMock, Mock } from "typemoq";

export class WorkspaceBuilder {
    public readonly packages: Array<Autoproj.IPackage>;
    public readonly packageSets: Array<Autoproj.IPackageSet>;
    public workspace: Autoproj.Workspace;
    public root: string;
    public fs: TempFS;

    constructor(
        public builddir: { dir: string[], relative: boolean } = { dir: ["build"], relative: false },
        public srcdir: string[] = ["src"]
    ) {
        this.init();
        this.fs.mkdir("autoproj");
        this.fs.mkdir(".autoproj");
        this.packages = [];
        this.packageSets = [];
        this.writeManifest();
        this.writeEnvYml();
    }

    public init() {
        this.fs = new TempFS();
        this.root = this.fs.init();
        workspaceBuilderRegistry.push(this);
        this.workspace = new Autoproj.Workspace(this.root, false);
    }

    public clear() {
        this.root = null as any;
        this.workspace = null as any;
        workspaceBuilderRegistry.splice(0, workspaceBuilderRegistry.length,
            ...workspaceBuilderRegistry.filter((item) => item !== this))
        return this.fs.clear();
    }

    public packageSrcDir(name: string, ...move: string[]): string[] {
        return [...this.srcdir, ...move, ...name.split("/")];
    }
    public packageBuildDir(name: string): string[] {
        if (this.builddir.relative) {
            return [...this.packageSrcDir(name), ...this.builddir.dir];
        } else {
            return [...this.builddir.dir, ...name.split("/")];
        }
    }
    public packagePrefix(name: string): string[] {
        return ["install", ...name.split("/")];
    }
    public addPackage(name: string, ...move: string[]) {
        const pkg: Autoproj.IPackage = {
            builddir: Path.join(this.root, ...this.packageBuildDir(name)),
            dependencies: [],
            logdir: Path.join(this.root, ...this.packagePrefix(name), "log"),
            name: name,
            prefix: Path.join(this.root, ...this.packagePrefix(name)),
            srcdir: Path.join(this.root, ...this.packageSrcDir(name, ...move)),
            type: "Autobuild::CMake",
            vcs: {
                repository_id: `myserver:/${name}.git`,
                type: "git",
                url: `git@myserver.com:/${name}.git`,
            },
        };
        this.fs.mkdir(...this.packageSrcDir(name, ...move));
        this.fs.mkdir(...this.packageBuildDir(name));

        this.packages.push(pkg);
        this.writeManifest();

        return pkg;
    }
    public addPackageSet(name: string) {
        const pkgSet: Autoproj.IPackageSet = {
            name: name,
            vcs: {
                repository_id: `myserver:/${name}.git`,
                type: "git",
                url: `git@myserver.com:/${name}.git`,
            },
            raw_local_dir: this.fs.fullPath(".autoproj", "remotes", `git_git_myserver_com_${name}_git`),
            user_local_dir: this.fs.fullPath("autoproj", "remotes", name),
            package_set: name
        };
        this.fs.mkdir(".autoproj", "remotes", `git_git_myserver_com_${name}_git`);
        this.fs.mkdir("autoproj", "remotes", name);

        this.packageSets.push(pkgSet);
        this.writeManifest();

        return pkgSet;
    }
    public writeManifest() {
        const info = [...this.packages, ...this.packageSets];
        this.fs.mkfile(YAML.dump(info), ".autoproj", "installation-manifest");
    }
    public writeEnvYml() {
        const env = {
            set: {
                BUNDLE_GEMFILE: [
                    Path.join(this.root, "install", "gems", "Gemfile")
                ]
            }
        };

        this.fs.mkfile(YAML.dump(env), ".autoproj", "env.yml");
    }
}

export class TempFS {
    public root: string;
    public createdFS: string[][];

    constructor() {
        this.createdFS = [];
    }

    public init(): string {
        if (this.root) {
            throw new Error("Helpers already initialized");
        }

        this.root = FS.mkdtempSync(Path.join(os.tmpdir(), "vscode-autoproj"));
        return this.root;
    }

    public fullPath(...path: string[]): string {
        return Path.join(this.root, ...path);
    }
    public mkdir(...path): string {
        let joinedPath = this.root;
        path.forEach((element) => {
            joinedPath = Path.join(joinedPath, element);
            if (!FS.existsSync(joinedPath)) {
                FS.mkdirSync(joinedPath);
                this.createdFS.push([joinedPath, "dir"]);
            }
        });
        return joinedPath;
    }
    public rmdir(...path) {
        const joinedPath = this.fullPath(...path);
        FS.rmdirSync(joinedPath);
    }
    public mkfile(data: string, ...path): string {
        const joinedPath = this.fullPath(...path);
        FS.writeFileSync(joinedPath, data);
        this.createdFS.push([joinedPath, "file"]);
        return joinedPath;
    }
    public registerDir(...path) {
        const joinedPath = this.fullPath(...path);
        this.createdFS.push([joinedPath, "dir"]);
    }
    public registerFile(...path) {
        const joinedPath = this.fullPath(...path);
        this.createdFS.push([joinedPath, "file"]);
    }
    public createInstallationManifest(data: any, ...workspacePath): string {
        let joinedPath = this.fullPath(...workspacePath);
        joinedPath = Autoproj.installationManifestPath(joinedPath);
        this.mkdir(...workspacePath, ".autoproj");
        FS.writeFileSync(joinedPath, YAML.dump(data));
        this.createdFS.push([joinedPath, "file"]);
        return joinedPath;
    }
    public clear() {
        this.createdFS.reverse().forEach((entry) => {
            try {
                if (entry[1] === "file") {
                    FS.unlinkSync(entry[0]);
                } else if (entry[1] === "dir") {
                    FS.rmdirSync(entry[0]);
                }
            } catch (error) {
                if (!(error.code === "ENOENT")) {
                    throw error;
                }
            }
        });
        this.createdFS = [];
        FS.rmdirSync(this.root);
        this.root = null as any;
    }
}

export namespace host {
    export async function closeAllTabs() {
        const tabs: vscode.Tab[] = vscode.window.tabGroups.all.map(tg => tg.tabs).flat();
        const promises = tabs.map((tab) => vscode.window.tabGroups.close(tab));
        await Promise.all(promises);
    }

    export async function addFolders(...folderPaths: string[]) {
        const foldersChangedEvent = new Promise<vscode.WorkspaceFoldersChangeEvent>((resolve) => {
            const folders = vscode.workspace.workspaceFolders || [];
            vscode.workspace.onDidChangeWorkspaceFolders((event) => resolve(event));
            vscode.workspace.updateWorkspaceFolders(folders.length, 0,
                ...folderPaths.map((p) => { return { uri: vscode.Uri.file(p) }})
            );
        });
        await foldersChangedEvent;
    }

    export async function resetFolders() {
        if (vscode.workspace.workspaceFolders!.length < 2) {
            return;
        }
        const foldersChangedEvent = new Promise<vscode.WorkspaceFoldersChangeEvent>((resolve) => {
            const folders = vscode.workspace.workspaceFolders || [];
            vscode.workspace.onDidChangeWorkspaceFolders((event) => resolve(event));
            vscode.workspace.updateWorkspaceFolders(1, folders.length - 1);
        });
        return await foldersChangedEvent;
    }
}

export class Mocks {
    public asyncSpawn: IGlobalMock<typeof util.asyncSpawn>;
    public createProgressView: IGlobalMock<typeof progress.createProgressView>;
    public getConfiguration: IGlobalMock<typeof vscode.workspace.getConfiguration>;
    public showErrorMessage: IGlobalMock<typeof vscode.window.showErrorMessage>;
    public showQuickPick: IGlobalMock<typeof vscode.window.showQuickPick>;
    public showInputBox: IGlobalMock<typeof vscode.window.showInputBox>;
    public showOpenDialog: IGlobalMock<typeof vscode.window.showOpenDialog>;
    public showInformationMessage: IGlobalMock<typeof vscode.window.showInformationMessage>;
    public logOutputChannel: IMock<vscode.LogOutputChannel>;
    public workspaceConfiguration: IMock<vscode.WorkspaceConfiguration>;

    constructor() {
        this.getConfiguration = GlobalMock.ofInstance(
            vscode.workspace.getConfiguration, "getConfiguration", vscode.workspace);

        this.showErrorMessage = GlobalMock.ofInstance(
            vscode.window.showErrorMessage, "showErrorMessage", vscode.window);

        this.showQuickPick = GlobalMock.ofInstance(
            vscode.window.showQuickPick, "showQuickPick", vscode.window);

        this.showInputBox = GlobalMock.ofInstance(
            vscode.window.showInputBox, "showInputBox", vscode.window);

        this.showOpenDialog = GlobalMock.ofInstance(
            vscode.window.showOpenDialog, "showOpenDialog", vscode.window);

        this.showInformationMessage = GlobalMock.ofInstance(
            vscode.window.showInformationMessage, "showInformationMessage", vscode.window);

        this.asyncSpawn = GlobalMock.ofInstance(util.asyncSpawn, "asyncSpawn", util);
        this.createProgressView = GlobalMock.ofInstance(progress.createProgressView, "createProgressView", progress);
        this.workspaceConfiguration = Mock.ofType<vscode.WorkspaceConfiguration>();
        this.logOutputChannel = Mock.ofType<vscode.LogOutputChannel>();
    }
}
