import * as vscode from 'vscode'

/** Shim that provides us an API to the VSCode state we need within the extension
 *
 * This helps during testing to mock VSCode itself, something VSCode's test
 * harness is fairly bad at
 */
export class VSCode {
    private _extensionContext : vscode.ExtensionContext;

    public constructor(extensionContext : vscode.ExtensionContext)
    {
        this._extensionContext = extensionContext;
    }

    public get workspaceFolders(): vscode.WorkspaceFolder[] | undefined
    {
        return vscode.workspace.workspaceFolders;
    }

    public getWorkspaceFolder(uri: vscode.Uri | string): vscode.WorkspaceFolder | undefined
    {
        if (typeof uri == 'string') {
            uri = vscode.Uri.file(uri);
        }
        return vscode.workspace.getWorkspaceFolder(uri);
    }

    public showQuickPick<T extends vscode.QuickPickItem>(items: T[] | Thenable<T[]>,
        options?: vscode.QuickPickOptions, token?: vscode.CancellationToken): Thenable<T | undefined>
    {
        return vscode.window.showQuickPick<T>(items, options, token);
    }

    public registerAndSubscribeCommand(name : string, fn) : void
    {
        let cmd = vscode.commands.registerCommand(name, fn);
        this._extensionContext.subscriptions.push(cmd);
    }

    public showErrorMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>
    {
        return vscode.window.showErrorMessage(message, ...items);
    }

    public createOutputChannel(name: string) {
        return vscode.window.createOutputChannel(name);
    }

    public updateWorkspaceFolders(start: number, deleteCount: number | undefined | null,
        ...workspaceFoldersToAdd: { name?: string, uri: vscode.Uri }[]): boolean
    {
        return vscode.workspace.updateWorkspaceFolders(start, deleteCount, ...workspaceFoldersToAdd);
    }
}