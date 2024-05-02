"use strict";

import * as FS from "fs";
import * as YAML from "js-yaml";
import * as os from "os";
import * as Path from "path";
import * as TypeMoq from "typemoq";
import * as Autoproj from "../src/autoproj";
import * as Wrappers from "../src/wrappers";

export async function assertThrowsAsync(p, msg: RegExp): Promise<Error> {
    try {
        await p;
    } catch (e) {
        if (!msg.test(e.message)) {
            throw new Error(`expected message "${e.message}" to match "${msg}"`);
        }
        return e;
    }
    throw new Error("expected promise failure but it succeeded");
}

let root;
let createdFS: string[][] = [];

export function init(): string {
    if (root) {
        throw new Error("Heleprs already initialized");
    }

    root = FS.mkdtempSync(Path.join(os.tmpdir(), "vscode-autoproj"));
    return root;
}

export function fullPath(...path: string[]): string {
    return Path.join(root, ...path);
}
export function mkdir(...path): string {
    let joinedPath = root;
    path.forEach((element) => {
        joinedPath = Path.join(joinedPath, element);
        if (!FS.existsSync(joinedPath)) {
            FS.mkdirSync(joinedPath);
            createdFS.push([joinedPath, "dir"]);
        }
    });
    return joinedPath;
}
export function rmdir(...path) {
    const joinedPath = fullPath(...path);
    FS.rmdirSync(joinedPath);
}
export function mkfile(data: string, ...path): string {
    const joinedPath = fullPath(...path);
    FS.writeFileSync(joinedPath, data);
    createdFS.push([joinedPath, "file"]);
    return joinedPath;
}
export function registerDir(...path) {
    const joinedPath = fullPath(...path);
    createdFS.push([joinedPath, "dir"]);
}
export function registerFile(...path) {
    const joinedPath = fullPath(...path);
    createdFS.push([joinedPath, "file"]);
}
export function createInstallationManifest(data: any, ...workspacePath): string {
    let joinedPath = fullPath(...workspacePath);
    joinedPath = Autoproj.installationManifestPath(joinedPath);
    mkdir(...workspacePath, ".autoproj");
    FS.writeFileSync(joinedPath, YAML.dump(data));
    createdFS.push([joinedPath, "file"]);
    return joinedPath;
}
export function clear() {
    createdFS.reverse().forEach((entry) => {
        try {
            if (entry[1] === "file") {
                FS.unlinkSync(entry[0]);
            } else if (entry[1] === "dir") {
                FS.rmdirSync(entry[0]);
            }
        } catch (error) {
            if (!(error.code === "ENOENT")) {
                throw error;
            }
        }
    });
    createdFS = [];
    FS.rmdirSync(root);
    root = null;
}

export function addPackageToManifest(ws, path: string[], partialInfo: { [key: string]: any } = {}): Autoproj.IPackage {
    const partialVCS: { [key: string]: any } = partialInfo.vcs || {};
    const result: Autoproj.IPackage = {
        builddir: partialInfo.builddir || "Unknown",
        dependencies: partialInfo.dependencies || "Unknown",
        logdir: partialInfo.logdir || "Unknown",
        name: partialInfo.name || "Unknown",
        prefix: partialInfo.prefix || "Unknown",
        srcdir: fullPath(...path),
        type: partialInfo.type || "Unknown",
        vcs: {
            repository_id: partialVCS.repository_id || "Unknown",
            type: partialVCS.type || "Unknown",
            url: partialVCS.url || "Unknown",
        },

    };

    const manifestPath = Autoproj.installationManifestPath(ws.root);
    const manifest = YAML.load(FS.readFileSync(manifestPath).toString()) as any[];
    manifest.push(result);
    FS.writeFileSync(manifestPath, YAML.dump(manifest));
    ws.reload();
    return result;
}

export class TestSetup {
    public mockWrapper: TypeMoq.IMock<Wrappers.VSCode>;
    get wrapper() {
        return this.mockWrapper.object;
    }

    public mockWorkspaces: TypeMoq.IMock<Autoproj.Workspaces>;
    get workspaces() {
        return this.mockWorkspaces.target;
    }

    constructor() {
        this.mockWrapper = TypeMoq.Mock.ofType<Wrappers.VSCode>();
        this.mockWorkspaces = TypeMoq.Mock.ofType2(Autoproj.Workspaces, [undefined]);
    }

    public setupWrapper(fn) {
        return this.mockWrapper.setup(fn);
    }

    public createWorkspace(...path: string[]): string {
        const wsPath = fullPath(...path);
        createInstallationManifest([], ...path);
        return wsPath;
    }

    public createAndRegisterWorkspace(...path: string[]) {
        const wsPath = this.createWorkspace(...path);
        const mock = TypeMoq.Mock.ofType2(Autoproj.Workspace, [wsPath, false]);
        this.workspaces.add(mock.target);
        return { mock, ws: mock.target };
    }

    public addPackageToManifest(ws, path: string[], partialInfo: { [key: string]: any } = {}): Autoproj.IPackage {
        return addPackageToManifest(ws, path, partialInfo);
    }
}
