import * as shlex from "./shlex";
import * as cpptools from "../cpptools";
import { fs } from "./pr";
import { statSync } from "fs";
import * as util from "./util";
import * as vscode from "vscode";


export interface CompileCommand {
    directory: string;
    file: string;
    output?: string;
    command: string; // The command string includes both commands and arguments (if any).
    arguments?: string[];
}

export class CompilationDatabase implements vscode.Disposable {
    private _infoByFilePath: Map<string, CompileCommand>;
    private _loaded: boolean;
    private _cppConfigurationProvider: cpptools.CppConfigurationProvider;
    private _mtime: Date | undefined;
    private _timeout: NodeJS.Timeout;

    public readonly path: string;

    constructor(path: string, cppConfigurationProvider: cpptools.CppConfigurationProvider) {
        this.path = path;
        this._loaded = false;
        this._infoByFilePath = new Map<string, CompileCommand>();
        this._cppConfigurationProvider = cppConfigurationProvider;

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
                this._cppConfigurationProvider.notifyChanges();
            }
            this._mtime = mtime;
        }, 2000);
    }

    get loaded() {
        return this._loaded;
    }

    async exists() {
        return await fs.exists(this.path);
    }

    async load() {
        const fileContent = await fs.readFile(this.path);
        try {
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
            console.warn('Error parsing compilation database {0}: {1}', `"${this.path}"`, util.errorToString(e));
        }
    }

    get(fsPath: string) {
        return this._infoByFilePath.get(util.platformNormalizePath(fsPath));
    }

    dispose() {
        clearInterval(this._timeout);
    }
}