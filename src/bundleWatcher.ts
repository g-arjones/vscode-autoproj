import * as crypto from "crypto";
import * as path from "path";
import * as progress from "./progress";
import * as yaml from "js-yaml";
import * as vscode from "vscode";
import { FileWatcher } from "./fileWatcher";
import { asyncSpawn, getLogger } from "./util";
import { fs } from "./cmt/pr";
import { Workspace } from "./autoproj";
import { VSCode } from "./wrappers";

export class BundleManager implements vscode.Disposable {
    private _folderToWatcher: Map<string, BundleWatcher>;

    constructor(private _outputChannel: vscode.LogOutputChannel, private _vscode: VSCode) {
        this._folderToWatcher = new Map<string, BundleWatcher>();
    }

    public createWatcher(workspace: Workspace) {
        return new BundleWatcher(this._vscode, workspace, getLogger(this._outputChannel, workspace.name));
    }

    public getWatcher(workspace: Workspace): BundleWatcher {
        const watcher = this._folderToWatcher.get(workspace.root) || this.createWatcher(workspace);
        this._folderToWatcher.set(workspace.root, watcher);

        return watcher;
    }

    public async check(workspace: Workspace) {
        return await this.getWatcher(workspace).check();
    }

    public async install(workspace: Workspace) {
        return await this.getWatcher(workspace).queueInstall();
    }

    public unwatch(workspace: Workspace) {
        this.getWatcher(workspace).dispose();
        this._folderToWatcher.delete(workspace.root);
    }

    public dispose() {
        for (const watcher of this._folderToWatcher.values()) {
            watcher.dispose();
        }
        this._folderToWatcher.clear();
    }
};

export interface IBundleState {
    [lockFilePath: string]: string | null;
}

class PromiseQueue {
    public queue: Promise<any> = Promise.resolve();
    public add(operation): Promise<number | null> {
        return new Promise((resolve, reject) => {
            this.queue = this.queue.then(operation).then(resolve).catch(reject);
        });
    }
}

export class BundleWatcher implements vscode.Disposable {
    private _fileWatcher: FileWatcher;
    private _queue: PromiseQueue;
    private _watching: boolean;

    constructor(private _vscode: VSCode, private _ws: Workspace, private _logger: vscode.LogOutputChannel) {
        this._queue = new PromiseQueue();
        this._fileWatcher = new FileWatcher();
        this._watching = false;
    }

    private get _dotAutoproj(): string {
        return path.join(this._ws.root, ".autoproj");
    }

    get statePath(): string {
        return path.join(this._dotAutoproj, "vscode-autoproj", "state.json");
    }

    get autoprojLockPath(): string {
        return path.join(this._dotAutoproj, "Gemfile.lock");
    }

    get autoprojGemfile(): string {
        return path.join(this._dotAutoproj, "Gemfile");
    }

    get extensionLockPath(): string {
        return path.join(this._dotAutoproj, "vscode-autoproj", "Gemfile.lock");
    }

    get extensionGemfile(): string {
        return path.join(this._dotAutoproj, "vscode-autoproj", "Gemfile");
    }

    get userGemfile(): Promise<string> {
        return fs.readFile(path.join(this._dotAutoproj, "env.yml")).then((data) => {
            const env: any = yaml.load(data);
            return env["set"]["BUNDLE_GEMFILE"][0];
        });
    }

    get userLockPath(): Promise<string> {
        return fs.readFile(path.join(this._dotAutoproj, "env.yml")).then((data) => {
            const env: any = yaml.load(data);
            const userGemfilePath: string = env["set"]["BUNDLE_GEMFILE"][0];
            return path.join(path.dirname(userGemfilePath), "Gemfile.lock");
        });
    }

    public async _getFileHash(filePath: string): Promise<string> {
        const fileContents: string = await fs.readFile(filePath);
        const hash: crypto.Hash = crypto.createHash('sha1');

        hash.setEncoding('hex');
        hash.write(fileContents);
        hash.end();

        return hash.read();
    }

    private async _lockFiles(): Promise<string[]> {
        return [await this.userLockPath, this.extensionLockPath, this.autoprojLockPath];
    }

    public async unwatch() {
        if (!this._watching) {
            return;
        }

        for (const file of await this._lockFiles()) {
            this._fileWatcher.stopWatching(file);
        }
        this._watching = false;
    }

    public async watch() {
        if (this._watching) {
            return;
        }

        for (const file of await this._lockFiles()) {
            this._fileWatcher.startWatching(file, (filePath: string) => {
                this.check();
            });
        }
        this._watching = true;
    }

    public async saveCurrentState(): Promise<void> {
        await fs.writeFile(this.statePath, JSON.stringify(await this.getCurrentState(), undefined, 4));
    }

    public async getSavedState(): Promise<IBundleState> {
        try {
            return JSON.parse(await fs.readFile(this.statePath));
        } catch (error) {
            return {}
        }
    }

    public async getCurrentState(): Promise<IBundleState> {
        return {
            [await this.userLockPath]: await this._getFileHash(await this.userLockPath).catch((error) => null),
            [this.autoprojLockPath]: await this._getFileHash(this.autoprojLockPath).catch((error) => null),
            [this.extensionLockPath]: await this._getFileHash(this.extensionLockPath).catch((error) => null)
        };
    }

    private async _writeExtensionGemfile() {
        try {
            const gemfileContents = [
                '# frozen_string_literal: true',
                '# AUTO GENERATED BY THE VSCODE AUTOPROJ EXTENSION',
                'source "https://rubygems.org"',
                '',
                `eval_gemfile "${await this.userGemfile}"`,
                `eval_gemfile "${this.autoprojGemfile}"`,
                'gem "ruby-lsp"',
                'gem "debug"',
                ''
            ].join("\n");

            await fs.mkdir_p(path.dirname(this.extensionGemfile));
            await fs.writeFile(this.extensionGemfile, gemfileContents);
        } catch (error) {
            throw new Error(`Could not create extension Gemfile: ${error.message}`);
        }
    }

    public async queueInstall() {
        return await this._queue.add(() => this.install());
    }

    public async install(): Promise<number | null> {
        const msg = `Installing extension dependencies in '${this._ws.name}' workspace`;
        const view = progress.createProgressView(this._vscode, msg);

        view.show();

        try {
            return await this._install();
        } catch (error) {
            this._logger.show();
            this._vscode.showErrorMessage(error.message);
            return null;
        } finally {
            view.close();
        }
    }

    public async isUpToDate(): Promise<boolean> {
        const currentState = await this.getCurrentState();
        const savedState = await this.getSavedState();
        return JSON.stringify(currentState) === JSON.stringify(savedState);
    }

    public async check() {
        if (!await fs.exists(this.extensionGemfile)) {
            return;
        }

        if (!this._watching) {
            this.watch();
        }

        if (await this.isUpToDate()) {
            return;
        }

        await this.queueInstall();
    }

    private async _install() {
        await this.unwatch();
        await this._writeExtensionGemfile();
        const cmd = `. ${path.join(this._ws.root, "env.sh")} && ` +
            `BUNDLE_GEMFILE='${this.extensionGemfile}' exec bundle install`

        const returnCode = asyncSpawn(this._logger, "/bin/sh", ["-c", cmd]).returnCode;
        try {
            await returnCode;
        } catch (err) {
            throw new Error(`Could not install extension dependencies in '${this._ws.name}' workspace: ${err.message}`);
        }

        if (await returnCode !== 0) {
            throw new Error(`Failed while installing extension dependencies in '${this._ws.name}' workspace`);
        }

        await this.saveCurrentState();
        await this.watch();

        return returnCode;
    }

    public dispose() {
        this._fileWatcher.dispose();
        this._watching = false;
    }
}