import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ConsoleOutputChannel } from "./console";
import { autoprojExePath, findWorkspaceRoot, loadWorkspaceInfo } from "./helpers";
import { WorkspaceInfo } from "./info";
import { IOutputChannel, IProcess } from "./interface";

export class Workspace {
    public static fromDir(wsPath: string, loadInfo: boolean = true,
                          outputChannel: IOutputChannel = new ConsoleOutputChannel()) {
        const root = findWorkspaceRoot(wsPath);
        if (!root) {
            return null;
        }

        return new Workspace(root, loadInfo, outputChannel);
    }

    // The workspace name
    public name: string;
    // The workspace root directory
    public readonly root: string;
    private infoPromise: Promise<WorkspaceInfo>;
    private infoUpdatedEvent: vscode.EventEmitter<WorkspaceInfo>;
    private outputChannel: IOutputChannel;

    constructor(root: string, loadInfo: boolean = true, outputChannel: IOutputChannel = new ConsoleOutputChannel()) {
        this.root = root;
        this.name = path.basename(root);
        this.outputChannel = outputChannel;
        this.infoUpdatedEvent = new vscode.EventEmitter<WorkspaceInfo>();
        if (loadInfo) {
            this.infoPromise = this.createInfoPromise();
        }
    }

    public autoprojExePath() {
        return autoprojExePath(this.root);
    }

    public autoprojExec(command: string, args: string[], options: child_process.SpawnOptions = {}): IProcess {
        return child_process.spawn(this.autoprojExePath(), ["exec", command, ...args],
                                   { cwd: this.root, stdio: "pipe", env: process.env, ...options});
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

    public envsh(): Promise<WorkspaceInfo> {
        const subprocess = child_process.spawn(this.autoprojExePath(), ["envsh", "--color"],
                                               { cwd: this.root, stdio: "pipe" });

        this.redirectProcessToChannel("autoproj envsh", "envsh", subprocess);
        return new Promise<WorkspaceInfo>((resolve, reject) => {
            subprocess.on("exit", (code, status) => {
                if (code === 0) {
                    resolve(this.reload());
                } else {
                    resolve(this.info());
                }
            });
        });
    }

    public which(cmd: string) {
        const options: child_process.SpawnOptions = { env: {} };
        Object.assign(options.env, process.env);
        Object.assign(options.env, { AUTOPROJ_CURRENT_ROOT: this.root });
        const subprocess = child_process.spawn(this.autoprojExePath(), ["which", cmd], options);
        let filePath = "";
        this.redirectProcessToChannel(`autoproj which ${cmd}`, `which ${cmd}`, subprocess);
        subprocess.stdout.on("data", (buffer) => {
            filePath = filePath.concat(buffer.toString());
        });

        return new Promise<string>((resolve, reject) => {
            subprocess.on("exit", (code, signal) => {
                if (code !== 0) {
                    reject(new Error(`cannot find ${cmd} in the workspace`));
                } else {
                    resolve(filePath.trim());
                }
            });
        });
    }

    private createInfoPromise() {
        return loadWorkspaceInfo(this.root);
    }

    // Private API, made public only for testing reasons
    private redirectProcessToChannel(name, shortname, subprocess: IProcess) {
        this.outputChannel.appendLine(`${shortname}: starting ${name}`);
        subprocess.stderr.on("data", (buffer) => {
            const lines = buffer.toString().split("\n");
            lines.forEach((l) => {
                this.outputChannel.appendLine(`${shortname}: ${l}`);
            });
        });
        subprocess.stdout.on("data", (buffer) => {
            const lines = buffer.toString().split("\n");
            lines.forEach((l) => {
                this.outputChannel.appendLine(`${shortname}: ${l}`);
            });
        });
        subprocess.on("exit", () => {
            this.outputChannel.appendLine(`${shortname}: ${name} quit`);
        });
    }
}
