"use strict";
import * as path from "path";
import { IMock, IGlobalMock, It, Mock, Times, GlobalMock, GlobalScope } from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as cpptools from "../src/cpptools";
import * as extension from "../src/extension";
import * as shims from "../src/shimsWriter";
import * as tasks from "../src/tasks";
import * as watcher from "../src/fileWatcher";
import * as wrappers from "../src/wrappers";
import * as mocks from "./mocks";
import { WatchManager } from "../src/workspaceWatcher";

describe("EventHandler", () => {
    let mockWorkspaces: mocks.MockWorkspaces;
    let mockWrapper: IMock<wrappers.VSCode>;
    let mockFileWatcher: IGlobalMock<watcher.FileWatcher>;
    let mockCppConfigurationProvider: IMock<cpptools.CppConfigurationProvider>;
    let mockShimsWriter: IGlobalMock<shims.ShimsWriter>;
    let mockWatchManager: IMock<WatchManager>;
    let subject: extension.EventHandler;

    beforeEach(() => {
        mockWorkspaces = new mocks.MockWorkspaces();
        mockWrapper = Mock.ofType<wrappers.VSCode>();
        mockFileWatcher = GlobalMock.ofType(watcher.FileWatcher, watcher);
        mockCppConfigurationProvider = Mock.ofType<cpptools.CppConfigurationProvider>();
        mockShimsWriter = GlobalMock.ofType(shims.ShimsWriter, shims);
        mockWatchManager = Mock.ofType<WatchManager>();
        GlobalScope.using(mockShimsWriter, mockFileWatcher).with(() => {
            subject = new extension.EventHandler(
                mockWrapper.object, mockWorkspaces.object, mockCppConfigurationProvider.object, mockWatchManager.object
            );
        });
    });
    describe("dispose()", () => {
        it("disposes of the file watcher", () => {
            subject.dispose();
            mockFileWatcher.verify((x) => x.dispose(), Times.once());
        })
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
            mockWatchManager.verify((x) => x.start(mockWorkspace.object), Times.once());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.once());
        });
        it("reloads the given workspace and shows error message if it fails", async () => {
            mockWorkspaces.invalidateWorkspaceInfo(wsRoot);
            await subject.onManifestChanged(mockWorkspace.object);
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
            mockWorkspace.verify((x) => x.reload(), Times.once());
            mockWatchManager.verify((x) => x.start(mockWorkspace.object), Times.once());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.once());
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
        beforeEach(() => {
            mockWorkspace = mockWorkspaces.addWorkspace(wsRoot);
            mockWatchFunc = Mock.ofInstance(() => void 0);

            subject.watchManifest = mockWatchFunc.object;
        });
        describe("with a valid instalatiion manifest", () => {
            beforeEach(() => {
                mockWorkspaces.createWorkspaceInfo(wsRoot);
                mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                    returns(() => ({ added: true, workspace: mockWorkspace.object }));
            });
            it("loads installation manifest", async () => {
                await subject.onWorkspaceFolderAdded(folder);
                mockWorkspace.verify((x) => x.info(), Times.once());
                mockWatchFunc.verify((x) => x(mockWorkspace.object), Times.once());
                mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.once());
                mockWatchManager.verify((x) => x.start(mockWorkspace.object), Times.once());
                mockShimsWriter.verify((x) => x.writePython(mockWorkspace.object), Times.once());
                mockShimsWriter.verify((x) => x.writeGdb(mockWorkspace.object), Times.once());
                mockShimsWriter.verify((x) => x.writeRuby(mockWorkspace.object), Times.once());
                mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            });
            it("shows error if cannot write shims", async () => {
                mockShimsWriter.setup((x) => x.writeOpts(It.isAny())).returns(() => Promise.reject(new Error("foo")));
                await subject.onWorkspaceFolderAdded(folder);
                mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.exactly(1));
                mockShimsWriter.verify((x) => x.writePython(It.isAny()), Times.never());
                mockShimsWriter.verify((x) => x.writeGdb(It.isAny()), Times.never());
                mockShimsWriter.verify((x) => x.writeRuby(It.isAny()), Times.never());
                mockWatchManager.verify((x) => x.start(It.isAny()), Times.once());
            });
        });
        it("loads manifest and shows error if failure", async () => {
            mockWorkspaces.invalidateWorkspaceInfo(wsRoot);
            mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: true, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), Times.once());
            mockWatchFunc.verify((x) => x(mockWorkspace.object), Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.once());
            mockWatchManager.verify((x) => x.start(mockWorkspace.object), Times.once());
            mockShimsWriter.verify((x) => x.writeOpts(mockWorkspace.object), Times.once());
            mockShimsWriter.verify((x) => x.writePython(mockWorkspace.object), Times.once());
            mockShimsWriter.verify((x) => x.writeGdb(mockWorkspace.object), Times.once());
            mockShimsWriter.verify((x) => x.writeRuby(mockWorkspace.object), Times.once());
        });
        it("does nothing if folder already in workspace", async () => {
            mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: false, workspace: mockWorkspace.object }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), Times.never());
            mockWatchFunc.verify((x) => x(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.never());
            mockWatchManager.verify((x) => x.start(It.isAny()), Times.never());
            mockShimsWriter.verify((x) => x.writeOpts(It.isAny()), Times.never());
            mockShimsWriter.verify((x) => x.writePython(It.isAny()), Times.never());
            mockShimsWriter.verify((x) => x.writeGdb(It.isAny()), Times.never());
            mockShimsWriter.verify((x) => x.writeRuby(It.isAny()), Times.never());
        });
        it("does nothing if folder not added", async () => {
            mockWorkspaces.mock.setup((x) => x.addFolder(folder.uri.fsPath)).
                returns(() => ({ added: false, workspace: null }));

            await subject.onWorkspaceFolderAdded(folder);
            mockWorkspace.verify((x) => x.info(), Times.never());
            mockWatchFunc.verify((x) => x(It.isAny()), Times.never());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.never());
            mockWatchManager.verify((x) => x.start(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockShimsWriter.verify((x) => x.writePython(It.isAny()), Times.never());
            mockShimsWriter.verify((x) => x.writeGdb(It.isAny()), Times.never());
            mockShimsWriter.verify((x) => x.writeRuby(It.isAny()), Times.never());
        });
    });
    describe("onWorkspaceFolderRemoved()", () => {
        const wsRoot = "/path/to/workspace";
        let mockWorkspace: IMock<autoproj.Workspace>;
        let mockUnwatchFunc: IMock<(ws: autoproj.Workspace) => void>;
        const folder: vscode.WorkspaceFolder = {
            index: 0,
            name: "two",
            uri: vscode.Uri.file("/path/to/two"),
        };
        beforeEach(() => {
            mockWorkspace = mockWorkspaces.addWorkspace(wsRoot);
            mockUnwatchFunc = Mock.ofInstance(() => void 0);
            subject.unwatchManifest = mockUnwatchFunc.object;
        });
        it("de-registers the folder", async () => {
            mockWorkspaces.mock.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => null);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify((x) => x(mockWorkspace.object), Times.never());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockWatchManager.verify((x) => x.stop(mockWorkspace.object), Times.never());
        });
        it("de-registers the folder and stops the watcher", async () => {
            mockWorkspaces.mock.setup((x) => x.deleteFolder(folder.uri.fsPath)).returns(() => mockWorkspace.object);

            await subject.onWorkspaceFolderRemoved(folder);
            mockUnwatchFunc.verify((x) => x(mockWorkspace.object), Times.once());
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockWatchManager.verify((x) => x.stop(mockWorkspace.object), Times.once());
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
            mockFileWatcher.setup((x) => x.startWatching(installManifestPath, It.isAny())).callback(
                (filePath: string, callback: (filePath: string) => void) => watcherCb = callback,
            ).returns(() => true);

            await subject.watchManifest(mockWorkspace.object);
            watcherCb!(installManifestPath);
            mockFileWatcher.verify((x) => x.startWatching(installManifestPath, It.isAny()), Times.once());
            mockOnManifestChangedFunc.verify((x) => x(mockWorkspace.object), Times.once());
        });
        it("watches the manifest and shows error if failure", async () => {
            mockFileWatcher.setup((x) => x.startWatching(installManifestPath, It.isAny())).
                throws(new Error("test"));

            await subject.watchManifest(mockWorkspace.object);
            mockFileWatcher.verify((x) => x.startWatching(installManifestPath, It.isAny()), Times.once());
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
        it("unwatches the manifest", () => {
            mockFileWatcher.setup((x) => x.stopWatching(installManifestPath)).returns(() => true);
            subject.unwatchManifest(mockWorkspace.object);
            mockFileWatcher.verify((x) => x.stopWatching(installManifestPath), Times.once());
        });
        it("unwatches the manifest and shows error if failure", () => {
            mockFileWatcher.setup((x) => x.stopWatching(installManifestPath)).throws(new Error("test"));
            subject.unwatchManifest(mockWorkspace.object);
            mockFileWatcher.verify((x) => x.stopWatching(installManifestPath), Times.once());
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
