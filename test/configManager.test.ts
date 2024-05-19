import * as autoproj from "../src/autoproj";
import * as path from "path";
import * as vscode from "vscode";
import { Mocks, WorkspaceBuilder } from "./helpers";
import { BundleManager, BundleWatcher } from "../src/bundleWatcher";
import { ConfigManager } from "../src/configManager";
import { using } from "./using";
import { IMock, It, Mock, Times } from "typemoq";
import * as shims from "../src/shimsWriter";

function spy<T>(subject: T): IMock<T> {
    const mock = Mock.ofInstance(subject);
    mock.callBase = true;
    return mock;
}

describe("configManager", () => {
    let m: Mocks;
    let workspaces: autoproj.Workspaces;
    let builder: WorkspaceBuilder;
    let mockBundleManager: IMock<BundleManager>;
    let subject: ConfigManager;
    beforeEach(() => {
        m = new Mocks();
        builder = new WorkspaceBuilder();
        workspaces = new autoproj.Workspaces();
        workspaces.addFolder(path.join(builder.root, "autoproj"));
        mockBundleManager = Mock.ofType<BundleManager>();
        subject = new ConfigManager(mockBundleManager.object, workspaces);
        using(m.getConfiguration);
    });
    describe("onWorkspaceRemoved", () => {
        it("stops watching the extension bundle", () => {
            subject.onWorkspaceRemoved(builder.workspace);
            mockBundleManager.verify((x) => x.unwatch(builder.workspace), Times.once());
        });
    });
    describe("setupExtension", () => {
        it("does nothing if workspace is empty", () => {
            workspaces.deleteFolder(path.join(builder.root, "autoproj"));
            const mock = spy(subject);
            subject.setupExtension();
            mock.verify((x) => x.writeShims(), Times.never());
            mock.verify((x) => x.setupTestMate(), Times.never());
            mock.verify((x) => x.setupPythonExtension(), Times.never());
            mock.verify((x) => x.setupRubyExtension(), Times.never());
        })
        it("does nothing if multiple workspaces are open", () => {
            const builder2 = new WorkspaceBuilder();
            workspaces.add(builder2.workspace);
            const mock = spy(subject);
            using(m.showErrorMessage).do(() => {
                subject.setupExtension();
            });
            mock.verify((x) => x.writeShims(), Times.never());
            mock.verify((x) => x.setupTestMate(), Times.never());
            mock.verify((x) => x.setupPythonExtension(), Times.never());
            mock.verify((x) => x.setupRubyExtension(), Times.never());
            m.showErrorMessage.verify((x) => x("Working on multiple Autoproj workspaces is not supported"),
                Times.once());
        });
    });
    describe("setupPythonExtension()", () => {
        it("does nothing if autoproj python shim does not exist", async () => {
            await subject.setupPythonExtension();

            m.workspaceConfiguration.verify((x) => x.update("python.defaultInterpreterPath", It.isAny()), Times.never());
            m.workspaceConfiguration.verify((x) => x.update("optOutFrom", It.isAny(), It.isAny()), Times.never());
        })
        it("sets the default python interpreter", async () => {
            builder.fs.mkdir(".autoproj", "bin");
            builder.fs.mkfile("", ".autoproj", "bin", "python");

            m.getConfiguration.setup((x) => x()).returns(() => m.workspaceConfiguration.object);
            m.getConfiguration.setup((x) => x("python.experiments")).returns(() => m.workspaceConfiguration.object);
            m.workspaceConfiguration.setup((x) => x.get<string[]>("optOutFrom")).returns(() => ["foobar"]);
            await subject.setupPythonExtension();

            const pythonShimPath = path.join(builder.root, shims.ShimsWriter.RELATIVE_SHIMS_PATH, "python");
            m.workspaceConfiguration.verify((x) => x.update("python.defaultInterpreterPath", pythonShimPath), Times.once());
            m.workspaceConfiguration.verify((x) => x.update("optOutFrom",
                ["foobar", "pythonTestAdapter"], vscode.ConfigurationTarget.Global), Times.once());
        })
    });
    describe("setupRubyExtension()", () => {
        let mockBundleWatcher: IMock<BundleWatcher>;
        let workspace: autoproj.Workspace;
        beforeEach(() => {
            workspace = [...workspaces.workspaces.values()][0];
            mockBundleWatcher = Mock.ofType<BundleWatcher>();
            mockBundleManager.setup((x) => x.getWatcher(workspace)).returns(() => mockBundleWatcher.object);
        })
        it("does nothing if dependencies cannot be installed", async () => {
            // create a file instead of a directory to force error
            mockBundleWatcher.setup((x) => x.queueInstall()).returns(() => Promise.resolve(1));

            await subject.setupRubyExtension();
            m.getConfiguration.verify((x) => x(It.isAny()), Times.never());
        });
        describe("the dependencies are installed", () => {
            let extensionGemfile: string;
            beforeEach(() => {
                extensionGemfile = path.join(builder.root, ".autoproj", "vscode-autoproj", "Gemfile");
                mockBundleWatcher.setup((x) => x.extensionGemfile).returns(() => extensionGemfile);
                mockBundleWatcher.setup((x) => x.queueInstall()).returns(() => Promise.resolve(0));
            });
            it("sets ruby extension configuration", async () => {
                m.getConfiguration.setup((x) => x("rubyLsp")).returns(() => m.workspaceConfiguration.object);
                await subject.setupRubyExtension();

                const shimsPath = path.join(builder.root, ".autoproj", "vscode-autoproj", "bin");
                m.workspaceConfiguration.verify((x) => x.update("rubyVersionManager.identifier", "custom"), Times.once());
                m.workspaceConfiguration.verify((x) => x.update("customRubyCommand", `PATH=${shimsPath}:$PATH`), Times.once());
                m.workspaceConfiguration.verify((x) => x.update("bundleGemfile", extensionGemfile), Times.once());
            });
        });
    });
});