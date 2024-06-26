import * as vscode from "vscode";

export enum TaskType {
    Workspace = "autoproj-workspace",
    Package = "autoproj-package",
}

export enum WorkspaceTaskMode {
    Osdeps = "osdeps",
    Build = "build",
    UpdateConfig = "update-config",
    Update = "update",
    Checkout = "checkout",
}

export enum PackageTaskMode {
    Update = "update",
    Checkout = "checkout",
    Build = "build",
    BuildNoDeps = "build-no-deps",
    ForceBuild = "force-build",
    Rebuild = "rebuild",
}

export interface ITaskDefinition extends vscode.TaskDefinition {
    workspace: string;
}

export interface IWorkspaceTaskDefinition extends ITaskDefinition {
    type: TaskType.Workspace;
    mode: WorkspaceTaskMode;
}

export interface IPackageTaskDefinition extends ITaskDefinition {
    type: TaskType.Package;
    mode: PackageTaskMode;
    path: string;
}

export const WORKSPACE_TASK_FILTER: vscode.TaskFilter = { type: TaskType.Workspace };
export const PACKAGE_TASK_FILTER: vscode.TaskFilter = { type: TaskType.Package };

export function definitionsEqual(first: ITaskDefinition, second: ITaskDefinition) {
    if (first.type === second.type && first.workspace === second.workspace &&
        first.mode === second.mode && first.path === second.path) { return true; }

    return false;
}
