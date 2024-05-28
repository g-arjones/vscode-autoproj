import * as path from "path";
import * as vscode from "vscode";
import * as autoproj from "../autoproj";
import * as progress from "../progress";
import {
    definitionsEqual,
    IPackageTaskDefinition,
    ITaskDefinition,
    PackageTaskMode,
    TaskType,
    WorkspaceTaskMode
} from "./definitions";

export class Handler implements vscode.Disposable {
    private _definitionToView: Map<ITaskDefinition, progress.ProgressView>;

    constructor(private _workspaces: autoproj.Workspaces) {
        this._definitionToView = new Map();
    }

    public dispose(): void {
        this._definitionToView.forEach((view) => view.close);
        this._definitionToView.clear();
    }

    public async onDidStartTaskProcess(event: vscode.TaskProcessStartEvent) {
        const task = event.execution.task;
        if (task.definition.type === TaskType.Package) {
            let buildMode = "";
            const pkgName = await this._getPackageName(task.definition as IPackageTaskDefinition);
            switch (task.definition.mode) {
            case PackageTaskMode.ForceBuild:
            case PackageTaskMode.BuildNoDeps:
            case PackageTaskMode.Rebuild:
            case PackageTaskMode.Build:
                if (task.definition.mode === PackageTaskMode.Rebuild) { buildMode = " (rebuild)"; }
                if (task.definition.mode === PackageTaskMode.ForceBuild) { buildMode = " (force)"; }
                if (task.definition.mode === PackageTaskMode.BuildNoDeps) { buildMode = " (no dependencies)"; }
                this._createAndShowView(`Building ${pkgName}${buildMode}...`, event.execution.task.definition);
                break;
            case PackageTaskMode.Checkout:
                this._createAndShowView(`Checking out ${pkgName}...`, event.execution.task.definition);
                break;
            case PackageTaskMode.Update:
                this._createAndShowView(`Updating ${pkgName} (and its dependencies)...`,
                event.execution.task.definition);
                break;
            }
        } else if (task.definition.type === TaskType.Workspace) {
            const ws = this._workspaces.workspaces.get(task.definition.workspace)!.name;
            switch (task.definition.mode) {
            case WorkspaceTaskMode.Build:
                this._createAndShowView(`${ws}: Building all packages...`, event.execution.task.definition);
                break;
            case WorkspaceTaskMode.Checkout:
                this._createAndShowView(`${ws}: Checking out all packages...`, event.execution.task.definition);
                break;
            case WorkspaceTaskMode.Osdeps:
                this._createAndShowView(`${ws}: Installing OS dependencies...`, event.execution.task.definition);
                break;
            case WorkspaceTaskMode.Update:
                this._createAndShowView(`${ws}: Updating all packages...`, event.execution.task.definition);
                break;
            case WorkspaceTaskMode.UpdateConfig:
                this._createAndShowView(`${ws}: Updating build configuration...`, event.execution.task.definition);
                break;
            }
        }
    }

    public onDidEndTaskProcess(event: vscode.TaskProcessEndEvent) {
        for (const [definition, view] of this._definitionToView) {
            if (definitionsEqual(definition, event.execution.task.definition as ITaskDefinition)) {
                view.close();
                this._definitionToView.delete(definition);
                break;
            }
        }
    }

    private async _getPackageName(taskDefinition: IPackageTaskDefinition): Promise<string> {
        try {
            const ws = this._workspaces.getWorkspaceFromFolder(taskDefinition.path)!;
            const wsInfo = await ws.info();
            return wsInfo.findPackage(taskDefinition.path)!.name;
        } catch (error) {
            return path.relative(taskDefinition.workspace, taskDefinition.path);
        }
    }

    private _createAndShowView(title: string, definition: vscode.TaskDefinition) {
        const view = progress.createProgressView(title);
        this._definitionToView.set(definition as ITaskDefinition, view);
        view.show();
    }
}
