import * as process from "process";
import * as vscode from "vscode";
import { fs } from "../src/cmt/pr";
import { setTimeout as sleep } from "timers/promises";
import * as autoproj from "./autoproj"
import * as watcher from "./fileWatcher";
import * as child_process from "child_process";
import { VSCode } from "./wrappers";
import * as path from "path";
import { asyncSpawn, getLogger } from "./util";
import { ShimsWriter } from "./shimsWriter";

export class WatchManager implements vscode.Disposable {
    private _folderToProcess: Map<string, WatchProcess>;

    constructor(private _outputChannel: vscode.LogOutputChannel, private _vscode: VSCode) {
        this._folderToProcess = new Map<string, WatchProcess>();
    }

    public createProcess(workspace: autoproj.Workspace) {
        return new WatchProcess(workspace, getLogger(this._outputChannel, workspace.name), this._vscode);
    }

    public start(workspace: autoproj.Workspace) {
        let proc: WatchProcess;
        if (this._folderToProcess.has(workspace.root)) {
            proc = this._folderToProcess.get(workspace.root)!;
        } else {
            proc = this.createProcess(workspace);
            this._folderToProcess.set(workspace.root, proc);
        }
        proc.start();
    }

    public async stop(workspace: autoproj.Workspace) {
        if (this._folderToProcess.has(workspace.root)) {
            const proc = this._folderToProcess.get(workspace.root)!;
            await proc.stop();
            proc.dispose();
            this._folderToProcess.delete(workspace.root);
        }
    }

    public dispose() {
        for (const watch of this._folderToProcess.values()) {
            watch.stop();
            watch.dispose();
        }
        this._folderToProcess.clear();
    }
};

export class WatchProcess implements vscode.Disposable {
    public static STALE_PID_FILE_TIMEOUT_SEC = 5;
    public static RESTART_PROCESS_TIMEOUT_SEC = 5;
    public static RESTART_RETRIES = 2;

    private _childProc: child_process.ChildProcess | undefined;
    private _finish: Promise<number | null> | undefined;
    private _running: boolean;
    private _watcher: watcher.FileWatcher;

    constructor(
        private _workspace: autoproj.Workspace,
        private _logger: vscode.LogOutputChannel,
        private _vscode: VSCode)
    {
        this._running = false;
        this._watcher = new watcher.FileWatcher();
    }

    public dispose() {
        this._watcher.dispose();
    }

    public start() {
        if (this._running) {
            return;
        }
        this._running = true;
        this._finish = this._run().catch((error) => {
            this._vscode.showErrorMessage(`${this._workspace.name}: Could not start watch process: ${error.message}`);
            return null;
        }).finally(() => this._running = false);
    }

    public get pidFile(): string {
        return path.join(this._workspace.root, ".autoproj", "watch");
    }

    public async stop() {
        this._childProc?.kill();
        await this.finish();
    }

    public async finish(): Promise<number | null | undefined> {
        return await this._finish;
    }

    public async readPid(): Promise<number | undefined> {
        if (await fs.exists(this.pidFile)) {
            let pid = +(await fs.readFile(this.pidFile) as string);

            if (isNaN(pid)) {
                throw new Error("Invalid autoproj watch PID file");
            }

            return pid;
        }
    }

    private _processExists(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch (error) {
            return false;
        }
    }

    private async _watchPidFile() {
        return new Promise<void>((resolve) => {
            this._watcher?.startWatching(this.pidFile, (path) => {
                if (!fs.existsSync(path)) {
                    this._watcher.stopWatching(path);
                    resolve();
                }
            })
        });
    }

    private async _waitPid(pid: number | undefined): Promise<number> {
        if (pid && !this._processExists(pid)) {
            this._logger.info("The autoproj watch PID file is stale")
            this._logger.info(`Waiting for ${WatchProcess.STALE_PID_FILE_TIMEOUT_SEC}s to confirm...`);

            await sleep(WatchProcess.STALE_PID_FILE_TIMEOUT_SEC * 1000);
        } else if (pid) {
            return 0;
        }

        const newPid = await this.readPid();
        if (!newPid) {
            return 0;
        }

        if (newPid === pid || !pid) {
            if (this._processExists(newPid)) {
                this._logger.info("Another autoproj watch process is already running. Waiting...")
                await this._watchPidFile();
            } else if (pid) {
                await fs.unlink(this.pidFile);
                return 0;
            }
        }
        return newPid;
    }

    private async _waitReady(): Promise<void> {
        let pid: number | undefined;
        for (const n of [1, 2, 3, 4, 5]) {  // try this 5 times
            pid = await this._waitPid(pid);
            if (!pid) {
                return;
            }
        }

        throw new Error("Could not start autoproj watch process");
    }

    private async _run(): Promise<number | null> {
        let code: number | null;
        let tries = 0;

        do {
            await this._waitReady();
            const runTimeout = setTimeout(() => tries = 0, 15000); // reset the number of tries after 15s
            code = await this._spawn(); // await until the process dies (which should never happen)
            clearTimeout(runTimeout); // if the process didn't run for at least 15s, we clear the timeout

            if (!this._childProc?.killed) {
                if (tries >= WatchProcess.RESTART_RETRIES) {
                    this._logger.error("The autoproj workspace is broken, giving up until it gets fixed...");
                    break;
                } else {
                    this._logger.error(`autoproj watch process died unexpectedly (return code: ${code})`)
                    this._logger.info(`Waiting for ${WatchProcess.RESTART_PROCESS_TIMEOUT_SEC}s and restarting...`);

                    await sleep(WatchProcess.RESTART_PROCESS_TIMEOUT_SEC * 1000);
                    tries++;
                }
            }
        } while (!this._childProc?.killed);
        return code;
    }

    private async _spawn(): Promise<number | null> {
        const rubyopts = `-r${path.join(this._workspace.root, ShimsWriter.RELATIVE_OPTS_PATH, "rubyopt.rb")}`;
        const env = { ...process.env, RUBYOPT: rubyopts };
        const execution = asyncSpawn(
                this._logger,
                this._workspace.autoprojExePath(),
                ["watch", "--show-events"], { env: env });

        this._childProc = execution.childProcess;
        return execution.returnCode;
    }
}
