import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";
import * as progress from "../src/progress";
import * as tasks from "../src/tasks";
import * as wrappers from "../src/wrappers";
import * as mocks from "./mocks";

describe("tasks Handler", () => {
    let mockWrapper: IMock<wrappers.VSCode>;
    let mockFactory: IMock<typeof progress.createProgressView>;

    let mockWorkspaces: mocks.MockWorkspaces;
    let originalFactory: typeof progress.createProgressView;
    let subject: tasks.Handler;

    beforeEach(() => {
        originalFactory = progress.createProgressView;

        mockWrapper = Mock.ofType<wrappers.VSCode>();
        mockFactory = Mock.ofInstance(progress.createProgressView);

        mockWorkspaces = new mocks.MockWorkspaces();
        require("../src/progress").createProgressView = mockFactory.object;
        subject = new tasks.Handler(mockWrapper.object, mockWorkspaces.object);
    });

    afterEach(() => {
        require("../src/progress").createProgressView = originalFactory;
    });
    async function testTaskView(task: { mode: tasks.PackageTaskMode | tasks.WorkspaceTaskMode, title: string },
                                definition: tasks.ITaskDefinition) {
        const mockView = Mock.ofType<progress.ProgressView>();
        const event = mocks.createTaskProcessStartEvent(definition);

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
                await testTaskView(packageTask, definition);
            }
        });
        it("shows a progress view for workspace tasks", async () => {
            const workspaceTasks = [
                { mode: tasks.WorkspaceTaskMode.Build, title: "workspace: Building all packages..." },
                { mode: tasks.WorkspaceTaskMode.Checkout, title: "workspace: Checking out all packages..." },
                { mode: tasks.WorkspaceTaskMode.Osdeps, title: "workspace: Installing OS dependencies..." },
                { mode: tasks.WorkspaceTaskMode.Update, title: "workspace: Updating all packages..." },
                { mode: tasks.WorkspaceTaskMode.UpdateConfig, title: "workspace: Updating build configuration..." },
            ];

            mockWorkspaces.addWorkspace("/path/to/workspace");

            for (const workspaceTask of workspaceTasks) {
                const definition: tasks.IWorkspaceTaskDefinition = {
                    mode: workspaceTask.mode,
                    type: tasks.TaskType.Workspace,
                    workspace: "/path/to/workspace",
                };
                await testTaskView(workspaceTask, definition);
            }
        });
        it("gets package name from package definition", async () => {
            const packageTask = { mode: tasks.PackageTaskMode.Build, title: "Building foobar..." };
            const definition: tasks.IPackageTaskDefinition = {
                mode: packageTask.mode,
                path: "/path/to/workspace/package",
                type: tasks.TaskType.Package,
                workspace: "/path/to/workspace",
            };

            mockWorkspaces.addPackageToWorkspace("/path/to/workspace/package", "/path/to/workspace", "foobar");
            await testTaskView(packageTask, definition);
        });
        it("does nothing if task is not an autoproj task", async () => {
            const task: vscode.TaskDefinition = { type: "someTask" };
            const startEvent = mocks.createTaskProcessStartEvent(task);
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

            const startEvent = mocks.createTaskProcessStartEvent(definition);
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
                const endEvent = mocks.createTaskProcessEndEvent(definition);
                subject.onDidEndTaskProcess(endEvent);
            }
            mockViews.forEach((view) => view.verify((x) => x.close(), Times.once()));
        });
        it("does nothing if task is not an autoproj task", async () => {
            const { mockViews } = await startTestTasks();
            const definition: vscode.TaskDefinition = { type: "someTask" };
            const endEvent = mocks.createTaskProcessEndEvent(definition);
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
