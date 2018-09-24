import * as vscode from "vscode";
import * as autoproj from "./autoproj";

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
}
