"use strict";
import { relative as pathRelative } from "path";
import * as vscode from "vscode";
import * as autoproj from "../autoproj";
import * as wrappers from "../wrappers";
import { PackageTaskMode, TaskType, WorkspaceTaskMode } from "./definitions";

function runAutoproj(ws, ...args) {
    return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: ws.root });
}

/*
 TODO: Update to allow adding folders with multiple packages.
       In this case, tasks should be generated for packages
       contained in the given folder.
*/
export class AutoprojProvider implements vscode.TaskProvider {
    public workspaces: autoproj.Workspaces;

    private _watchTasks: Map<string, vscode.Task>;
    private _buildTasks: Map<string, vscode.Task>;
    private _nodepsBuildTasks: Map<string, vscode.Task>;
    private _rebuildTasks: Map<string, vscode.Task>;
    private _forceBuildTasks: Map<string, vscode.Task>;
    private _updateTasks: Map<string, vscode.Task>;
    private _checkoutTasks: Map<string, vscode.Task>;
    private _osdepsTasks: Map<string, vscode.Task>;
    private _updateConfigTasks: Map<string, vscode.Task>;
    private _updateEnvironmentTasks: Map<string, vscode.Task>;
    private _tasksPromise: Promise<vscode.Task[]>;
    private _allTasks: vscode.Task[];
    private _vscode: wrappers.VSCode;

    constructor(workspaces: autoproj.Workspaces, wrapper: wrappers.VSCode) {
        this.workspaces = workspaces;
        this._vscode = wrapper;
        this.reloadTasks();
    }

    public async buildTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._buildTasks, path);
    }

    public async watchTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._watchTasks, path);
    }

    public async forceBuildTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._forceBuildTasks, path);
    }

    public async rebuildTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._rebuildTasks, path);
    }

    public async nodepsBuildTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._nodepsBuildTasks, path);
    }

    public async updateTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._updateTasks, path);
    }

    public async checkoutTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._checkoutTasks, path);
    }

    public async osdepsTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._osdepsTasks, path);
    }

    public async updateConfigTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._updateConfigTasks, path);
    }

    public async updateEnvironmentTask(path: string): Promise<vscode.Task> {
        return this._getCache(this._updateEnvironmentTasks, path);
    }

    public reloadTasks(): void {
        this._allTasks = [];

        this._watchTasks = new Map<string, vscode.Task>();
        this._buildTasks = new Map<string, vscode.Task>();
        this._nodepsBuildTasks = new Map<string, vscode.Task>();
        this._forceBuildTasks = new Map<string, vscode.Task>();
        this._rebuildTasks = new Map<string, vscode.Task>();
        this._updateTasks = new Map<string, vscode.Task>();
        this._checkoutTasks = new Map<string, vscode.Task>();
        this._osdepsTasks = new Map<string, vscode.Task>();
        this._updateConfigTasks = new Map<string, vscode.Task>();
        this._updateEnvironmentTasks = new Map<string, vscode.Task>();

        this._tasksPromise = this._createTasksPromise();
    }

    public async provideTasks(token): Promise<vscode.Task[]> {
        await this._tasksPromise;
        return this._allTasks;
    }

    public resolveTask(task, token) {
        return null;
    }

    public isTaskEnabled(type: TaskType, mode: PackageTaskMode | WorkspaceTaskMode): boolean {
        const optionalTasks = this._vscode.getConfiguration("autoproj.optionalTasks");
        if (type === TaskType.Package) {
            const packageTasks = optionalTasks.get<{ [name: string]: boolean }>("package")!;
            switch (mode as PackageTaskMode) {
            case PackageTaskMode.Rebuild:
                return packageTasks.rebuild;
            case PackageTaskMode.BuildNoDeps:
                return packageTasks.buildNoDeps;
            case PackageTaskMode.Checkout:
                return packageTasks.checkout;
            case PackageTaskMode.ForceBuild:
                return packageTasks.forceBuild;
            case PackageTaskMode.Update:
                return packageTasks.update;
            }
        } else if (type === TaskType.Workspace) {
            const workspaceTasks = optionalTasks.get<{ [name: string]: boolean }>("workspace")!;
            switch (mode as WorkspaceTaskMode) {
            case WorkspaceTaskMode.Build:
                return workspaceTasks.build;
            case WorkspaceTaskMode.Checkout:
                return workspaceTasks.checkout;
            case WorkspaceTaskMode.Update:
                return workspaceTasks.update;
            case WorkspaceTaskMode.UpdateConfig:
                return workspaceTasks.updateConfig;
            case WorkspaceTaskMode.Osdeps:
                return workspaceTasks.installOsdeps;
            }
        }
        throw new Error("Invalid task type");
    }

    private async _createTasksPromise(): Promise<vscode.Task[]> {
        this.workspaces.forEachWorkspace((ws) => {
            const build = this.isTaskEnabled(TaskType.Workspace, WorkspaceTaskMode.Build);
            const update = this.isTaskEnabled(TaskType.Workspace, WorkspaceTaskMode.Update);
            const checkout = this.isTaskEnabled(TaskType.Workspace, WorkspaceTaskMode.Checkout);
            const updateConfig = this.isTaskEnabled(TaskType.Workspace, WorkspaceTaskMode.UpdateConfig);
            const osdeps = this.isTaskEnabled(TaskType.Workspace, WorkspaceTaskMode.Osdeps);

            this._addTask(ws.root, this._createWatchTask(`${ws.name}: Watch`, ws), this._watchTasks);
            this._addTask(ws.root, this._createUpdateEnvironmentTask(`${ws.name}: Update Environment`, ws),
                this._updateEnvironmentTasks);

            if (build) {
                this._addTask(ws.root, this._createBuildTask(`${ws.name}: Build all packages`,
                    ws, "workspace"), this._buildTasks);
            }

            if (checkout) {
                this._addTask(ws.root, this._createCheckoutTask(`${ws.name}: Checkout all packages`,
                    ws, "workspace"), this._checkoutTasks);
            }

            if (osdeps) {
                this._addTask(ws.root, this._createOsdepsTask(`${ws.name}: Install OS Dependencies`, ws),
                    this._osdepsTasks);
            }

            if (updateConfig) {
                this._addTask(ws.root, this._createUpdateConfigTask(`${ws.name}: Update Configuration`, ws),
                    this._updateConfigTasks);
            }

            if (update) {
                this._addTask(ws.root, this._createUpdateTask(`${ws.name}: Update all packages`, ws, "workspace"),
                    this._updateTasks);
            }
        });

        for (const [folder, ws] of this.workspaces.folderToWorkspace) {
            if (folder === ws.root) { continue; }
            if (this.workspaces.isConfig(folder)) { continue; }

            let relative: string;
            try {
                relative = (await ws.info()).findPackage(folder)!.name;
            } catch (error) {
                relative = pathRelative(ws.root, folder);
            }

            const rebuild = this.isTaskEnabled(TaskType.Package, PackageTaskMode.Rebuild);
            const forceBuild = this.isTaskEnabled(TaskType.Package, PackageTaskMode.ForceBuild);
            const buildNoDeps = this.isTaskEnabled(TaskType.Package, PackageTaskMode.BuildNoDeps);
            const checkout = this.isTaskEnabled(TaskType.Package, PackageTaskMode.Checkout);
            const update = this.isTaskEnabled(TaskType.Package, PackageTaskMode.Update);

            this._addTask(folder, this._createPackageBuildTask(`${ws.name}: Build ${relative}`, ws, folder),
                this._buildTasks);

            if (checkout) {
                this._addTask(folder, this._createPackageCheckoutTask(`${ws.name}: Checkout ${relative}`, ws, folder),
                    this._checkoutTasks);
            }

            if (rebuild) {
                this._addTask(folder, this._createPackageRebuildTask(`${ws.name}: Rebuild ${relative} (nodeps)`,
                    ws, folder), this._rebuildTasks);
            }

            if (forceBuild) {
                this._addTask(folder, this._createPackageForceBuildTask(`${ws.name}: Force Build ${relative} (nodeps)`,
                    ws, folder), this._forceBuildTasks);
            }

            if (buildNoDeps) {
                this._addTask(folder, this._createPackageNodepsBuildTask(`${ws.name}: Build ${relative} (nodeps)`, ws,
                    folder), this._nodepsBuildTasks);
            }

            if (update) {
                this._addTask(folder, this._createPackageUpdateTask(`${ws.name}: Update ${relative}`, ws, folder),
                    this._updateTasks);
            }
        }
        return this._allTasks;
    }

    private _createTask(name, ws, type, defs = {}, args: string[] = [],
                        scope: vscode.TaskScope | vscode.WorkspaceFolder) {
        const definition = { type: `autoproj-${type}`, workspace: ws.root, ...defs };
        const exec = runAutoproj(ws, ...args);
        const task = new vscode.Task(definition, scope, name, "autoproj", exec, []);
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Silent };
        return task;
    }

    private _createWorkspaceTask(name, ws, mode, defs = {}, args: string[] = []) {
        // vscode currently does not support workspace and global tasks
        // so we just use scope = vscode.workspaces.workspace[0] (this was the behavior of the,
        // now deprecated constructor)
        return this._createTask(name, ws, "workspace", { mode, ...defs }, args, this._vscode.workspaceFolders![0]);
    }

    private _createOsdepsTask(name, ws, defs = {}, args: string[] = []) {
        return this._createWorkspaceTask(name, ws, "osdeps", defs, ["osdeps", "--color", ...args]);
    }

    private _createWatchTask(name, ws, defs = {}, args: string[] = []) {
        const task = this._createWorkspaceTask(name, ws, "watch", defs, ["watch", "--show-events", ...args]);
        task.isBackground = true;
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
        };
        return task;
    }

    // vscode currently does not support workspace and global tasks
    // so we just use scope = vscode.workspaces.workspace[0] (this was the behavior of the,
    // now deprecated constructor)
    private _createBuildTask(name, ws, type, defs = {}, args: string[] = [],
                             scope = this._vscode.workspaceFolders![0]) {
        const task = this._createTask(name, ws, type, { mode: "build", ...defs }, ["build", "--tool", ...args], scope);
        task.group = vscode.TaskGroup.Build;
        task.problemMatchers = [
            "$autoproj-cmake-configure-error-relative",
            "$autoproj-cmake-configure-warning-relative",
            "$autoproj-cmake-configure-error-absolute",
            "$autoproj-cmake-configure-warning-absolute",
            "$autoproj-gcc-compile-error",
            "$autoproj-gcc-compile-warning",
            "$autoproj-gcc-compile-template-expansion",
            "$autoproj-orogen-error",
        ];
        return task;
    }

    // vscode currently does not support workspace and global tasks
    // so we just use scope = vscode.workspaces.workspace[0] (this was the behavior of the,
    // now deprecated constructor)
    private _createUpdateTask(name, ws, type, defs = {}, args: string[] = [],
                              scope = this._vscode.workspaceFolders![0]) {
        const task = this._createTask(name, ws, type,
            { mode: "update", ...defs }, ["update", "--progress=f", "-k", "--color", ...args], scope);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private _createUpdateConfigTask(name, ws, defs = {}, args: string[] = []) {
        const task = this._createWorkspaceTask(name, ws, "update-config",
            defs, ["update", "--progress=f", "-k", "--color", "--config", ...args]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private _createUpdateEnvironmentTask(name, ws, defs = {}, args: string[] = []) {
        const task = this._createWorkspaceTask(name, ws, "update-environment",
            defs, ["envsh", "--progress=f", "--color", ...args]);
        task.problemMatchers = ["$autoproj"];
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Silent,
        };

        return task;
    }

    private _createCheckoutTask(name, ws, type, defs = {}, args: string[] = []) {
        // vscode currently does not support workspace and global tasks
        // so we just use scope = vscode.workspaces.workspace[0] (this was the behavior of the,
        // now deprecated constructor)
        const wsFolder = this._vscode.workspaceFolders![0];
        const task = this._createUpdateTask(name, ws, type,
            { mode: "checkout", ...defs }, ["--checkout-only", ...args], wsFolder);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private _createPackageBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        const wsFolder = this._vscode.getWorkspaceFolder(folder);
        return this._createBuildTask(name, ws, "package", { path: folder, ...defs }, [...args, folder], wsFolder);
    }

    private _createPackageNodepsBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        return this._createPackageBuildTask(name, ws, folder,
            { mode: "build-no-deps", ...defs }, ["--deps=f", ...args]);
    }

    private _createPackageForceBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        return this._createPackageBuildTask(name, ws, folder,
            { mode: "force-build", ...defs }, ["--force", "--deps=f", "--no-confirm", ...args]);
    }

    private _createPackageRebuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        return this._createPackageBuildTask(name, ws, folder,
            { mode: "rebuild", ...defs }, ["--rebuild", "--deps=f", "--no-confirm", ...args]);
    }

    private _createPackageUpdateTask(name, ws, folder, defs = {}, args: string[] = []) {
        const wsFolder = this._vscode.getWorkspaceFolder(folder);
        const task = this._createUpdateTask(name, ws, "package",
            { path: folder, ...defs }, [...args, folder], wsFolder);

        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private _createPackageCheckoutTask(name, ws, folder, defs = {}, args: string[] = []) {
        const task = this._createPackageUpdateTask(name, ws, folder,
            { mode: "checkout", ...defs }, ["--checkout-only", ...args]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private async _getCache(cache, key): Promise<vscode.Task> {
        await this._tasksPromise;
        const value = cache.get(key);
        if (value) {
            return value;
        }
        throw new Error("no entry for " + key);
    }

    private _addTask(root: string, task: vscode.Task, cache: Map<string, vscode.Task>) {
        this._allTasks.push(task);
        cache.set(root, task);
    }
}

export class AutoprojWorkspaceTaskProvider implements vscode.TaskProvider {
    private _provider: AutoprojProvider;
    constructor(provider: AutoprojProvider) {
        this._provider = provider;
    }
    async provideTasks(token: vscode.CancellationToken) {
        let tasks = await this._provider.provideTasks(token);
        return tasks.filter((task: vscode.Task) => task.definition.type == "autoproj-workspace");
    }
    resolveTask(task: vscode.Task, token: vscode.CancellationToken) {
        return null;
    }
}

export class AutoprojPackageTaskProvider implements vscode.TaskProvider {
    private _provider: AutoprojProvider;
    constructor(provider: AutoprojProvider) {
        this._provider = provider;
    }
    async provideTasks(token: vscode.CancellationToken) {
        let tasks = await this._provider.provideTasks(token);
        return tasks.filter((task: vscode.Task) => task.definition.type == "autoproj-package");
    }
    resolveTask(task: vscode.Task, token: vscode.CancellationToken) {
        return null;
    }
}