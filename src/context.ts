import * as vscode from "vscode";
import * as autoproj from "./autoproj";
import * as wrappers from "./wrappers";

export class Context {
    public readonly workspaces: autoproj.Workspaces;
    public readonly outputChannel: vscode.OutputChannel;

    public constructor(workspaces: autoproj.Workspaces, outputChannel: vscode.OutputChannel) {
        this.workspaces = workspaces;
        this.outputChannel = outputChannel;
    }

    public dispose() {
        // no-op
    }

    public async updateWorkspaceInfo(ws: autoproj.Workspace) {
        await ws.envsh();
    }
}
