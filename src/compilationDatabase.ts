import * as shlex from "./cmt/shlex";
import { fs } from "./cmt/pr";
import { statSync } from "fs";
import * as util from "./cmt/util";
import * as vscode from "vscode";


export interface CompileCommand {
    directory: string;
    file: string;
    output?: string;
    command: string; // The command string includes both commands and arguments (if any).
    arguments?: string[];
}

export class CompilationDatabase implements vscode.Disposable {
    static POLLING_INTERVAL: number = 2000;

    private _infoByFilePath: Map<string, CompileCommand>;
    private _loaded: boolean;
    private _eventEmitter: vscode.EventEmitter<CompilationDatabase>;
    private _mtime: Date | undefined;
    private _timeout: NodeJS.Timeout;

    public readonly path: string;

    constructor(path: string) {
        this.path = path;
        this._loaded = false;
        this._infoByFilePath = new Map<string, CompileCommand>();
        this._eventEmitter = new vscode.EventEmitter<CompilationDatabase>();

        if (fs.existsSync(this.path)) {
            this._mtime = statSync(this.path).mtime;
        }

        this._timeout = setInterval(() => {
            let mtime: Date | undefined;
            if (fs.existsSync(this.path)) {
                mtime = statSync(this.path).mtime;
            }
            if (mtime?.getTime() != this._mtime?.getTime()) {
                this._loaded = false;
                this._infoByFilePath.clear();
                this._eventEmitter.fire(this);
            }
            this._mtime = mtime;
        }, CompilationDatabase.POLLING_INTERVAL);
    }

    get loaded() {
        return this._loaded;
    }

    async exists() {
        return await fs.exists(this.path);
    }

    onChange(callback: (db: CompilationDatabase) => void) {
        this._eventEmitter.event(callback);
    }

    async load() {
        try {
            const fileContent = await fs.readFile(this.path);
            const content = JSON.parse(fileContent.toString()) as CompileCommand[];
            this._infoByFilePath = content.reduce(
                (acc, cur) => acc.set(util.platformNormalizePath(cur.file), {
                    directory: cur.directory,
                    file: cur.file,
                    output: cur.output,
                    command: cur.command,
                    arguments: cur.arguments ? cur.arguments : [...shlex.split(cur.command)]
                }),
                new Map<string, CompileCommand>()
            );
            this._loaded = true;
        } catch (e) {
            vscode.window.showErrorMessage(
                `Error parsing compilation database "${this.path}": ${e.message}`)
        }
    }

    get(fsPath: string) {
        return this._infoByFilePath.get(util.platformNormalizePath(fsPath));
    }

    dispose() {
        clearInterval(this._timeout);
        this._eventEmitter.dispose();
    }
}