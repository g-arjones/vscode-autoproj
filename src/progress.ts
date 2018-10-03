import { Progress, ProgressLocation } from "vscode";
import * as wrappers from "./wrappers";

export function createProgressView(vscode: wrappers.VSCode, title?: string) {
    return new ProgressView(vscode, title);
}

export class ProgressView {
    private _resolver: (value?: any) => void;
    private _view: Progress<{ message?: string, increment?: number }>;
    private _currentProgress: number;
    private _currentText: string;
    private _promise: Promise<void>;

    constructor(private readonly _vscode: wrappers.VSCode, public readonly title?: string) {
        this._currentProgress = 0;
    }

    public show(): void {
        this._vscode.withProgress({
            cancellable: false,
            location: ProgressLocation.Notification,
            title: this.title,
        }, (progress) => {
            this._view = progress;
            this._promise = new Promise((resolve) => this._resolver = resolve);
            return this._promise;
        });
    }

    public get text() { return this._currentText; }

    public get progress() { return this._currentProgress; }

    public update(message: string, increment: number) {
        this._currentProgress += increment;
        this._currentText = message;

        if (this._currentProgress < 0) { this._currentProgress = 0; }

        this._view.report({ message, increment });
    }

    public close() {
        this._resolver();
    }

    public async wait() {
        return this._promise;
    }
}
