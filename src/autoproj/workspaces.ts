import * as path from "path";
import * as vscode from "vscode";
import { findWorkspaceRoot } from "./helpers";
import { WorkspaceInfo } from "./info";
import { IPackage, IPackageSet } from "./interface";
import { Workspace } from "./workspace";

/** Dynamic management of a set of workspaces
 *
 */
export class Workspaces {
    public devFolder: string | null;
    public workspaces = new Map<string, Workspace>();
    public folderToWorkspace = new Map<string, Workspace>();
    private _workspaceInfoEvent = new vscode.EventEmitter<WorkspaceInfo>();
    private _folderInfoEvent = new vscode.EventEmitter<IPackage | IPackageSet>();
    private _folderInfoDisposables = new Map<string, vscode.Disposable>();

    constructor(devFolder = null) {
        this.devFolder = devFolder;
    }

    public dispose() {
        this.workspaces.forEach((ws) => ws.dispose());
        this._workspaceInfoEvent.dispose();
        this._folderInfoEvent.dispose();
        this._folderInfoDisposables.forEach((d) => d.dispose());
    }

    public onWorkspaceInfo(callback: (info: WorkspaceInfo) => any): vscode.Disposable {
        return this._workspaceInfoEvent.event(callback);
    }

    public onFolderInfo(callback: (info: IPackage | IPackageSet) => any): vscode.Disposable {
        return this._folderInfoEvent.event(callback);
    }

    /** Add workspaces that contain some directory paths
     *
     * The paths do not necessarily need to be within an autoproj workspace, in
     * which case they are ignored.
     *
     * Returns the list of newly added workspaces
     */
    public addCandidate(wsPath: string, loadInfo: boolean = true) {
        // Workspaces are often duplicates (multiple packages from the same ws).
        // Make sure we don't start the info resolution promise until we're sure
        // it is new
        const wsRoot = findWorkspaceRoot(wsPath);
        if (!wsRoot) {
            return { added: false, workspace: null };
        } else if (this.workspaces.has(wsRoot)) {
            return { added: false, workspace: this.workspaces.get(wsRoot) };
        } else {
            const ws = new Workspace(wsRoot, loadInfo);
            this.add(ws);
            ws.onInfoUpdated((info) => {
                this._workspaceInfoEvent.fire(info);
            });
            return { added: true, workspace: ws };
        }
    }

    /** Associate a folder to a workspace
     */
    public associateFolderToWorkspace(wsPath: string, workspace: Workspace) {
        this.folderToWorkspace.set(wsPath, workspace);
    }

    /** Add a folder
     *
     * This adds the folder's workspace to the set, if the folder is part of an
     * Autoproj workspace, and returns it. Returns null if the folder is NOT
     * part of an autoproj workspace.
     */
    public addFolder(wsPath: string) {
        const { added, workspace } = this.addCandidate(wsPath);
        if (workspace) {
            this.associateFolderToWorkspace(wsPath, workspace);
            const event = workspace.onInfoUpdated((info) => {
                const pkgInfo = info.find(wsPath);
                if (pkgInfo) {
                    this._folderInfoEvent.fire(pkgInfo);
                }
            });
            this._folderInfoDisposables.set(wsPath, event);
        }
        return { added, workspace };
    }

    /** De-registers a folder
     *
     * Removes a folder, and removes the corresponding workspace
     * if it was the last folder of this workspace - in which case
     * the workspace object is returned.
     */
    public deleteFolder(wsPath: string) {
        const ws = this.folderToWorkspace.get(wsPath);
        const event = this._folderInfoDisposables.get(wsPath);
        if (event) {
            event.dispose();
        }
        this.folderToWorkspace.delete(wsPath);
        if (ws) {
            if (this.useCount(ws) === 0) {
                this.delete(ws);
                return ws;
            }
        }
        return null;
    }

    /**
     * Returns the number of registered folders that use this workspace
     */
    public useCount(workspace: Workspace) {
        let result = 0;
        this.folderToWorkspace.forEach((ws) => {
            if (ws === workspace) {
                result += 1;
            }
        });
        return result;
    }

    /** Add workspaces to the workspace set
     */
    public add(workspace: Workspace) {
        if (this.devFolder) {
            workspace.name = path.relative(this.devFolder, workspace.root);
        }
        this.workspaces.set(workspace.root, workspace);
    }

    /** Remove workspaces */
    public delete(workspace: Workspace) {
        if (this.useCount(workspace) !== 0) {
            throw new Error("cannot remove a workspace that is in-use");
        }
        workspace.dispose();
        this.workspaces.delete(workspace.root);
    }

    /** Enumerate the workspaces
     *
     * Yields (ws)
     */
    public forEachWorkspace(callback: (ws: Workspace) => void) {
        this.workspaces.forEach(callback);
    }

    /** Enumerate the folders and workspaces
     *
     * Yields (ws, folder)
     */
    public forEachFolder(callback: (ws: Workspace, folder: string) => void) {
        this.folderToWorkspace.forEach(callback);
    }

    /** Check whether a given folder is part of a workspace configuration
     *
     * Returns true if the folder is configuration, false otherwise
     */
    public isConfig(folder: string): boolean {
        let isConfig = false;
        this.forEachWorkspace((ws) => {
            let lastPath = "";
            let iterFolder = folder;
            while (iterFolder !== lastPath) {
                if ((iterFolder === path.join(ws.root, "autoproj")) ||
                    (iterFolder === path.join(ws.root, ".autoproj"))) {
                    isConfig = true;
                    break;
                }
                lastPath = iterFolder;
                iterFolder = path.dirname(iterFolder);
            }
        });
        return isConfig;
    }

    /** Returns the workspace that matches a package folder
     */
    public getWorkspaceFromFolder(folder: string): Workspace | undefined {
        return this.folderToWorkspace.get(folder);
    }
}
