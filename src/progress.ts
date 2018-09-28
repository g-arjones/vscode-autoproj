import { Progress, ProgressLocation } from "vscode";
import * as wrappers from "./wrappers";

export class ProgressView {
    private resolver: (value?: any) => void;
    private view: Progress<{ message?: string, increment?: number }>;
    private currentProgress: number;
    private currentText: string;
    private promise: Promise<void>;

    constructor(private readonly vscode: wrappers.VSCode, public readonly title?: string) {
        this.currentProgress = 0;
    }

    public show(): void {
        this.vscode.withProgress({
            cancellable: false,
            location: ProgressLocation.Notification,
            title: this.title,
        }, (progress) => {
            this.view = progress;
            this.promise = new Promise((resolve) => this.resolver = resolve);
            return this.promise;
        });
    }

    public get text() { return this.currentText; }

    public get progress() { return this.currentProgress; }

    public update(message: string, increment: number) {
        this.currentProgress += increment;
        this.currentText = message;

        if (this.currentProgress < 0) { this.currentProgress = 0; }

        this.view.report({ message, increment });
    }

    public close() {
        this.resolver();
    }

    public async wait() {
        return this.promise;
    }
}
