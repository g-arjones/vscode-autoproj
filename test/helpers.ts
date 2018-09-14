'use strict';

import * as Autoproj from '../src/autoproj'
import * as FS from 'fs';
import * as Temp from 'fs-temp';
import * as Path from 'path';
import * as YAML from 'js-yaml';
import * as TypeMoq from 'typemoq'
import * as Wrappers from '../src/wrappers'
import * as Context from '../src/context'
import * as Tasks from '../src/tasks'
import { EventEmitter } from 'events';

export class OutputChannel implements Autoproj.OutputChannel
{
    receivedLines : string[] = [];

    appendLine(msg: string) : void {
        this.receivedLines.push(msg);
    }

    clear() {
        this.receivedLines = [];
    }

};

export async function assertThrowsAsync(p, msg: RegExp) : Promise<Error>
{
    try {
        await p;
    }
    catch(e) {
        if (!msg.test(e.message)) {
            throw new Error(`expected message "${e.message}" to match "${msg}"`);
        }
        return e;
    }
    throw new Error("expected promise failure but it succeeded")
}

let root;
let createdFS : Array<Array<string>> = []

export function init(): string {
    root = Temp.mkdirSync();
    return root;
}

export function fullPath(...path : string[]): string {
    return Path.join(root, ...path);
}
export function mkdir(...path): string {
    let joinedPath = root;
    path.forEach((element) => {
        joinedPath = Path.join(joinedPath, element);
        if (!FS.existsSync(joinedPath))
        {
            FS.mkdirSync(joinedPath);
            createdFS.push([joinedPath, 'dir']);
        }
    })
    return joinedPath;
}
export function rmdir(...path) {
    let joinedPath = fullPath(...path);
    FS.rmdirSync(joinedPath);
}
export function mkfile(data: string, ...path): string {
    let joinedPath = fullPath(...path);
    FS.writeFileSync(joinedPath, data)
    createdFS.push([joinedPath, 'file']);
    return joinedPath;
}
export function registerDir(...path) {
    let joinedPath = fullPath(...path);
    createdFS.push([joinedPath, 'dir']);
}
export function registerFile(...path) {
    let joinedPath = fullPath(...path);
    createdFS.push([joinedPath, 'file']);
}
export function createInstallationManifest(data: any, ...workspacePath): string {
    let joinedPath = fullPath(...workspacePath);
    joinedPath = Autoproj.installationManifestPath(joinedPath);
    mkdir(...workspacePath, '.autoproj')
    FS.writeFileSync(joinedPath, YAML.safeDump(data));
    createdFS.push([joinedPath, 'file']);
    return joinedPath;
}
export function clear() {
    createdFS.reverse().forEach((entry) => {
        try {
            if (entry[1] === "file") {
                FS.unlinkSync(entry[0]);
            }
            else if (entry[1] === "dir") {
                FS.rmdirSync(entry[0]);
            }
        }
        catch(error) {
            if (!(error.message =~ /ENOENT/)) {
                throw error;
            }
        }
    })
    createdFS = []
    FS.rmdirSync(root)
    root = null
}

export function addPackageToManifest(ws, path : string[], partialInfo: { [key: string]: any } = {}) : Autoproj.Package {
    let partialVCS: { [key: string]: any } = partialInfo.vcs || {};
    let result: Autoproj.Package = {
        name: partialInfo.name || 'Unknown',
        srcdir: fullPath(...path),
        builddir: partialInfo.builddir || "Unknown",
        prefix: partialInfo.prefix || "Unknown",
        vcs: {
            url: partialVCS.url || "Unknown",
            type: partialVCS.type || "Unknown",
            repository_id: partialVCS.repository_id || "Unknown"
        },
        type: partialInfo.type || "Unknown",
        logdir: partialInfo.logdir || "Unknown",
        dependencies: partialInfo.dependencies || "Unknown"
    };

    let manifestPath = Autoproj.installationManifestPath(ws.root)
    let manifest = YAML.safeLoad(FS.readFileSync(manifestPath).toString()) as any[];
    manifest.push(result);
    FS.writeFileSync(manifestPath, YAML.safeDump(manifest));
    ws.reload();
    return result;
}

class ProcessMock extends EventEmitter implements Autoproj.Process
{
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    killSignal: string | undefined;
    kill(string) {
        this.killSignal = string;
        this.emit('exit', undefined, 2);
    }
};

export function createProcessMock() : ProcessMock
{
    return new ProcessMock();
}

export class TestSetup
{
    mockWrapper : TypeMoq.IMock<Wrappers.VSCode>;
    get wrapper()
    {
        return this.mockWrapper.object;
    }

    mockWorkspaces: TypeMoq.IMock<Autoproj.Workspaces>;
    get workspaces()
    {
        return this.mockWorkspaces.target;
    }

    mockTaskProvider : TypeMoq.IMock<Tasks.AutoprojProvider>;
    get taskProvider()
    {
        return this.mockTaskProvider.target;
    }

    mockContext : TypeMoq.IMock<Context.Context>;
    get context() : Context.Context
    {
        return this.mockContext.target;
    }

    mockOutputChannel : TypeMoq.IMock<OutputChannel>;
    get outputChannel() : OutputChannel
    {
        return this.mockOutputChannel.target;
    }

    constructor()
    {
        this.mockWrapper = TypeMoq.Mock.ofType<Wrappers.VSCode>();

        this.mockOutputChannel = TypeMoq.Mock.ofType2(OutputChannel, []);
        this.mockWorkspaces = TypeMoq.Mock.ofType2(Autoproj.Workspaces, [undefined, this.outputChannel]);
        this.mockTaskProvider = TypeMoq.Mock.ofType2(Tasks.AutoprojProvider, [this.workspaces]);
        this.mockContext = TypeMoq.Mock.ofType2(Context.Context, [this.wrapper, this.workspaces, this.outputChannel]);
    }

    setupWrapper(fn) {
        return this.mockWrapper.setup(fn);
    }

    createWorkspace(...path : string[]) : string {
        let wsPath = fullPath(...path);
        createInstallationManifest([], ...path);
        return wsPath;
    }

    createAndRegisterWorkspace(...path: string[]) {
        let wsPath = this.createWorkspace(...path);
        let mock = TypeMoq.Mock.ofType2(Autoproj.Workspace, [wsPath, false, this.outputChannel]);
        this.workspaces.add(mock.target);
        return { mock: mock, ws: mock.target };
    }

    addPackageToManifest(ws, path : string[], partialInfo: { [key: string]: any } = {}) : Autoproj.Package {
        return addPackageToManifest(ws, path, partialInfo);
    }
};
