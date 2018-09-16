import * as vscode from "vscode";
import * as autoproj from "./autoproj";
import * as wrappers from "./wrappers";

export class Context {
    public readonly workspaces: autoproj.Workspaces;
    public readonly outputChannel: vscode.OutputChannel;

    private readonly contextUpdatedEvent: vscode.EventEmitter<void>;

    public constructor(workspaces: autoproj.Workspaces, outputChannel: vscode.OutputChannel) {
        this.workspaces = workspaces;
        this.contextUpdatedEvent = new vscode.EventEmitter<void>();
        this.outputChannel = outputChannel;
    }

    public dispose() {
        this.contextUpdatedEvent.dispose();
    }

    public onUpdate(callback) {
        return this.contextUpdatedEvent.event(callback);
    }

    public async updateWorkspaceInfo(ws: autoproj.Workspace) {
        await ws.envsh();
        this.contextUpdatedEvent.fire();
    }
}
