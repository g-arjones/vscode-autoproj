import * as child_process from "child_process";
import * as vscode from "vscode";

export interface IAsyncExecution {
    childProcess: child_process.ChildProcessWithoutNullStreams,
    returnCode: Promise<number | null>
}

export function asyncSpawn(
    channel: vscode.LogOutputChannel,
    command: string,
    args?: readonly string[],
    options?: child_process.SpawnOptionsWithoutStdio): IAsyncExecution
{
    const childProcess = child_process.spawn(command, args, options);
    return {
        childProcess: childProcess,
        returnCode: new Promise((resolve, reject) => {
            childProcess.stdout.on('data', (data) => {
                for (const line of data.toString().trim().split("\n")) { channel.info(line); }
            });

            childProcess.stderr.on('data', (data) => {
                for (const line of data.toString().trim().split("\n")) { channel.error(line); }
            });

            childProcess.on('error', (error) => {
                reject(error)
            });

            childProcess.on('exit', (code, signal) => {
                resolve(code);
            });
        })
    }
}

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