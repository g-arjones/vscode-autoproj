import * as autoproj from "../src/autoproj";
import * as path from "path";
import * as vscode from "vscode";
import * as helpers from "./helpers";
import { BundleManager, BundleWatcher } from "../src/bundleWatcher";
import { ConfigManager } from "../src/configManager";
import { using, UsingResult } from "./using";
import { GlobalMock, IGlobalMock, IMock, It, Mock, Times } from "typemoq";
import { ShimsWriter } from "../src/shimsWriter";

describe("configManager", () => {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let builder: helpers.WorkspaceBuilder;
    let mockConfiguration: IMock<vscode.WorkspaceConfiguration>;
    let mockGetConfiguration: IGlobalMock<typeof vscode.workspace.getConfiguration>;
    let mockBundleManager: IMock<BundleManager>;
    let subject: ConfigManager;
    let usingResult: UsingResult;
    beforeEach(() => {
        root = helpers.init();
        builder = new helpers.WorkspaceBuilder(root);
        workspaces = new autoproj.Workspaces();
        helpers.mkdir("autoproj");
        workspaces.addFolder(path.join(root, "autoproj"));
        mockBundleManager = Mock.ofType<BundleManager>();
        mockConfiguration = Mock.ofType<vscode.WorkspaceConfiguration>();
        mockGetConfiguration =
            GlobalMock.ofInstance(vscode.workspace.getConfiguration, "getConfiguration", vscode.workspace);

        subject = new ConfigManager(mockBundleManager.object, workspaces);
        usingResult = using(mockGetConfiguration);
        usingResult.commit();
    });
    afterEach(() => {
        usingResult.rollback();
        helpers.clear();
    });
    describe("setupPythonExtension()", () => {
        it("does nothing if autoproj python shim does not exist", async () => {
            await subject.setupPythonExtension();

            mockConfiguration.verify((x) => x.update("python.defaultInterpreterPath", It.isAny()), Times.never());
            mockConfiguration.verify((x) => x.update("optOutFrom", It.isAny(), It.isAny()), Times.never());
        })
        it("sets the default python interpreter", async () => {
            helpers.mkdir(".autoproj", "bin");
            helpers.mkfile("", ".autoproj", "bin", "python");

            mockGetConfiguration.setup((x) => x()).returns(() => mockConfiguration.object);
            mockGetConfiguration.setup((x) => x("python.experiments")).returns(() => mockConfiguration.object);
            mockConfiguration.setup((x) => x.get<string[]>("optOutFrom")).returns(() => ["foobar"]);
            await subject.setupPythonExtension();

            const pythonShimPath = path.join(root, ShimsWriter.RELATIVE_SHIMS_PATH, "python");
            mockConfiguration.verify((x) => x.update("python.defaultInterpreterPath", pythonShimPath), Times.once());
            mockConfiguration.verify((x) => x.update("optOutFrom",
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
            mockGetConfiguration.verify((x) => x(It.isAny()), Times.never());
        });
        describe("the dependencies are installed", () => {
            let extensionGemfile: string;
            beforeEach(() => {
                extensionGemfile = path.join(root, ".autoproj", "vscode-autoproj", "Gemfile");
                mockBundleWatcher.setup((x) => x.extensionGemfile).returns(() => extensionGemfile);
                mockBundleWatcher.setup((x) => x.queueInstall()).returns(() => Promise.resolve(0));
            });
            it("sets ruby extension configuration", async () => {
                mockGetConfiguration.setup((x) => x("rubyLsp")).returns(() => mockConfiguration.object);
                await subject.setupRubyExtension();

                const shimsPath = path.join(root, ".autoproj", "vscode-autoproj", "bin");
                mockConfiguration.verify((x) => x.update("rubyVersionManager.identifier", "custom"), Times.once());
                mockConfiguration.verify((x) => x.update("customRubyCommand", `PATH=${shimsPath}:$PATH`), Times.once());
                mockConfiguration.verify((x) => x.update("bundleGemfile", extensionGemfile), Times.once());
            });
        });
    });
});