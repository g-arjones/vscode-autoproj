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
    private _infoPromise: Promise<WorkspaceInfo>;
    private _infoUpdatedEvent: vscode.EventEmitter<WorkspaceInfo>;

    constructor(root: string, loadInfo: boolean = true) {
        this.root = root;
        this.name = path.basename(root);
        this._infoUpdatedEvent = new vscode.EventEmitter<WorkspaceInfo>();
        if (loadInfo) {
            this._infoPromise = this._createInfoPromise();
        }
    }

    public autoprojExePath() {
        return autoprojExePath(this.root);
    }

    public loadingInfo(): boolean {
        return this._infoPromise !== undefined;
    }

    public reload() {
        this._infoPromise = this._createInfoPromise();
        this._infoPromise.then((info) => { this._infoUpdatedEvent.fire(info); });
        return this._infoPromise;
    }

    public dispose() {
        this._infoUpdatedEvent.dispose();
    }

    public onInfoUpdated(callback: (info: WorkspaceInfo) => any): vscode.Disposable {
        return this._infoUpdatedEvent.event(callback);
    }

    public info(): Promise<WorkspaceInfo> {
        if (this._infoPromise) {
            return this._infoPromise;
        } else {
            return this.reload();
        }
    }

    private _createInfoPromise() {
        return loadWorkspaceInfo(this.root);
    }
}
