import * as vscode from "vscode";

export function getLogger(channel: vscode.LogOutputChannel, name: string): vscode.LogOutputChannel {
    return new Proxy(channel, {
        get(target, prop, receiver) {
            const methods = ["trace", "debug", "info", "warn", "error", "replace", "append", "appendLine"];
            if (methods.includes(String(prop))) {
                return (msg, ...args) => target[prop].call(target, `[${name}] ${msg}`, ...args)
            }
            return target[prop];
        }
    });
}