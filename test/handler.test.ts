import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as progress from "../src/progress";
import * as tasks from "../src/tasks";
import * as wrappers from "../src/wrappers";

describe("tasks Handler", () => {
    let mockWrapper: IMock<wrappers.VSCode>;
    let mockWorkspaces: IMock<autoproj.Workspaces>;
    let mockFactory: IMock<typeof progress.createProgressView>;

    let originalFactory: typeof progress.createProgressView;
    let subject: tasks.Handler;

    beforeEach(() => {
        originalFactory = progress.createProgressView;

        mockWrapper = Mock.ofType<wrappers.VSCode>();
        mockWorkspaces = Mock.ofType<autoproj.Workspaces>();
        mockFactory = Mock.ofInstance(progress.createProgressView);

        require("../src/progress").createProgressView = mockFactory.object;
        subject = new tasks.Handler(mockWrapper.object, mockWorkspaces.object);
    });

    afterEach(() => {
        require("../src/progress").createProgressView = originalFactory;
    });
    function createTaskProcessStartEvent(definition: vscode.TaskDefinition) {
        const mockTaskProcessStartEvent = Mock.ofType<vscode.TaskProcessStartEvent>();
        const mockTaskExecution = Mock.ofType<vscode.TaskExecution>();
        const mockTask = Mock.ofType<vscode.Task>();

        mockTask.setup((x) => x.definition).returns(() => definition);
        mockTaskProcessStartEvent.setup((x) => x.execution).returns(() => mockTaskExecution.object);
        mockTaskExecution.setup((x) => x.task).returns(() => mockTask.object);

        return mockTaskProcessStartEvent.object;
    }
    async function testTaskView(task: { mode: tasks.PackageTaskMode | tasks.WorkspaceTaskMode, title: string },
                                definition: tasks.ITaskDefinition) {
        const mockView = Mock.ofType<progress.ProgressView>();
        const event = createTaskProcessStartEvent(definition);

        mockFactory.setup((x) => x(mockWrapper.object, task.title)).returns(() => mockView.object);

        await subject.onDidStartTaskProcess(event);
        mockFactory.verify((x) => x(mockWrapper.object, task.title), Times.once());
        mockView.verify((x) => x.show(), Times.once());
    }
    describe("onDidStartTaskProcess()", () => {
        it("shows a progress view for package tasks", async () => {
            const packageTasks = [
                { mode: tasks.PackageTaskMode.Build, title: "Building package..." },
                { mode: tasks.PackageTaskMode.BuildNoDeps, title: "Building package (no dependencies)..." },
                { mode: tasks.PackageTaskMode.Checkout, title: "Checking out package..." },
                { mode: tasks.PackageTaskMode.ForceBuild, title: "Building package (force)..." },
                { mode: tasks.PackageTaskMode.Rebuild, title: "Building package (rebuild)..." },
                { mode: tasks.PackageTaskMode.Update, title: "Updating package (and its dependencies)..." },
            ];
            for (const packageTask of packageTasks) {
                const definition: tasks.IPackageTaskDefinition = {
                    mode: packageTask.mode,
                    path: "/path/to/workspace/package",
                    type: tasks.TaskType.Package,
                    workspace: "/path/to/workspace",
                };
                testTaskView(packageTask, definition);
            }
        });
        function setWorkspaceName(root: string, name: string) {
            const workspaces = new Map<string, autoproj.Workspace>();
            const mockWorkspace = Mock.ofType<autoproj.Workspace>();

            mockWorkspaces.setup((x) => x.workspaces).returns(() => workspaces);
            mockWorkspace.setup((x) => x.name).returns(() => name);
            workspaces.set(root, mockWorkspace.object);
        }
        it("shows a progress view for workspace tasks", async () => {
            const workspaceTasks = [
                { mode: tasks.WorkspaceTaskMode.Build, title: "workspace: Building all packages..." },
                { mode: tasks.WorkspaceTaskMode.Checkout, title: "workspace: Checking out all packages..." },
                { mode: tasks.WorkspaceTaskMode.Osdeps, title: "workspace: Installing OS dependencies..." },
                { mode: tasks.WorkspaceTaskMode.Update, title: "workspace: Updating all packages..." },
                { mode: tasks.WorkspaceTaskMode.UpdateConfig, title: "workspace: Updating build configuration..." },
                { mode: tasks.WorkspaceTaskMode.UpdateEnvironment, title: "workspace: Updating environment..." },
            ];

            setWorkspaceName("/path/to/workspace", "workspace");

            for (const workspaceTask of workspaceTasks) {
                const definition: tasks.IWorkspaceTaskDefinition = {
                    mode: workspaceTask.mode,
                    type: tasks.TaskType.Workspace,
                    workspace: "/path/to/workspace",
                };
                testTaskView(workspaceTask, definition);
            }
        });
        function setPackageName(path: string, name: string) {
            const mockWorkspace = Mock.ofType<autoproj.Workspace>();
            const mockWsInfo = Mock.ofType<autoproj.WorkspaceInfo>();
            const mockPackage = Mock.ofType<autoproj.IPackage>();

            mockWsInfo.setup((x: any) => x.then).returns(() => undefined);
            mockWorkspaces.setup((x) => x.getWorkspaceFromFolder(path)).returns(() => mockWorkspace.object);
            mockWorkspace.setup((x) => x.info()).returns(() => Promise.resolve(mockWsInfo.object));
            mockWsInfo.setup((x) => x.findPackage(path)).returns(() => mockPackage.object);
            mockPackage.setup((x) => x.name).returns(() => "foobar");
        }
        it("gets package name from package definition", () => {
            const packageTask = { mode: tasks.PackageTaskMode.Build, title: "Building foobar..." };
            const definition: tasks.IPackageTaskDefinition = {
                mode: packageTask.mode,
                path: "/path/to/workspace/package",
                type: tasks.TaskType.Package,
                workspace: "/path/to/workspace",
            };
            setPackageName("/path/to/workspace/package", "foobar");
            testTaskView(packageTask, definition);
        });
        it("does nothing if task is not an autoproj task", async () => {
            const task: vscode.TaskDefinition = { type: "someTask" };
            const startEvent = createTaskProcessStartEvent(task);
            await subject.onDidStartTaskProcess(startEvent);
            mockFactory.verify((x) => x(It.isAny(), It.isAny()), Times.never());
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
            mockFactory.setup((x) => x(mockWrapper.object, packageTask.title)).returns(() => mockView.object);

            const startEvent = createTaskProcessStartEvent(definition);
            await subject.onDidStartTaskProcess(startEvent);

            definitions.push(definition);
            mockViews.push(mockView);
        }
        return { definitions, mockViews };
    }
    describe("onDidEndTaskProcess()", () => {
        function createTaskProcessEndEvent(definition: vscode.TaskDefinition) {
            const mockTaskProcessEndEvent = Mock.ofType<vscode.TaskProcessEndEvent>();
            const mockTaskExecution = Mock.ofType<vscode.TaskExecution>();
            const mockTask = Mock.ofType<vscode.Task>();

            mockTask.setup((x) => x.definition).returns(() => definition);
            mockTaskProcessEndEvent.setup((x) => x.execution).returns(() => mockTaskExecution.object);
            mockTaskExecution.setup((x) => x.task).returns(() => mockTask.object);

            return mockTaskProcessEndEvent.object;
        }
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
