"use strict";
import { relative as pathRelative } from "path";
import * as vscode from "vscode";
import * as autoproj from "./autoproj";

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
    private allTasks: vscode.Task[];

    constructor(workspaces: autoproj.Workspaces) {
        this.workspaces = workspaces;
        this.reloadTasks();
    }

    public buildTask(path: string): vscode.Task {
        return this.getCache(this.buildTasks, path);
    }

    public watchTask(path: string): vscode.Task {
        return this.getCache(this.watchTasks, path);
    }

    public forceBuildTask(path: string): vscode.Task {
        return this.getCache(this.forceBuildTasks, path);
    }

    public nodepsBuildTask(path: string): vscode.Task {
        return this.getCache(this.nodepsBuildTasks, path);
    }

    public updateTask(path: string): vscode.Task {
        return this.getCache(this.updateTasks, path);
    }

    public checkoutTask(path: string): vscode.Task {
        return this.getCache(this.checkoutTasks, path);
    }

    public osdepsTask(path: string): vscode.Task {
        return this.getCache(this.osdepsTasks, path);
    }

    public updateConfigTask(path: string): vscode.Task {
        return this.getCache(this.updateConfigTasks, path);
    }

    public reloadTasks() {
        this.allTasks = [];

        this.watchTasks = new Map<string, vscode.Task>();
        this.buildTasks = new Map<string, vscode.Task>();
        this.nodepsBuildTasks = new Map<string, vscode.Task>();
        this.forceBuildTasks = new Map<string, vscode.Task>();
        this.updateTasks = new Map<string, vscode.Task>();
        this.checkoutTasks = new Map<string, vscode.Task>();
        this.osdepsTasks = new Map<string, vscode.Task>();
        this.updateConfigTasks = new Map<string, vscode.Task>();

        this.workspaces.forEachWorkspace((ws) => {
            this.addTask(ws.root, this.createWatchTask(`${ws.name}: Watch`, ws),
                this.watchTasks);
            this.addTask(ws.root, this.createBuildTask(`${ws.name}: Build`, ws, "workspace"),
                this.buildTasks);
            this.addTask(ws.root, this.createCheckoutTask(`${ws.name}: Checkout`, ws, "workspace"),
                this.checkoutTasks);
            this.addTask(ws.root, this.createOsdepsTask(`${ws.name}: Install OS Dependencies`, ws),
                this.osdepsTasks);
            this.addTask(ws.root, this.createUpdateConfigTask(`${ws.name}: Update Configuration`, ws),
                this.updateConfigTasks);
            this.addTask(ws.root, this.createUpdateTask(`${ws.name}: Update`, ws, "workspace"),
                this.updateTasks);
        });
        this.workspaces.forEachFolder((ws, folder) => {
            if (folder === ws.root) { return; }
            if (this.workspaces.isConfig(folder)) { return; }
            const relative = pathRelative(ws.root, folder);
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
        });
    }

    public provideTasks(token) {
        return this.allTasks;
    }

    public resolveTask(task, token) {
        return null;
    }

    private createTask(name, ws, type, defs = {}, args: string[] = []) {
        const definition = { type: `autoproj-${type}`, workspace: ws.root, ...defs };
        const exec = runAutoproj(ws, ...args);
        return new vscode.Task(definition, name, "autoproj", exec, []);
    }

    private createWorkspaceTask(name, ws, mode, defs = {}, args: string[] = []) {
        return this.createTask(name, ws, "workspace",
            { mode, ...defs }, args);
    }

    private createOsdepsTask(name, ws, defs = {}, args: string[] = []) {
        return this.createWorkspaceTask(name, ws, "osdeps",
            defs, ["osdeps", "--color", ...args]);
    }

    private createWatchTask(name, ws, defs = {}, args: string[] = []) {
        return this.createWorkspaceTask(name, ws, "watch",
            defs, ["watch", "--show-events", ...args]);
    }

    private createBuildTask(name, ws, type, defs = {}, args: string[] = []) {
        const task = this.createTask(name, ws, type,
            { mode: "build", ...defs },
            ["build", "--tool", ...args]);
        task.group = vscode.TaskGroup.Build;
        task.problemMatchers = [
            "$autoproj-cmake-configure-error",
            "$autoproj-cmake-configure-warning",
            "$autoproj-gcc-compile-error",
            "$autoproj-gcc-compile-warning",
            "$autoproj-orogen-error",
        ];
        return task;
    }

    private createUpdateTask(name, ws, type, defs = {}, args: string[] = []) {
        const task = this.createTask(name, ws, type,
            { mode: "update",  ...defs },
            ["update", "--progress=f", "-k", "--color", ...args]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private createUpdateConfigTask(name, ws, defs = {}, args: string[] = []) {
        const task = this.createWorkspaceTask(name, ws, "update-config",
            defs, [ "update", "--progress=f", "-k", "--color", "--config", ...args]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private createCheckoutTask(name, ws, type, defs = {}, args: string[] = []) {
        const task = this.createUpdateTask(name, ws, type,
            { mode: "checkout", ...defs },
            ["--checkout-only", ...args]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private createPackageBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        return this.createBuildTask(name, ws, "package",
            { path: folder, ...defs },
            [...args, folder]);
    }

    private createPackageNodepsBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        return this.createPackageBuildTask(name, ws, folder,
            { mode: "build-no-deps", ...defs },
            ["--deps=f", ...args]);
    }

    private createPackageForceBuildTask(name, ws, folder, defs = {}, args: string[] = []) {
        return this.createPackageBuildTask(name, ws, folder,
            { mode: "force-build", ...defs },
            ["--force", "--deps=f", "--no-confirm", ...args]);
    }

    private createPackageUpdateTask(name, ws, folder, defs = {}, args: string[] = []) {
        const task = this.createUpdateTask(name, ws, "package",
            { path: folder, ...defs },
            [...args, folder]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private createPackageCheckoutTask(name, ws, folder, defs = {}, args: string[] = []) {
        const task = this.createPackageUpdateTask(name, ws, folder,
            { mode: "checkout", ...defs },
            ["--checkout-only", ...args]);
        task.problemMatchers = ["$autoproj"];
        return task;
    }

    private getCache(cache, key) {
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
