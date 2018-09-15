'use strict';
import * as extension from '../src/extension';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../src/wrappers';
import * as watcher from '../src/watcher';
import * as autoproj from '../src/autoproj';
import * as vscode from 'vscode';

describe("EventHandler", () => {
    let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockWatcher: TypeMoq.IMock<watcher.FileWatcher>;
    let subject: extension.EventHandler;

    beforeEach(function () {
        mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockWatcher = TypeMoq.Mock.ofType<watcher.FileWatcher>();
        subject = new extension.EventHandler(mockWrapper.object, mockWatcher.object, mockWorkspaces.object);
    })
    describe("onManifestChanged()", function () {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockInfo: TypeMoq.IMock<autoproj.WorkspaceInfo>;
        beforeEach(function () {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockInfo = TypeMoq.Mock.ofType<autoproj.WorkspaceInfo>();
            mockInfo.setup((x: any) => x.then).returns(() => undefined);
        });
        it("reloads the given workspace", async function () {
            mockWorkspace.setup(x => x.reload()).returns(() => Promise.resolve(mockInfo.object));
            await subject.onManifestChanged(mockWorkspace.object);
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWorkspace.verify(x => x.reload(), TypeMoq.Times.once());
        })
        it("reloads the given workspace and shows error message if it fails", async function () {
            mockWorkspace.setup(x => x.reload()).returns(() => Promise.reject(new Error("test")));
            await subject.onManifestChanged(mockWorkspace.object);
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWorkspace.verify(x => x.reload(), TypeMoq.Times.once());
        })
    })
    describe("onWorkspaceFolderAdded()", function () {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockWatchFunc: TypeMoq.IMock<(ws: autoproj.Workspace) => void>;
        let mockInfo: TypeMoq.IMock<autoproj.WorkspaceInfo>;
        const folder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file('/path/to/two'),
            name: 'two',
            index: 0
        }
        beforeEach(function () {
            mockInfo = TypeMoq.Mock.ofType<autoproj.WorkspaceInfo>();
            mockInfo.setup((x: any) => x.then).returns(() => undefined);
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup(x => x.name).returns(() => 'dev');
            mockWatchFunc = TypeMoq.Mock.ofInstance(() => {});
            subject.watchManifest = mockWatchFunc.object;
        });
        it("loads installation manifest", async function () {
            mockWorkspace.setup(x => x.info()).returns(() => Promise.resolve(mockInfo.object));
            mockWorkspaces.setup(x => x.addFolder(folder.uri.fsPath)).
                returns(() => { return { added: true, workspace: mockWorkspace.object }});

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify(x => x.info(), TypeMoq.Times.once());
            mockWatchFunc.verify(x => x(mockWorkspace.object), TypeMoq.Times.once());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify(x => x.executeCommand('workbench.action.tasks.runTask', `autoproj: dev: Watch`),
                TypeMoq.Times.once());
        })
        it("loads manifest and shows error if failure", async function () {
            mockWorkspace.setup(x => x.info()).returns(() => Promise.reject(new Error("test")));
            mockWorkspaces.setup(x => x.addFolder(folder.uri.fsPath)).
                returns(() => { return { added: true, workspace: mockWorkspace.object }});

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify(x => x.info(), TypeMoq.Times.once());
            mockWatchFunc.verify(x => x(mockWorkspace.object), TypeMoq.Times.once());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWrapper.verify(x => x.executeCommand('workbench.action.tasks.runTask', `autoproj: dev: Watch`),
                TypeMoq.Times.once());
        })
        it("does nothing if folder already in workspace", async function () {
            mockWorkspaces.setup(x => x.addFolder(folder.uri.fsPath)).
                returns(() => { return { added: false, workspace: mockWorkspace.object }});

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify(x => x.info(), TypeMoq.Times.never());
            mockWatchFunc.verify(x => x(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify(x => x.executeCommand(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
        })
        it("does nothing if folder not added", async function () {
            mockWorkspaces.setup(x => x.addFolder(folder.uri.fsPath)).
                returns(() => { return { added: false, workspace: null }});

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify(x => x.info(), TypeMoq.Times.never());
            mockWatchFunc.verify(x => x(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify(x => x.executeCommand(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
        })
    })
    describe("onWorkspaceFolderRemoved()", function () {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockUnwatchFunc: TypeMoq.IMock<(ws: autoproj.Workspace) => void>;
        const folder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file('/path/to/two'),
            name: 'two',
            index: 0
        }
        beforeEach(function () {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup(x => x.readWatchPID()).returns(() => Promise.resolve(1234));
            mockUnwatchFunc = TypeMoq.Mock.ofInstance(() => {});
            subject.unwatchManifest = mockUnwatchFunc.object;
        });
        it("de-registers the folder", async function () {
            mockWorkspaces.setup(x => x.deleteFolder(folder.uri.fsPath)).returns(() => null);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify(x => x(mockWorkspace.object), TypeMoq.Times.never());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify(x => x.killProcess(1234, "SIGINT"), TypeMoq.Times.never());
        })
        it("de-registers the folder and stops the watcher", async function () {
            mockWorkspaces.setup(x => x.deleteFolder(folder.uri.fsPath)).returns(() => mockWorkspace.object);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify(x => x(mockWorkspace.object), TypeMoq.Times.once());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
            mockWrapper.verify(x => x.killProcess(1234, "SIGINT"), TypeMoq.Times.once());
        })
        it("de-registers the folder, stops the watcher and shows an error message", async function () {
            mockWorkspace.reset();
            mockWorkspace.setup(x => x.readWatchPID()).returns(() => Promise.reject(new Error("test")));
            mockWorkspaces.setup(x => x.deleteFolder(folder.uri.fsPath)).returns(() => mockWorkspace.object);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify(x => x(mockWorkspace.object), TypeMoq.Times.once());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWrapper.verify(x => x.killProcess(1234, "SIGINT"), TypeMoq.Times.never());
        })
    });
    describe("watchManifest()", function () {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let originalInstallationManifestPathFunc = require('../src/autoproj').installationManifestPath;
        let mockInstallationManifestPathFunc: TypeMoq.IMock<(path: string) => string>;
        let mockOnManifestChangedFunc: TypeMoq.IMock<(ws: autoproj.Workspace) => Promise<void>>;
        let installManifestPath: string = "/path/to/workspace/.autoproj/installation-manifest";
        let watcherCb: (filePath: string) => void;

        beforeEach(function () {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup(x => x.root).returns(() => "/path/to/workspace");
            mockInstallationManifestPathFunc = TypeMoq.Mock.ofType<(root: string) => string>();
            mockInstallationManifestPathFunc.setup(x => x("/path/to/workspace")).returns(() => installManifestPath);
            mockOnManifestChangedFunc = TypeMoq.Mock.ofInstance(() => Promise.resolve());

            subject.onManifestChanged = mockOnManifestChangedFunc.object;
            require('../src/autoproj').installationManifestPath = mockInstallationManifestPathFunc.object;
        });
        afterEach(function () {
            require('../src/autoproj').installationManifestPath = originalInstallationManifestPathFunc;
        })
        it("watches the manifest with proper callback", async function () {
            mockWatcher.setup(x => x.startWatching(installManifestPath, TypeMoq.It.isAny())).callback(
                (filePath: string, callback: (filePath: string) => void) => watcherCb = callback
            ).returns(() => true);

            await subject.watchManifest(mockWorkspace.object);
            watcherCb!(installManifestPath);
            mockWatcher.verify(x => x.startWatching(installManifestPath, TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockOnManifestChangedFunc.verify(x => x(mockWorkspace.object), TypeMoq.Times.once());
        })
        it("watches the manifest and shows error if failure", async function () {
            mockWatcher.setup(x => x.startWatching(installManifestPath, TypeMoq.It.isAny())).throws(new Error("test"));
            await subject.watchManifest(mockWorkspace.object);
            mockWatcher.verify(x => x.startWatching(installManifestPath, TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
        })
    });
    describe("unwatchManifest()", function () {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let originalInstallationManifestPathFunc = require('../src/autoproj').installationManifestPath;
        let mockInstallationManifestPathFunc: TypeMoq.IMock<(path: string) => string>;
        let installManifestPath: string = "/path/to/workspace/.autoproj/installation-manifest";

        beforeEach(function () {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup(x => x.root).returns(() => "/path/to/workspace");
            mockInstallationManifestPathFunc = TypeMoq.Mock.ofType<(root: string) => string>();
            mockInstallationManifestPathFunc.setup(x => x("/path/to/workspace")).returns(() => installManifestPath);

            require('../src/autoproj').installationManifestPath = mockInstallationManifestPathFunc.object;
        });
        afterEach(function () {
            require('../src/autoproj').installationManifestPath = originalInstallationManifestPathFunc;
        })
        it("unwatches the manifest", async function () {
            mockWatcher.setup(x => x.stopWatching(installManifestPath)).returns(() => true);
            await subject.unwatchManifest(mockWorkspace.object);
            mockWatcher.verify(x => x.stopWatching(installManifestPath), TypeMoq.Times.once());
        })
        it("unwatches the manifest and shows error if failure", async function () {
            mockWatcher.setup(x => x.stopWatching(installManifestPath)).throws(new Error("test"));
            await subject.unwatchManifest(mockWorkspace.object);
            mockWatcher.verify(x => x.stopWatching(installManifestPath), TypeMoq.Times.once());
            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
        })
    })
});

describe("extension.setupExtension()", () => {
    it("sets up extension", function () {
        const mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        const subscriptions: any[] = [];

        extension.setupExtension(subscriptions, mockWrapper.object);
    });
});