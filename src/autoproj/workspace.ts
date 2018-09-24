import * as path from "path";
import * as vscode from "vscode";
import { autoprojExePath, findWorkspaceRoot, loadWorkspaceInfo } from "./helpers";
import { WorkspaceInfo } from "./info";

export class Workspace {
    public static fromDir(wsPath: string, loadInfo: boolean = true) {
        const root = findWorkspaceRoot(wsPath);
        if (!root) {
            return null;
        }

        return new Workspace(root, loadInfo);
    }

    // The workspace name
    public name: string;
    // The workspace root directory
    public readonly root: string;
    private infoPromise: Promise<WorkspaceInfo>;
    private infoUpdatedEvent: vscode.EventEmitter<WorkspaceInfo>;

    constructor(root: string, loadInfo: boolean = true) {
        this.root = root;
        this.name = path.basename(root);
        this.infoUpdatedEvent = new vscode.EventEmitter<WorkspaceInfo>();
        if (loadInfo) {
            this.infoPromise = this.createInfoPromise();
        }
    }

    public autoprojExePath() {
        return autoprojExePath(this.root);
    }

    public loadingInfo(): boolean {
        return this.infoPromise !== undefined;
    }

    public reload() {
        this.infoPromise = this.createInfoPromise();
        this.infoPromise.then((info) => { this.infoUpdatedEvent.fire(info); });
        return this.infoPromise;
    }

    public dispose() {
        this.infoUpdatedEvent.dispose();
    }

    public onInfoUpdated(callback: (info: WorkspaceInfo) => any): vscode.Disposable {
        return this.infoUpdatedEvent.event(callback);
    }

    public info(): Promise<WorkspaceInfo> {
        if (this.infoPromise) {
            return this.infoPromise;
        } else {
            return this.reload();
        }
    }

    private createInfoPromise() {
        return loadWorkspaceInfo(this.root);
    }
}
