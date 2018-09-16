"use strict";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as extension from "../src/extension";
import * as watcher from "../src/watcher";
import * as wrappers from "../src/wrappers";

describe("EventHandler", () => {
    let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockWatcher: TypeMoq.IMock<watcher.FileWatcher>;
    let subject: extension.EventHandler;

    beforeEach(() => {
        mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockWatcher = TypeMoq.Mock.ofType<watcher.FileWatcher>();
        subject = new extension.EventHandler(mockWrapper.object, mockWatcher.object, mockWorkspaces.object);
    });
    describe("onManifestChanged()", () => {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockInfo: TypeMoq.IMock<autoproj.WorkspaceInfo>;
        beforeEach(() => {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockInfo = TypeMoq.Mock.ofType<autoproj.WorkspaceInfo>();
            mockInfo.setup((x: any) => x.then).returns(() => undefined);
        });
        it("reloads the given workspace", async () => {
            mockWorkspace.setup((x) => x.reload()).returns(() => Promise.resolve(mockInfo.object));
            await subject.onManifestChanged(mockWorkspace.object);
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWorkspace.verify((x) => x.reload(), TypeMoq.Times.once());
        });
        it("reloads the given workspace and shows error message if it fails", async () => {
            mockWorkspace.setup((x) => x.reload()).returns(() => Promise.reject(new Error("test")));
            await subject.onManifestChanged(mockWorkspace.object);
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWorkspace.verify((x) => x.reload(), TypeMoq.Times.once());
        });
    });
    describe("onWorkspaceFolderAdded()", () => {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockWatchFunc: TypeMoq.IMock<(ws: autoproj.Workspace) => void>;
        let mockInfo: TypeMoq.IMock<autoproj.WorkspaceInfo>;
        const folder: vscode.WorkspaceFolder = {
            index: 0,
            name: "two",
            uri: vscode.Uri.file("/path/to/two"),
        };
        beforeEach(() => {
            mockInfo = TypeMoq.Mock.ofType<autoproj.WorkspaceInfo>();
            mockInfo.setup((x: any) => x.then).returns(() => undefined);
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup((x) => x.name).returns(() => "dev");
            mockWatchFunc = TypeMoq.Mock.ofInstance(() => {
                // no-op
            });
            subject.watchManifest = mockWatchFunc.object;
        });
        it("loads installation manifest", async () => {
            mockWorkspace.setup((x) => x.info()).returns(() => Promise.resolve(mockInfo.object));
            mockWorkspaces.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: true, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), TypeMoq.Times.once());
            mockWatchFunc.verify((x) => x(mockWorkspace.object), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify((x) => x.executeCommand("workbench.action.tasks.runTask", `autoproj: dev: Watch`),
                TypeMoq.Times.once());
        });
        it("loads manifest and shows error if failure", async () => {
            mockWorkspace.setup((x) => x.info()).returns(() => Promise.reject(new Error("test")));
            mockWorkspaces.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: true, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), TypeMoq.Times.once());
            mockWatchFunc.verify((x) => x(mockWorkspace.object), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.executeCommand("workbench.action.tasks.runTask", `autoproj: dev: Watch`),
                TypeMoq.Times.once());
        });
        it("does nothing if folder already in workspace", async () => {
            mockWorkspaces.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: false, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), TypeMoq.Times.never());
            mockWatchFunc.verify((x) => x(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify((x) => x.executeCommand(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
        });
        it("does nothing if folder not added", async () => {
            mockWorkspaces.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: false, workspace: null }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), TypeMoq.Times.never());
            mockWatchFunc.verify((x) => x(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify((x) => x.executeCommand(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
        });
    });
    describe("onWorkspaceFolderRemoved()", () => {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockUnwatchFunc: TypeMoq.IMock<(ws: autoproj.Workspace) => void>;
        const folder: vscode.WorkspaceFolder = {
            index: 0,
            name: "two",
            uri: vscode.Uri.file("/path/to/two"),
        };
        beforeEach(() => {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup((x) => x.readWatchPID()).returns(() => Promise.resolve(1234));
            mockUnwatchFunc = TypeMoq.Mock.ofInstance(() => {
                // no-op
            });
            subject.unwatchManifest = mockUnwatchFunc.object;
        });
        it("de-registers the folder", async () => {
            mockWorkspaces.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => null);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify((x) => x(mockWorkspace.object), TypeMoq.Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify((x) => x.killProcess(1234, "SIGINT"), TypeMoq.Times.never());
        });
        it("de-registers the folder and stops the watcher", async () => {
            mockWorkspaces.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => mockWorkspace.object);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify((x) => x(mockWorkspace.object), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify((x) => x.killProcess(1234, "SIGINT"), TypeMoq.Times.once());
        });
        it("de-registers the folder, stops the watcher and shows an error message", async () => {
            mockWorkspace.reset();
            mockWorkspace.setup((x) => x.readWatchPID()).returns(() => Promise.reject(new Error("test")));
            mockWorkspaces.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => mockWorkspace.object);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify((x) => x(mockWorkspace.object), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.killProcess(1234, "SIGINT"), TypeMoq.Times.never());
        });
    });
    describe("watchManifest()", () => {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        const originalInstallationManifestPathFunc = require("../src/autoproj").installationManifestPath;
        let mockInstallationManifestPathFunc: TypeMoq.IMock<(path: string) => string>;
        let mockOnManifestChangedFunc: TypeMoq.IMock<(ws: autoproj.Workspace) => Promise<void>>;
        const installManifestPath: string = "/path/to/workspace/.autoproj/installation-manifest";
        let watcherCb: (filePath: string) => void;

        beforeEach(() => {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup((x) => x.root).returns(() => "/path/to/workspace");
            mockInstallationManifestPathFunc = TypeMoq.Mock.ofType<(root: string) => string>();
            mockInstallationManifestPathFunc.setup((x) => x("/path/to/workspace")).returns(() => installManifestPath);
            mockOnManifestChangedFunc = TypeMoq.Mock.ofInstance(() => Promise.resolve());

            subject.onManifestChanged = mockOnManifestChangedFunc.object;
            require("../src/autoproj").installationManifestPath = mockInstallationManifestPathFunc.object;
        });
        afterEach(() => {
            require("../src/autoproj").installationManifestPath = originalInstallationManifestPathFunc;
        });
        it("watches the manifest with proper callback", async () => {
            mockWatcher.setup((x) => x.startWatching(installManifestPath, TypeMoq.It.isAny())).callback(
                (filePath: string, callback: (filePath: string) => void) => watcherCb = callback,
            ).returns(() => true);

            await subject.watchManifest(mockWorkspace.object);
            watcherCb!(installManifestPath);
            mockWatcher.verify((x) => x.startWatching(installManifestPath, TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockOnManifestChangedFunc.verify((x) => x(mockWorkspace.object), TypeMoq.Times.once());
        });
        it("watches the manifest and shows error if failure", async () => {
            mockWatcher.setup((x) => x.startWatching(installManifestPath, TypeMoq.It.isAny())).
                throws(new Error("test"));

            await subject.watchManifest(mockWorkspace.object);
            mockWatcher.verify((x) => x.startWatching(installManifestPath, TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
        });
    });
    describe("unwatchManifest()", () => {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        const originalInstallationManifestPathFunc = require("../src/autoproj").installationManifestPath;
        let mockInstallationManifestPathFunc: TypeMoq.IMock<(path: string) => string>;
        const installManifestPath: string = "/path/to/workspace/.autoproj/installation-manifest";

        beforeEach(() => {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup((x) => x.root).returns(() => "/path/to/workspace");
            mockInstallationManifestPathFunc = TypeMoq.Mock.ofType<(root: string) => string>();
            mockInstallationManifestPathFunc.setup((x) => x("/path/to/workspace")).returns(() => installManifestPath);

            require("../src/autoproj").installationManifestPath = mockInstallationManifestPathFunc.object;
        });
        afterEach(() => {
            require("../src/autoproj").installationManifestPath = originalInstallationManifestPathFunc;
        });
        it("unwatches the manifest", async () => {
            mockWatcher.setup((x) => x.stopWatching(installManifestPath)).returns(() => true);
            await subject.unwatchManifest(mockWorkspace.object);
            mockWatcher.verify((x) => x.stopWatching(installManifestPath), TypeMoq.Times.once());
        });
        it("unwatches the manifest and shows error if failure", async () => {
            mockWatcher.setup((x) => x.stopWatching(installManifestPath)).throws(new Error("test"));
            await subject.unwatchManifest(mockWorkspace.object);
            mockWatcher.verify((x) => x.stopWatching(installManifestPath), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
        });
    });
});

describe("extension.setupExtension()", () => {
    it("sets up extension", () => {
        const mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        const subscriptions: any[] = [];

        extension.setupExtension(subscriptions, mockWrapper.object);
    });
});
