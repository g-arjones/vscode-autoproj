"use strict";
import { relative as pathRelative } from "path";
import * as vscode from "vscode";
import * as autoproj from "../autoproj";
import * as wrappers from "../wrappers";

function runAutoproj(ws, ...args) {
    return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: ws.root });
}

export class AutoprojProvider implements vscode.TaskProvider {
    public workspaces: autoproj.Workspaces;

    private watchTasks: Map<string, vscode.Task>;
    private buildTasks: Map<string, vscode.Task>;
    private nodepsBuildTasks: Map<string, vscode.Task>;
    private forceBuildTasks: Map<string, vscode.Task>;
    private updateTasks: Map<string, vscode.Task>;
    private checkoutTasks: Map<string, vscode.Task>;
    private osdepsTasks: Map<string, vscode.Task>;
    private updateConfigTasks: Map<string, vscode.Task>;
    private updateEnvironmentTasks: Map<string, vscode.Task>;
    private tasksPromise: Promise<vscode.Task[]>;
    private allTasks: vscode.Task[];
    private vscode: wrappers.VSCode;

    constructor(workspaces: autoproj.Workspaces, wrapper: wrappers.VSCode) {
        this.workspaces = workspaces;
        this.vscode = wrapper;
        this.reloadTasks();
    }

    public async buildTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.buildTasks, path);
    }

    public async watchTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.watchTasks, path);
    }

    public async forceBuildTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.forceBuildTasks, path);
    }

    public async nodepsBuildTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.nodepsBuildTasks, path);
    }

    public async updateTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.updateTasks, path);
    }

    public async checkoutTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.checkoutTasks, path);
    }

    public async osdepsTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.osdepsTasks, path);
    }

    public async updateConfigTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.updateConfigTasks, path);
    }

    public async updateEnvironmentTask(path: string): Promise<vscode.Task> {
        return this.getCache(this.updateEnvironmentTasks, path);
    }

    public reloadTasks(): void {
        this.allTasks = [];

        this.watchTasks = new Map<string, vscode.Task>();
        this.buildTasks = new Map<string, vscode.Task>();
        this.nodepsBuildTasks = new Map<string, vscode.Task>();
        this.forceBuildTasks = new Map<string, vscode.Task>();
        this.updateTasks = new Map<string, vscode.Task>();
        this.checkoutTasks = new Map<string, vscode.Task>();
        this.osdepsTasks = new Map<string, vscode.Task>();
        this.updateConfigTasks = new Map<string, vscode.Task>();
        this.updateEnvironmentTasks = new Map<string, vscode.Task>();

        this.tasksPromise = this.createTasksPromise();
    }

    public async provideTasks(token): Promise<vscode.Task[]> {
        await this.tasksPromise;
        return this.allTasks;
    }

    public resolveTask(task, token) {
        return null;
    }

    private async createTasksPromise(): Promise<vscode.Task[]> {
        this.workspaces.forEachWorkspace((ws) => {
            this.addTask(ws.root, this.createWatchTask(`${ws.name}: Watch`, ws), this.watchTasks);
            this.addTask(ws.root, this.createBuildTask(`${ws.name}: Build`, ws, "workspace"), this.buildTasks);
            this.addTask(ws.root, this.createCheckoutTask(`${ws.name}: Checkout`, ws, "workspace"), this.checkoutTasks);
            this.addTask(ws.root, this.createOsdepsTask(`${ws.name}: Install OS Dependencies`, ws), this.osdepsTasks);
            this.addTask(ws.root, this.createUpdateConfigTask(`${ws.name}: Update Configuration`, ws),
                this.updateConfigTasks);
            this.addTask(ws.root, this.createUpdateEnvironmentTask(`${ws.name}: Update Environment`, ws),
                this.updateEnvironmentTasks);
            this.addTask(ws.root, this.createUpdateTask(`${ws.name}: Update`, ws, "workspace"), this.updateTasks);
        });

        for (const folder of this.workspaces.folderToWorkspace.keys()) {
            const ws: autoproj.Workspace = this.workspaces.folderToWorkspace.get(folder)!;

            if (folder === ws.root) { continue; }
            if (this.workspaces.isConfig(folder)) { continue; }

            let relative: string;
            try {
                relative = (await ws.info()).findPackage(folder)!.name;
            } catch (error) {
                relative = pathRelative(ws.root, folder);
            }

            this.addTask(folder, this.createPackageBuildTask(`${ws.name}: Build ${relative}`, ws, folder),
                this.buildTasks);
            this.addTask(folder, this.createPackageCheckoutTask(`${ws.name}: Checkout ${relative}`, ws, folder),
                this.checkoutTasks);
            this.addTask(folder, this.createPackageForceBuildTask(`${ws.name}: Force Build ${relative} (nodeps)`,
                ws, folder), this.forceBuildTasks);
            this.addTask(folder, this.createPackageNodepsBuildTask(`${ws.name}: Build ${relative} (nodeps)`, ws,
                folder), this.nodepsBuildTasks);
            this.addTask(folder, this.createPackageUpdateTask(`${ws.name}: Update ${relative}`, ws, folder),
                this.updateTasks);
        }

        return this.allTasks;
    }

    private createTask(name, ws, type, defs = {}, args: string[] = [],
                       scope: vscode.TaskScope | vscode.WorkspaceFolder) {
        const definition = { type: `autoproj-${type}`, workspace: ws.root, ...defs };
        const exec = runAutoproj(ws, ...args);
        const task = new vscode.Task(definition, scope, name, "autoproj", exec, []);
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Silent };
        return task;
    }

    private createWorkspaceTask(name, ws, mode, defs = {}, args: string[] = []) {
        // vscode currently does not support workspace and global tasks
        // so we just use scope = vscode.workspaces.workspace[0] (this was the behavior of the,
        // now deprecated constructor)
        return this.createTask(name, ws, "workspace", { mode, ...defs }, args, this.vscode.workspaceFolders![0]);
    }

    private createOsdepsTask(name, ws, defs = {}, args: string[] = []) {
        return this.createWorkspaceTask(name, ws, "osdeps", defs, ["osdeps", "--color", ...args]);
    }

    private createWatchTask(name, ws, defs = {}, args: string[] = []) {
        const task = this.createWorkspaceTask(name, ws, "watch", defs, ["watch", "--show-events", ...args]);
        task.isBackground = true;
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
        };
        return task;
    }

    // vscode currently does not support workspace and global tasks
    // so we just use scope = vscode.workspaces.workspace[0] (this was the behavior of the,
    // now deprecated constructor)
    private createBuildTask(name, ws, type, defs = {}, args: string[] = [],
                            scope = this.vscode.workspaceFolders![0]) {
        const task = this.createTask(name, ws, type, { mode: "build", ...defs }, ["build", "--tool", ...args], scope);
        task.group = vscode.TaskGroup.Build;
        task.problemMatchers = [
            "$autoproj-cmake-configure-error",
            "$autoproj-cmake-configure-warning",
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
    private createUpdateTask(name, ws, type, defs = {}, args: string[] = [],
                             scope = this.vscode.workspaceFolders![0]) {
        const task = this.createTask(name, ws, type,
            { mode: "update",  ...defs }, ["update", "--progress=f", "-k", "--color", ...args], scope);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private createUpdateConfigTask(name, ws, defs = {}, args: string[] = []) {
        const task = this.createWorkspaceTask(name, ws, "update-config",
            defs, [ "update", "--progress=f", "-k", "--color", "--config", ...args]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private createUpdateEnvironmentTask(name, ws, defs = {}, args: string[] = []) {
        const task = this.createWorkspaceTask(name, ws, "update-environment",
            defs, [ "envsh", "--progress=f", "--color", ...args]);
        task.problemMatchers = ["$autoproj"];
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Silent,
        };

        return task;
    }

    private createCheckoutTask(name, ws, type, defs = {}, args: string[] = []) {
        // vscode currently does not support workspace and global tasks
        // so we just use scope = vscode.workspaces.workspace[0] (this was the behavior of the,
        // now deprecated constructor)
        const wsFolder = this.vscode.workspaceFolders![0];
        const task = this.createUpdateTask(name, ws, type,
            { mode: "checkout", ...defs }, ["--checkout-only", ...args], wsFolder);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private createPackageBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        const wsFolder = this.vscode.getWorkspaceFolder(folder);
        return this.createBuildTask(name, ws, "package", { path: folder, ...defs }, [...args, folder], wsFolder);
    }

    private createPackageNodepsBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        return this.createPackageBuildTask(name, ws, folder, { mode: "build-no-deps", ...defs }, ["--deps=f", ...args]);
    }

    private createPackageForceBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        return this.createPackageBuildTask(name, ws, folder,
            { mode: "force-build", ...defs }, ["--force", "--deps=f", "--no-confirm", ...args]);
    }

    private createPackageUpdateTask(name, ws, folder, defs = {}, args: string[] = []) {
        const wsFolder = this.vscode.getWorkspaceFolder(folder);
        const task = this.createUpdateTask(name, ws, "package", { path: folder, ...defs }, [...args, folder], wsFolder);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private createPackageCheckoutTask(name, ws, folder, defs = {}, args: string[] = []) {
        const task = this.createPackageUpdateTask(name, ws, folder,
            { mode: "checkout", ...defs }, ["--checkout-only", ...args]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private async getCache(cache, key): Promise<vscode.Task> {
        await this.tasksPromise;
        const value = cache.get(key);
        if (value) {
            return value;
        }
        throw new Error("no entry for " + key);
    }

    private addTask(root: string, task: vscode.Task, cache: Map<string, vscode.Task>) {
        this.allTasks.push(task);
        cache.set(root, task);
    }
}
