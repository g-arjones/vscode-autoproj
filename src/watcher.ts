import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export class FileWatcher implements vscode.Disposable {
    private readonly fileToWatcher: Map<string, fs.FSWatcher>;
    private readonly fileToFilter: Map<string, any>;
    constructor() {
        this.fileToWatcher = new Map<string, fs.FSWatcher>();
        this.fileToFilter = new Map<string, any>();
    }
    public startWatching(filePath: string, callback: (filePath: string) => void): boolean {
        if (this.fileToWatcher.has(filePath)) {
            return false;
        }

        const fileName = path.basename(filePath);
        const fileDir = path.dirname(filePath);
        this.fileToWatcher.set(filePath, fs.watch(fileDir, (type, file) => {
            if (file === fileName) {
                if (!this.fileToFilter.has(filePath)) {
                    callback(filePath);
                    // sometimes the callback is called multiple times for a single event
                    this.fileToFilter.set(filePath, setTimeout(() => {
                        this.fileToFilter.delete(filePath);
                    }, 1000));
                }
            }
        }));
        return true;
    }
    public stopWatching(filePath: string): void {
        const watcher = this.fileToWatcher.get(filePath);
        if (!watcher) {
            throw new Error(`${filePath}: Not being watched`);
        }

        watcher.close();
        this.fileToWatcher.delete(filePath);
        this.fileToFilter.delete(filePath);
    }
    public dispose(): void {
        this.fileToWatcher.forEach((watcher) => {
            watcher.close();
        });
        this.fileToWatcher.clear();
        this.fileToFilter.clear();
    }
}
