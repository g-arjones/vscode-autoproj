import * as path from "path";
import * as vscode from "vscode";
import * as autoproj from "../autoproj";
import * as progress from "../progress";
import * as wrappers from "../wrappers";
import { definitionsEqual, IPackageTaskDefinition, ITaskDefinition,
         PackageTaskMode, TaskType, WorkspaceTaskMode } from "./definitions";

export class Handler implements vscode.Disposable {
    private definitionToView: Map<ITaskDefinition, progress.ProgressView>;

    constructor(private wrapper: wrappers.VSCode, private workspaces: autoproj.Workspaces) {
        this.definitionToView = new Map();
    }

    public dispose(): void {
        this.definitionToView.forEach((view) => view.close);
        this.definitionToView.clear();
    }

    public async onDidStartTaskProcess(event: vscode.TaskProcessStartEvent) {
        const task = event.execution.task;
        if (task.definition.type === TaskType.Package) {
            let buildMode = "";
            const pkgName = await this.getPackageName(task.definition as IPackageTaskDefinition);
            switch (task.definition.mode) {
                case PackageTaskMode.ForceBuild:
                case PackageTaskMode.BuildNoDeps:
                case PackageTaskMode.Rebuild:
                case PackageTaskMode.Build:
                    if (task.definition.mode === PackageTaskMode.Rebuild) { buildMode = " (rebuild)"; }
                    if (task.definition.mode === PackageTaskMode.ForceBuild) { buildMode = " (force)"; }
                    if (task.definition.mode === PackageTaskMode.BuildNoDeps) { buildMode = " (no dependencies)"; }
                    this.createAndShowView(`Building ${pkgName}${buildMode}...`, event.execution.task.definition);
                    break;
                case PackageTaskMode.Checkout:
                    this.createAndShowView(`Checking out ${pkgName}...`, event.execution.task.definition);
                    break;
                case PackageTaskMode.Update:
                    this.createAndShowView(`Updating ${pkgName} (and its
                        dependencies)...`, event.execution.task.definition);
                    break;
            }
        } else if (task.definition.type === TaskType.Workspace) {
            const ws = this.workspaces.workspaces.get(task.definition.workspace)!.name;
            switch (task.definition.mode) {
                case WorkspaceTaskMode.Build:
                    this.createAndShowView(`${ws}: Building all packages...`, event.execution.task.definition);
                    break;
                case WorkspaceTaskMode.Checkout:
                    this.createAndShowView(`${ws}: Checking out all packages...`, event.execution.task.definition);
                    break;
                case WorkspaceTaskMode.Osdeps:
                    this.createAndShowView(`${ws}: Installing OS dependencies...`, event.execution.task.definition);
                    break;
                case WorkspaceTaskMode.Update:
                    this.createAndShowView(`${ws}: Updating all packages...`, event.execution.task.definition);
                    break;
                case WorkspaceTaskMode.UpdateConfig:
                    this.createAndShowView(`${ws}: Updating build configuration...`, event.execution.task.definition);
                    break;
                case WorkspaceTaskMode.UpdateEnvironment:
                    this.createAndShowView(`${ws}: Updating environment...`, event.execution.task.definition);
                    break;

            }
        }
    }

    public createAndShowView(title: string, definition: vscode.TaskDefinition) {
        const view = new progress.ProgressView(this.wrapper, title);
        this.definitionToView.set(definition as ITaskDefinition, view);
        view.show();
    }

    public onDidEndTaskProcess(event: vscode.TaskProcessEndEvent) {
        for (const [definition, view] of this.definitionToView) {
            if (definitionsEqual(definition, event.execution.task.definition as ITaskDefinition)) {
                view.close();
                this.definitionToView.delete(definition);
                break;
            }
        }
    }

    private async getPackageName(taskDefinition: IPackageTaskDefinition): Promise<string> {
        try {
            const ws = this.workspaces.getWorkspaceFromFolder(taskDefinition.path)!;
            const wsInfo = await ws.info();
            return wsInfo.findPackage(taskDefinition.path)!.name;
        } catch (error) {
            return path.relative(taskDefinition.workspace, taskDefinition.path);
        }
    }
}
