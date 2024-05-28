import { IMock, It, Mock, Times } from "typemoq";
import * as autoproj from "../src/autoproj";
import * as vscode from "vscode";
import * as progress from "../src/progress";
import * as tasks from "../src/tasks";
import { Mocks, WorkspaceBuilder } from "./helpers";
import { using } from "./using";

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

describe("tasks Handler", () => {
    let mocks: Mocks;
    let builder: WorkspaceBuilder;
    let workspace: autoproj.Workspace;
    let workspaces: autoproj.Workspaces;
    let pkg: autoproj.IPackage;
    let subject: tasks.Handler;

    beforeEach(() => {
        builder = new WorkspaceBuilder();
        mocks = new Mocks();
        pkg = builder.addPackage("foobar");
        workspaces = new autoproj.Workspaces();
        workspace = builder.workspace;
        workspaces.add(workspace);
        workspaces.addFolder(pkg.srcdir);
        subject = new tasks.Handler(workspaces);
        using(mocks.createProgressView);
    });
    async function testTaskView(task: { mode: tasks.PackageTaskMode | tasks.WorkspaceTaskMode, title: string },
                                definition: tasks.ITaskDefinition) {
        const mockView = Mock.ofType<progress.ProgressView>();
        const event = createTaskProcessStartEvent(definition);

        mocks.createProgressView.setup((x) => x(task.title)).returns(() => mockView.object);

        await subject.onDidStartTaskProcess(event);
        mocks.createProgressView.verify((x) => x(task.title), Times.once());
        mockView.verify((x) => x.show(), Times.once());
    }
    describe("onDidStartTaskProcess()", () => {
        it("shows a progress view for package tasks", async () => {
            const packageTasks = [
                { mode: tasks.PackageTaskMode.Build, title: `Building ${pkg.name}...` },
                { mode: tasks.PackageTaskMode.BuildNoDeps, title: `Building foobar (no dependencies)...` },
                { mode: tasks.PackageTaskMode.Checkout, title: `Checking out ${pkg.name}...` },
                { mode: tasks.PackageTaskMode.ForceBuild, title: `Building ${pkg.name} (force)...` },
                { mode: tasks.PackageTaskMode.Rebuild, title: `Building ${pkg.name} (rebuild)...` },
                { mode: tasks.PackageTaskMode.Update, title: `Updating ${pkg.name} (and its dependencies)...` },
            ];
            for (const packageTask of packageTasks) {
                const definition: tasks.IPackageTaskDefinition = {
                    mode: packageTask.mode,
                    path: pkg.srcdir,
                    type: tasks.TaskType.Package,
                    workspace: workspace.root,
                };
                await testTaskView(packageTask, definition);
            }
        });
        it("shows a progress view for workspace tasks", async () => {
            const workspaceTasks = [
                { mode: tasks.WorkspaceTaskMode.Build, title: `${workspace.name}: Building all packages...` },
                { mode: tasks.WorkspaceTaskMode.Checkout, title: `${workspace.name}: Checking out all packages...` },
                { mode: tasks.WorkspaceTaskMode.Osdeps, title: `${workspace.name}: Installing OS dependencies...` },
                { mode: tasks.WorkspaceTaskMode.Update, title: `${workspace.name}: Updating all packages...` },
                { mode: tasks.WorkspaceTaskMode.UpdateConfig, title: `${workspace.name}: Updating build configuration...` },
            ];

            for (const workspaceTask of workspaceTasks) {
                const definition: tasks.IWorkspaceTaskDefinition = {
                    mode: workspaceTask.mode,
                    type: tasks.TaskType.Workspace,
                    workspace: workspace.root,
                };
                await testTaskView(workspaceTask, definition);
            }
        });
        it("gets package name from package definition", async () => {
            const packageTask = { mode: tasks.PackageTaskMode.Build, title: "Building foobar..." };
            const definition: tasks.IPackageTaskDefinition = {
                mode: packageTask.mode,
                path: pkg.srcdir,
                type: tasks.TaskType.Package,
                workspace: workspace.root,
            };

            await testTaskView(packageTask, definition);
        });
        it("does nothing if task is not an autoproj task", async () => {
            const task: vscode.TaskDefinition = { type: "someTask" };
            const startEvent = createTaskProcessStartEvent(task);
            await subject.onDidStartTaskProcess(startEvent);
            mocks.createProgressView.verify((x) => x(It.isAny()), Times.never());
        });
    });
    async function startTestTasks() {
        const mockViews = Array<IMock<progress.ProgressView>>();
        const definitions: tasks.ITaskDefinition[] = [];
        const packageTasks = [
            { mode: tasks.PackageTaskMode.Build, title: "Building package..." },
            { mode: tasks.PackageTaskMode.Checkout, title: "Checking out package..." },
        ];
        for (const packageTask of packageTasks) {
            const mockView = Mock.ofType<progress.ProgressView>();
            const definition: tasks.IPackageTaskDefinition = {
                mode: packageTask.mode,
                path: "/path/to/workspace/package",
                type: tasks.TaskType.Package,
                workspace: "/path/to/workspace",
            };
            mocks.createProgressView.setup((x) => x(packageTask.title)).returns(() => mockView.object);

            const startEvent = createTaskProcessStartEvent(definition);
            await subject.onDidStartTaskProcess(startEvent);

            definitions.push(definition);
            mockViews.push(mockView);
        }
        return { definitions, mockViews };
    }
    describe("onDidEndTaskProcess()", () => {
        it("closes views when tasks ends", async () => {
            const { definitions, mockViews } = await startTestTasks();
            for (const definition of definitions) {
                const endEvent = createTaskProcessEndEvent(definition);
                subject.onDidEndTaskProcess(endEvent);
            }
            mockViews.forEach((view) => view.verify((x) => x.close(), Times.once()));
        });
        it("does nothing if task is not an autoproj task", async () => {
            const { mockViews } = await startTestTasks();
            const definition: vscode.TaskDefinition = { type: "someTask" };
            const endEvent = createTaskProcessEndEvent(definition);
            subject.onDidEndTaskProcess(endEvent);
            mockViews.forEach((view) => view.verify((x) => x.close(), Times.never()));
        });
    });
    describe("dipose()", () => {
        it("closes all views", async () => {
            const { mockViews } = await startTestTasks();
            subject.dispose();
            mockViews.forEach((view) => view.verify((x) => x.close(), Times.once()));
        });
    });
});
