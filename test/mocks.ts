import * as path from "path";
import { IMock, It, Mock } from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";

export function createTask(definition: vscode.TaskDefinition) {
    const mockTask = Mock.ofType<vscode.Task>();
    mockTask.setup((x: any) => x.then).returns(() => undefined);
    mockTask.setup((x) => x.definition).returns(() => definition);

    return mockTask;
}

export function createTaskExecution(task: vscode.Task) {
    const mockTaskExecution = Mock.ofType<vscode.TaskExecution>();
    mockTaskExecution.setup((x) => x.task).returns(() => task);

    return mockTaskExecution;
}

export function createTaskProcessStartEvent(definition: vscode.TaskDefinition, processId: number = 1111) {
    const task = createTask(definition).object;
    const taskExecution = createTaskExecution(task).object;
    const mockTaskProcessStartEvent = Mock.ofType<vscode.TaskProcessStartEvent>();

    mockTaskProcessStartEvent.setup((x) => x.execution).returns(() => taskExecution);
    mockTaskProcessStartEvent.setup((x) => x.processId).returns(() => processId);

    return mockTaskProcessStartEvent.object;
}

export function createTaskProcessEndEvent(definition: vscode.TaskDefinition, exitCode: number = 0) {
    const task = createTask(definition).object;
    const taskExecution = createTaskExecution(task).object;
    const mockTaskProcessEndEvent = Mock.ofType<vscode.TaskProcessEndEvent>();

    mockTaskProcessEndEvent.setup((x) => x.exitCode).returns(() => exitCode);
    mockTaskProcessEndEvent.setup((x) => x.execution).returns(() => taskExecution);

    return mockTaskProcessEndEvent.object;
}

export class MockWorkspaces {
    public readonly mock: IMock<autoproj.Workspaces>;

    private readonly mockWorkspace: Map<string, IMock<autoproj.Workspace>>;
    private readonly mockWorkspaceInfo: Map<string, IMock<autoproj.WorkspaceInfo>>;
    private folderToWorkspace: Map<string, autoproj.Workspace>;
    private workspaces: Map<string, autoproj.Workspace>;
    public constructor() {
        this.mockWorkspace = new Map();
        this.mockWorkspaceInfo = new Map();
        this.mock = Mock.ofType();

        this.folderToWorkspace = new Map();
        this.workspaces = new Map();

        this.mock.setup((x) => x.folderToWorkspace).returns(() => this.folderToWorkspace);
        this.mock.setup((x) => x.workspaces).returns(() => this.workspaces);
        this.mock.setup((x) => x.forEachFolder(It.isAny())).returns((callback) =>
            this.folderToWorkspace.forEach(callback));

        this.mock.setup((x) => x.forEachWorkspace(It.isAny())).returns((callback) =>
            this.workspaces.forEach(callback));
    }

    public get object() { return this.mock.object; }

    public addWorkspace(root: string): IMock<autoproj.Workspace> {
        const name = path.basename(root);
        const mockWorkspace = Mock.ofType<autoproj.Workspace>();

        mockWorkspace.setup((x: any) => x.then).returns(() => undefined);
        mockWorkspace.setup((x) => x.name).returns(() => name);
        mockWorkspace.setup((x) => x.root).returns(() => root);

        this.mockWorkspace.set(root, mockWorkspace);
        this.object.workspaces.set(root, mockWorkspace.object);
        return mockWorkspace;
    }

    public resetWorkspace(root: string) {
        let mockWs = this.mockWorkspace.get(root);

        if (!mockWs) {
            this.addWorkspace(root);
            mockWs = this.mockWorkspace.get(root)!;
        }

        const name = mockWs.object.name;

        mockWs.reset();
        mockWs.setup((x: any) => x.then).returns(() => undefined);
        mockWs.setup((x) => x.name).returns(() => name);
        mockWs.setup((x) => x.root).returns(() => root);

        return mockWs;
    }

    public createWorkspaceInfo(root: string) {
        const mockWs = this.resetWorkspace(root);
        const packages = new Map<string, autoproj.IPackage>();
        const packageSets = new Map<string, autoproj.IPackageSet>();

        const mockWsInfo = Mock.ofType<autoproj.WorkspaceInfo>();
        mockWsInfo.setup((x: any) => x.then).returns(() => undefined);
        mockWsInfo.setup((x) => x.path).returns(() => mockWs.object.root);
        mockWsInfo.setup((x) => x.packages).returns(() => packages);
        mockWsInfo.setup((x) => x.packageSets).returns(() => packageSets);

        mockWs.setup((x) => x.info()).returns(() => Promise.resolve(mockWsInfo.object));
        mockWs.setup((x) => x.reload()).returns(() => Promise.resolve(mockWsInfo.object));

        this.mockWorkspaceInfo.set(root, mockWsInfo);
    }

    public addPackageToWorkspace(pkgPath: string, wsRoot: string, name: string = path.relative(wsRoot, pkgPath)):
                                 IMock<autoproj.IPackage> {
        let mockWorkspace = this.mockWorkspace.get(wsRoot);
        let mockWsInfo = this.mockWorkspaceInfo.get(wsRoot);
        const mockPackage = Mock.ofType<autoproj.IPackage>();

        if (!mockWsInfo) {
            this.createWorkspaceInfo(wsRoot);
            mockWorkspace = this.mockWorkspace.get(wsRoot)!;
            mockWsInfo = this.mockWorkspaceInfo.get(wsRoot)!;
        }

        this.mock.setup((x) => x.getWorkspaceFromFolder(pkgPath)).returns(() => mockWorkspace!.object);
        this.object.folderToWorkspace.set(pkgPath, mockWorkspace!.object);

        mockWsInfo.setup((x) => x.findPackage(pkgPath)).returns(() => mockPackage.object);
        mockWsInfo.object.packages.set(pkgPath, mockPackage.object);

        mockPackage.setup((x) => x.name).returns(() => name);
        mockPackage.setup((x) => x.srcdir).returns(() => pkgPath);
        return mockPackage;
    }

    public invalidateWorkspaceInfo(root: string) {
        const mockWs = this.resetWorkspace(root);

        mockWs.setup((x) => x.info()).returns(() => Promise.reject(new Error("Invalid info")));
        mockWs.setup((x) => x.reload()).returns(() => Promise.reject(new Error("Invalid info")));

        this.mockWorkspaceInfo.delete(root);
    }

    public addPackageSetToWorkspace(pkgPath: string, wsRoot: string,
                                    name: string = path.basename(pkgPath)): IMock<autoproj.IPackageSet> {
        let mockWsInfo = this.mockWorkspaceInfo.get(wsRoot);
        const mockPackageSet = Mock.ofType<autoproj.IPackageSet>();

        if (!mockWsInfo) {
            this.createWorkspaceInfo(wsRoot);
            mockWsInfo = this.mockWorkspaceInfo.get(wsRoot)!;
        }

        mockWsInfo.setup((x) => x.findPackageSet(pkgPath)).returns(() => mockPackageSet.object);
        mockWsInfo.object.packageSets.set(pkgPath, mockPackageSet.object);

        mockPackageSet.setup((x) => x.name).returns(() => name);
        mockPackageSet.setup((x) => x.user_local_dir).returns(() => pkgPath);
        return mockPackageSet;
    }
}
