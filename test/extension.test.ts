"use strict";
import * as path from "path";
import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as cpptools from "../src/cpptools";
import * as extension from "../src/extension";
import * as tasks from "../src/tasks";
import * as watcher from "../src/watcher";
import * as wrappers from "../src/wrappers";
import * as mocks from "./mocks";

describe("EventHandler", () => {
    let mockWorkspaces: mocks.MockWorkspaces;
    let mockWrapper: IMock<wrappers.VSCode>;
    let mockWatcher: IMock<watcher.FileWatcher>;
    let mockCppConfigurationProvider: IMock<cpptools.CppConfigurationProvider>;
    let subject: extension.EventHandler;

    beforeEach(() => {
        mockWorkspaces = new mocks.MockWorkspaces();
        mockWrapper = Mock.ofType<wrappers.VSCode>();
        mockWatcher = Mock.ofType<watcher.FileWatcher>();
        mockCppConfigurationProvider = Mock.ofType<cpptools.CppConfigurationProvider>();
        subject = new extension.EventHandler(
            mockWrapper.object, mockWatcher.object, mockWorkspaces.object, mockCppConfigurationProvider.object
        );
    });
    describe("onDidStartTaskProcess()", () => {
        let taskProcessStartEvent: vscode.TaskProcessStartEvent;
        const taskDefinition: vscode.TaskDefinition = {
            mode: tasks.WorkspaceTaskMode.Watch,
            type: tasks.TaskType.Workspace,
            workspace: "/path/to/workspace",
        };

        beforeEach(() => {
            taskProcessStartEvent = mocks.createTaskProcessStartEvent(taskDefinition, 1234);
            mockWorkspaces.addWorkspace("/path/to/workspace");
        });
        it("associate 'autoproj watch' task's pid with a workspace root", async () => {
            subject.onDidStartTaskProcess(taskProcessStartEvent);
            subject.dispose();
            mockWrapper.verify((x) => x.killProcess(1234, "SIGINT"), Times.once());
        });
        it("ignore tasks that are not 'autoproj watch' tasks", async () => {
            taskDefinition.mode = "build";
            taskProcessStartEvent = mocks.createTaskProcessStartEvent(taskDefinition, 1234);
            subject.onDidStartTaskProcess(taskProcessStartEvent);
            subject.dispose();
            mockWrapper.verify((x) => x.killProcess(It.isAny(), It.isAny()), Times.never());
        });
        describe("dispose()", () => {
            it("ignores if killing a 'autoproj watch' task fails", () => {
                subject.onDidStartTaskProcess(taskProcessStartEvent);
                mockWrapper.setup((x) => x.killProcess(It.isAny(), It.isAny())).throws(new Error("test"));
                subject.dispose();
                mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            });
        });
    });
    describe("onManifestChanged()", () => {
        let mockWorkspace: IMock<autoproj.Workspace>;
        const wsRoot = "/path/to/workspace";
        beforeEach(() => {
            mockWorkspace = mockWorkspaces.addWorkspace(wsRoot);
        });
        it("reloads the given workspace", async () => {
            mockWorkspaces.createWorkspaceInfo(wsRoot);
            await subject.onManifestChanged(mockWorkspace.object);
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockWorkspace.verify((x) => x.reload(), Times.once());
        });
        it("reloads the given workspace and shows error message if it fails", async () => {
            mockWorkspaces.invalidateWorkspaceInfo(wsRoot);
            await subject.onManifestChanged(mockWorkspace.object);
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
            mockWorkspace.verify((x) => x.reload(), Times.once());
        });
    });
    describe("onWorkspaceFolderAdded()", () => {
        let mockWorkspace: IMock<autoproj.Workspace>;
        let mockWatchFunc: IMock<(ws: autoproj.Workspace) => void>;
        let task: vscode.Task;
        const wsRoot = "/path/to/workspace";
        const folder: vscode.WorkspaceFolder = {
            index: 0,
            name: "two",
            uri: vscode.Uri.file("/path/to/two"),
        };
        const taskDefinition: vscode.TaskDefinition = {
            mode: tasks.WorkspaceTaskMode.Watch,
            type: tasks.TaskType.Workspace,
            workspace: wsRoot,
        };
        beforeEach(() => {
            mockWorkspace = mockWorkspaces.addWorkspace(wsRoot);
            task = mocks.createTask(taskDefinition).object;
            mockWrapper.setup((x) => x.fetchTasks(tasks.WORKSPACE_TASK_FILTER)).
                returns(() => Promise.resolve([task]));
            mockWatchFunc = Mock.ofInstance(() => void 0);
            subject.watchManifest = mockWatchFunc.object;
        });
        it("loads installation manifest", async () => {
            mockWorkspaces.createWorkspaceInfo(wsRoot);
            mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: true, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), Times.once());
            mockWatchFunc.verify((x) => x(mockWorkspace.object), Times.once());
            // mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            // mockWrapper.verify((x) => x.executeTask(task), Times.once());
        });
        it("loads manifest and shows error if failure", async () => {
            mockWorkspaces.invalidateWorkspaceInfo(wsRoot);
            mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: true, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), Times.once());
            mockWatchFunc.verify((x) => x(mockWorkspace.object), Times.once());
            // mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
            // mockWrapper.verify((x) => x.executeTask(task), Times.once());
        });
        it("shows error message if watch task cannot be started", async () => {
            mockWrapper.reset();
            mockWorkspaces.createWorkspaceInfo(wsRoot);
            mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: true, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            // mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
        });
        it("does nothing if folder already in workspace", async () => {
            mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: false, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), Times.never());
            mockWatchFunc.verify((x) => x(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.fetchTasks(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.executeTask(It.isAny()), Times.never());
        });
        it("does nothing if folder not added", async () => {
            mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: false, workspace: null }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), Times.never());
            mockWatchFunc.verify((x) => x(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.fetchTasks(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.executeTask(It.isAny()), Times.never());
        });
    });
    describe("onWorkspaceFolderRemoved()", () => {
        const wsRoot = "/path/to/workspace";
        let mockWorkspace: IMock<autoproj.Workspace>;
        let mockUnwatchFunc: IMock<(ws: autoproj.Workspace) => void>;
        let taskProcessStartEvent: vscode.TaskProcessStartEvent;
        const taskDefinition: vscode.TaskDefinition = {
            mode: tasks.WorkspaceTaskMode.Watch,
            type: tasks.TaskType.Workspace,
            workspace: "/path/to/workspace",
        };

        const folder: vscode.WorkspaceFolder = {
            index: 0,
            name: "two",
            uri: vscode.Uri.file("/path/to/two"),
        };
        beforeEach(() => {
            mockWorkspace = mockWorkspaces.addWorkspace(wsRoot);
            taskProcessStartEvent = mocks.createTaskProcessStartEvent(taskDefinition, 1234);
            mockUnwatchFunc = Mock.ofInstance(() => void 0);
            subject.onDidStartTaskProcess(taskProcessStartEvent);
            subject.unwatchManifest = mockUnwatchFunc.object;
        });
        it("de-registers the folder", async () => {
            mockWorkspaces.mock.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => null);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify((x) => x(mockWorkspace.object), Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.killProcess(1234, "SIGINT"), Times.never());
        });
        it("de-registers the folder and stops the watcher", async () => {
            mockWorkspaces.mock.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => mockWorkspace.object);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify((x) => x(mockWorkspace.object), Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.killProcess(1234, "SIGINT"), Times.once());
        });
        it("de-registers the folder, stops the watcher and ignores killProcess() failure", async () => {
            mockWorkspaces.mock.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => mockWorkspace.object);
            mockWrapper.setup((x) => x.killProcess(1234, "SIGINT")).throws(new Error("test"));
            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify((x) => x(mockWorkspace.object), Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
        });
        it("does nothing if there was no watch task pid for the folder", async () => {
            mockWorkspace.reset();
            mockWorkspace.setup((x) => x.root).returns(() => "/some/other/path");
            mockWorkspaces.mock.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => mockWorkspace.object);
            await subject.onWorkspaceFolderRemoved(folder);
            mockWrapper.verify((x) => x.killProcess(It.isAny(), It.isAny()), Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
        });
    });
    describe("watchManifest()", () => {
        const wsRoot = "/path/to/workspace";
        let mockWorkspace: IMock<autoproj.Workspace>;
        const originalInstallationManifestPathFunc = require("../src/autoproj").installationManifestPath;
        let mockInstallationManifestPathFunc: IMock<(path: string) => string>;
        let mockOnManifestChangedFunc: IMock<(ws: autoproj.Workspace) => Promise<void>>;
        const installManifestPath: string = path.join(wsRoot, ".autoproj", "installation-manifest");
        let watcherCb: (filePath: string) => void;

        beforeEach(() => {
            mockWorkspace = mockWorkspaces.addWorkspace(wsRoot);
            mockInstallationManifestPathFunc = Mock.ofType<(root: string) => string>();
            mockInstallationManifestPathFunc.setup((x) => x(wsRoot)).returns(() => installManifestPath);
            mockOnManifestChangedFunc = Mock.ofInstance(() => Promise.resolve());

            subject.onManifestChanged = mockOnManifestChangedFunc.object;
            Object.defineProperty(
                require("../src/autoproj"), "installationManifestPath", mockInstallationManifestPathFunc.object);
        });
        afterEach(() => {
            Object.defineProperty(
                require("../src/autoproj"), "installationManifestPath", originalInstallationManifestPathFunc);
        });
        it("watches the manifest with proper callback", async () => {
            mockWatcher.setup((x) => x.startWatching(installManifestPath, It.isAny())).callback(
                (filePath: string, callback: (filePath: string) => void) => watcherCb = callback,
            ).returns(() => true);

            await subject.watchManifest(mockWorkspace.object);
            watcherCb!(installManifestPath);
            mockWatcher.verify((x) => x.startWatching(installManifestPath, It.isAny()), Times.once());
            mockOnManifestChangedFunc.verify((x) => x(mockWorkspace.object), Times.once());
        });
        it("watches the manifest and shows error if failure", async () => {
            mockWatcher.setup((x) => x.startWatching(installManifestPath, It.isAny())).
                throws(new Error("test"));

            await subject.watchManifest(mockWorkspace.object);
            mockWatcher.verify((x) => x.startWatching(installManifestPath, It.isAny()), Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
        });
    });
    describe("unwatchManifest()", () => {
        let mockWorkspace: IMock<autoproj.Workspace>;
        let mockInstallationManifestPathFunc: IMock<(path: string) => string>;
        const wsRoot = "/path/to/workspace";
        const originalInstallationManifestPathFunc = require("../src/autoproj").installationManifestPath;
        const installManifestPath: string = path.join(wsRoot, ".autoproj", "installation-manifest");

        beforeEach(() => {
            mockWorkspace = mockWorkspaces.addWorkspace(wsRoot);
            mockInstallationManifestPathFunc = Mock.ofType<(root: string) => string>();
            mockInstallationManifestPathFunc.setup((x) => x(wsRoot)).returns(() => installManifestPath);
            Object.defineProperty(
                require("../src/autoproj"), "installationManifestPath", mockInstallationManifestPathFunc.object);
        });
        afterEach(() => {
            Object.defineProperty(
                require("../src/autoproj"), "installationManifestPath", originalInstallationManifestPathFunc);
        });
        it("unwatches the manifest", async () => {
            mockWatcher.setup((x) => x.stopWatching(installManifestPath)).returns(() => true);
            await subject.unwatchManifest(mockWorkspace.object);
            mockWatcher.verify((x) => x.stopWatching(installManifestPath), Times.once());
        });
        it("unwatches the manifest and shows error if failure", async () => {
            mockWatcher.setup((x) => x.stopWatching(installManifestPath)).throws(new Error("test"));
            await subject.unwatchManifest(mockWorkspace.object);
            mockWatcher.verify((x) => x.stopWatching(installManifestPath), Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
        });
    });
    describe("onDidOpenTextDocument", () => {
        beforeEach(() => {
            mockWorkspaces.addWorkspace("/a/foo/workspace");
            mockWorkspaces.addWorkspace("/path/to/workspace");
        });
        it("changes the document language if file name starts with 'manifest.'", () => {
            const event = mocks.createOpenTextDocumentEvent("/path/to/workspace/autoproj/manifest.robot");
            subject.onDidOpenTextDocument(event);
            mockWrapper.verify((x) => x.setTextDocumentLanguage(event, "yaml"), Times.once());
        });
        it("keeps the document language", () => {
            const event = mocks.createOpenTextDocumentEvent("/path/to/workspace/autoproj/init.rb");
            subject.onDidOpenTextDocument(event);
            mockWrapper.verify((x) => x.setTextDocumentLanguage(It.isAny(), It.isAny()), Times.never());
        });
    });
});

describe("extension.setupExtension()", () => {
    it("sets up extension", () => {
        const mockWrapper = Mock.ofType<wrappers.VSCode>();
        const subscriptions: any[] = [];

        extension.setupExtension(subscriptions, mockWrapper.object);
    });
});
