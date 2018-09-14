import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import * as autoproj from './autoproj';

export class Context
{
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _contextUpdatedEvent: vscode.EventEmitter<void>;
    private readonly _outputChannel: vscode.OutputChannel;

    public constructor(vscodeWrapper: wrappers.VSCode,
                       workspaces: autoproj.Workspaces,
                       outputChannel : vscode.OutputChannel)
    {
        this._vscode = vscodeWrapper;
        this._workspaces = workspaces;
        this._contextUpdatedEvent = new vscode.EventEmitter<void>();
        this._outputChannel = outputChannel;
    }

    get outputChannel(): vscode.OutputChannel
    {
        return this._outputChannel;
    }

    public dispose() {
        this._contextUpdatedEvent.dispose();
    }

    public onUpdate(callback)
    {
        return this._contextUpdatedEvent.event(callback);
    }

    public get workspaces(): autoproj.Workspaces
    {
        return this._workspaces;
    }

    public async updateWorkspaceInfo(ws: autoproj.Workspace) {
        await ws.envsh();
        this._contextUpdatedEvent.fire();
    }
}
