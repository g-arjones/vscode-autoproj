"use strict";
import * as assert from "assert";
import * as path from "path";
import { IMock, IGlobalMock, It, Mock, Times, GlobalMock, GlobalScope } from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as cpptools from "../src/cpptools";
import * as extension from "../src/extension";
import * as watcher from "../src/fileWatcher";
import { Mocks, WorkspaceBuilder, host } from "./helpers";
import { ConfigManager } from "../src/configManager";
import { WatchManager } from "../src/workspaceWatcher";
import { using } from "./using";

describe("EventHandler", () => {
    let mocks: Mocks;
    let mockFileWatcher: IGlobalMock<watcher.FileWatcher>;
    let mockCppConfigurationProvider: IMock<cpptools.CppConfigurationProvider>;
    let mockWatchManager: IMock<WatchManager>;
    let mockConfigManager: IMock<ConfigManager>;
    let workspaces: autoproj.Workspaces;
    let builder: WorkspaceBuilder;
    let subject: extension.EventHandler;

    beforeEach(() => {
        mocks = new Mocks();
        builder = new WorkspaceBuilder();
        workspaces = new autoproj.Workspaces();
        mockFileWatcher = GlobalMock.ofType(watcher.FileWatcher, watcher);
        mockCppConfigurationProvider = Mock.ofType<cpptools.CppConfigurationProvider>();
        mockWatchManager = Mock.ofType<WatchManager>();
        mockConfigManager = Mock.ofType<ConfigManager>();
        GlobalScope.using(mockFileWatcher).with(() => {
            subject = new extension.EventHandler(
                workspaces,
                mockCppConfigurationProvider.object,
                mockWatchManager.object,
                mockConfigManager.object
            );
        });
        using(mocks.showErrorMessage);
    });
    describe("dispose()", () => {
        it("disposes of the file watcher", () => {
            subject.dispose();
            mockFileWatcher.verify((x) => x.dispose(), Times.once());
        })
    });
    describe("onManifestChanged()", () => {
        beforeEach(() => {
            workspaces.add(builder.workspace);
        });
        it("reloads the given workspace", async () => {
            await subject.onManifestChanged(builder.workspace);
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.never());
            assert(builder.workspace.loadingInfo());
            mockWatchManager.verify((x) => x.start(builder.workspace), Times.once());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.once());
        });
        it("reloads the given workspace and shows error message if it fails", async () => {
            builder.fs.mkfile("[", ".autoproj", "installation-manifest");
            await subject.onManifestChanged(builder.workspace);
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.once());
            mockWatchManager.verify((x) => x.start(builder.workspace), Times.once());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.once());
        });
    });
    describe("onWorkspaceFolderAdded()", () => {
        let mockWatchFunc: IMock<(ws: autoproj.Workspace) => void>;
        let workspace: autoproj.Workspace;
        beforeEach(() => {
            mockWatchFunc = Mock.ofInstance(() => void 0);
            subject.watchManifest = mockWatchFunc.object;
        });
        describe("with a valid instalatiion manifest", () => {
            let folder: vscode.WorkspaceFolder;
            let pkg: autoproj.IPackage;
            beforeEach(() => {
                pkg = builder.addPackage("foobar");
                folder = {
                    name: pkg.name,
                    uri: vscode.Uri.file(pkg.srcdir),
                    index: 2
                }
            });
            it("loads installation manifest", async () => {
                await subject.onWorkspaceFolderAdded(folder);
                workspace = workspaces.workspaces.get(builder.root)!;
                mockWatchFunc.verify((x) => x(workspace), Times.once());
                mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.once());
                mockWatchManager.verify((x) => x.start(workspace), Times.once());
                mockConfigManager.verify((x) => x.setupExtension(), Times.once());
                mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.never());
            });
        });
        it("loads manifest and shows error if failure", async () => {
            builder.fs.mkfile("[", ".autoproj", "installation-manifest");
            const folder: vscode.WorkspaceFolder = {
                name: `autoproj ${builder.workspace.name}`,
                uri: vscode.Uri.file(builder.root),
                index: 1
            }

            await subject.onWorkspaceFolderAdded(folder);
            workspace = workspaces.workspaces.get(builder.root)!;
            mockWatchFunc.verify((x) => x(workspace), Times.once());
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.once());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.once());
            mockConfigManager.verify((x) => x.setupExtension(), Times.once());
            mockWatchManager.verify((x) => x.start(workspace), Times.once());
        });
        it("does nothing if folder already in workspace", async () => {
            workspaces.add(builder.workspace);
            const folder: vscode.WorkspaceFolder = {
                name: `autoproj ${builder.workspace.name}`,
                uri: vscode.Uri.file(builder.root),
                index: 1
            }

            await subject.onWorkspaceFolderAdded(folder);
            mockWatchFunc.verify((x) => x(It.isAny()), Times.never());
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.never());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.never());
            mockWatchManager.verify((x) => x.start(It.isAny()), Times.never());
            mockConfigManager.verify((x) => x.setupExtension(), Times.never());
        });
        it("does nothing if folder not added", async () => {
            const folder: vscode.WorkspaceFolder = {
                name: `autoproj ${builder.workspace.name}`,
                uri: vscode.Uri.file("/"),
                index: 1
            }
            await subject.onWorkspaceFolderAdded(folder);
            mockWatchFunc.verify((x) => x(It.isAny()), Times.never());
            mockCppConfigurationProvider.verify((x) => x.notifyChanges(), Times.never());
            mockWatchManager.verify((x) => x.start(It.isAny()), Times.never());
            mockConfigManager.verify((x) => x.setupExtension(), Times.never());
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.never());
        });
    });
    describe("onWorkspaceFolderRemoved()", () => {
        let buildconfPath: string;
        let folder: vscode.WorkspaceFolder;
        let mockUnwatchFunc: IMock<(ws: autoproj.Workspace) => void>;

        beforeEach(() => {
            buildconfPath = path.join(builder.root, "autoproj");
            folder = {
                index: 0,
                name: "autoproj",
                uri: vscode.Uri.file(buildconfPath),
            };

            mockUnwatchFunc = Mock.ofInstance(() => void 0);
            subject.unwatchManifest = mockUnwatchFunc.object;
        });
        it("de-registers the folder", async () => {
            workspaces.addFolder(builder.root);
            workspaces.addFolder(buildconfPath);
            const workspace = workspaces.folderToWorkspace.get(buildconfPath)!;

            await subject.onWorkspaceFolderRemoved(folder);
            assert(!workspaces.folderToWorkspace.get(buildconfPath))
            mockUnwatchFunc.verify((x) => x(workspace), Times.never());
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.never());
            mockWatchManager.verify((x) => x.stop(workspace), Times.never());
            mockConfigManager.verify((x) => x.onWorkspaceRemoved(workspace), Times.never());
        });
        it("de-registers the folder and stops the watcher", async () => {
            workspaces.addFolder(buildconfPath);
            const workspace = workspaces.folderToWorkspace.get(buildconfPath)!;

            await subject.onWorkspaceFolderRemoved(folder);
            assert(!workspaces.folderToWorkspace.get(buildconfPath))
            mockUnwatchFunc.verify((x) => x(workspace), Times.once());
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.never());
            mockWatchManager.verify((x) => x.stop(workspace), Times.once());
            mockConfigManager.verify((x) => x.onWorkspaceRemoved(workspace), Times.once());
        });
    });
    describe("watchManifest()", () => {
        let workspace: autoproj.Workspace;
        let mockOnManifestChangedFunc: IMock<(ws: autoproj.Workspace) => Promise<void>>;
        let installManifestPath: string;
        let watcherCb: (filePath: string) => void;

        beforeEach(() => {
            workspace = builder.workspace;
            workspaces.add(workspace)
            workspaces.addFolder(builder.root);
            mockOnManifestChangedFunc = Mock.ofInstance(() => Promise.resolve());
            subject.onManifestChanged = mockOnManifestChangedFunc.object;
            installManifestPath = builder.fs.fullPath(".autoproj", "installation-manifest");
        });
        it("watches the manifest with proper callback", async () => {
            mockFileWatcher.setup((x) => x.startWatching(installManifestPath, It.isAny())).callback(
                (filePath: string, callback: (filePath: string) => void) => watcherCb = callback,
            ).returns(() => true);

            subject.watchManifest(workspace);
            watcherCb!(installManifestPath);
            mockFileWatcher.verify((x) => x.startWatching(installManifestPath, It.isAny()), Times.once());
            mockOnManifestChangedFunc.verify((x) => x(workspace), Times.once());
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.never());
        });
        it("watches the manifest and shows error if failure", async () => {
            mockFileWatcher.setup((x) => x.startWatching(installManifestPath, It.isAny())).
                throws(new Error("test"));

            subject.watchManifest(workspace);
            mockFileWatcher.verify((x) => x.startWatching(installManifestPath, It.isAny()), Times.once());
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.once());
        });
    });
    describe("unwatchManifest()", () => {
        let workspace: autoproj.Workspace;
        let installManifestPath: string;
        beforeEach(() => {
            workspace = builder.workspace;
            workspaces.add(workspace)
            workspaces.addFolder(builder.root);
            installManifestPath = builder.fs.fullPath(".autoproj", "installation-manifest");
        });
        it("unwatches the manifest", () => {
            mockFileWatcher.setup((x) => x.stopWatching(installManifestPath)).returns(() => true);
            subject.unwatchManifest(workspace);
            mockFileWatcher.verify((x) => x.stopWatching(installManifestPath), Times.once());
        });
        it("unwatches the manifest and shows error if failure", () => {
            mockFileWatcher.setup((x) => x.stopWatching(installManifestPath)).throws(new Error("test"));
            subject.unwatchManifest(workspace);
            mockFileWatcher.verify((x) => x.stopWatching(installManifestPath), Times.once());
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.once());
        });
    });
    describe("onDidOpenTextDocument", () => {
        let workspace: autoproj.Workspace;
        let manifestPath: string;
        let initrbPath: string;
        let event: vscode.TextDocument;
        function createOpenTextDocumentEvent(docPath: string) {
            const mockOpenTextDocumentEvent = Mock.ofType<vscode.TextDocument>();
            const uri = vscode.Uri.file(docPath);

            mockOpenTextDocumentEvent.setup((x) => x.uri).returns(() => uri);
            return mockOpenTextDocumentEvent.object;
        }
        beforeEach(async () => {
            workspace = builder.workspace;
            builder.fs.mkfile("layout:\n  - pkg_a", "autoproj", "manifest.robot");
            builder.fs.mkfile("puts('hello')", "autoproj", "init.rb");
            manifestPath = builder.fs.fullPath("autoproj", "manifest.robot");
            initrbPath = builder.fs.fullPath("autoproj", "init.rb");

            workspaces.addFolder(builder.fs.fullPath("autoproj"))
            await host.addFolders(builder.fs.fullPath("autoproj"));
        });
        afterEach(async () => {
            host.closeAllTabs();
        })
        it("changes the document language if file name starts with 'manifest.'", async () => {
            event = createOpenTextDocumentEvent(manifestPath);
            await vscode.window.showTextDocument(vscode.Uri.file(manifestPath));
            await subject.onDidOpenTextDocument(event);
            assert.equal(vscode.window.activeTextEditor?.document.languageId, "yaml");
        });
        it("keeps the document language", async () => {
            event = createOpenTextDocumentEvent(initrbPath);
            await vscode.window.showTextDocument(vscode.Uri.file(initrbPath));
            await subject.onDidOpenTextDocument(event);
            assert.equal(vscode.window.activeTextEditor?.document.languageId, "ruby");
        });
    });
});

// TODO: figure out how to run this without triggering events from other tests
describe.skip("extension.setupExtension()", () => {
    it("sets up extension", () => {
        const subscriptions: any[] = [];
        extension.setupExtension(subscriptions);
    });
});
