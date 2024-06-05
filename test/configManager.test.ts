import * as autoproj from "../src/autoproj";
import * as path from "path";
import * as vscode from "vscode";
import { Mocks, WorkspaceBuilder, host } from "./helpers";
import { BundleManager, BundleWatcher } from "../src/bundleWatcher";
import { ConfigManager } from "../src/configManager";
import { using } from "./using";
import { GlobalMock, IGlobalMock, IMock, It, Mock, Times } from "typemoq";
import * as shims from "../src/shimsWriter";

describe("configManager", () => {
    let m: Mocks;
    let workspaces: autoproj.Workspaces;
    let builder: WorkspaceBuilder;
    let mockBundleManager: IMock<BundleManager>;
    let mockShimsWriter: IGlobalMock<shims.ShimsWriter>;
    let subject: ConfigManager;
    beforeEach(() => {
        m = new Mocks();
        builder = new WorkspaceBuilder();
        workspaces = new autoproj.Workspaces();
        workspaces.add(builder.workspace);
        workspaces.addFolder(path.join(builder.root, "autoproj"));
        mockBundleManager = Mock.ofType<BundleManager>();
        mockShimsWriter = GlobalMock.ofType(shims.ShimsWriter, shims);
        using(mockShimsWriter).do(() => {
            subject = new ConfigManager(mockBundleManager.object, workspaces);
        });

        using(m.getConfiguration);
    });
    describe("onWorkspaceRemoved", () => {
        it("stops watching the extension bundle", () => {
            subject.onWorkspaceRemoved(builder.workspace);
            mockBundleManager.verify((x) => x.unwatch(builder.workspace), Times.once());
        });
    });
    describe("setupExtension", () => {
        let mockSubject: IMock<ConfigManager>;
        function assertSetup(times: Times) {
            mockSubject.verify((x) => x.writeShims(), times);
            mockSubject.verify((x) => x.setupTestMate(), times);
            mockSubject.verify((x) => x.setupRubyExtension(), times);
            mockSubject.verify((x) => x.setupPythonExtension(), times);
        }
        function spySubject() {
            mockSubject = Mock.ofInstance(subject);
            mockSubject.setup((x) => x.writeShims());
            mockSubject.setup((x) => x.setupTestMate());
            mockSubject.setup((x) => x.setupRubyExtension());
            mockSubject.setup((x) => x.setupPythonExtension());

            mockSubject.callBase = true;
            subject = mockSubject.object;
        }
        it("does nothing if workspace is empty", async () => {
            workspaces.deleteFolder(path.join(builder.root, "autoproj"));
            spySubject();
            await subject.setupExtension();

            assertSetup(Times.never());
        });
        it("does nothing if multiple workspaces are open", async () => {
            const builder2 = new WorkspaceBuilder();
            workspaces.add(builder2.workspace);
            spySubject();

            await using(m.showErrorMessage).do(async () => {
                await subject.setupExtension();
            });

            assertSetup(Times.never());
            m.showErrorMessage.verify((x) => x("Working on multiple Autoproj workspaces is not supported"),
                Times.once());
        });
        it("does nothing if workspace is not saved", async () => {
            spySubject();
            const mockWorkspace = GlobalMock.ofInstance(vscode.workspace, "workspace", vscode);
            mockWorkspace.setup((x) => x.workspaceFile).returns(() => undefined);

            await using(m.showWarningMessage, mockWorkspace).do(async () => {
                await subject.setupExtension();
            });

            assertSetup(Times.never());
            m.showWarningMessage.verify((x) =>
                x("You must save your workspace for the Autoproj extension to work properly"),
                Times.once());
        });
        it("sets the workspace up", async () => {
            spySubject();
            await subject.setupExtension();
            assertSetup(Times.once());
        });
    });
    describe("setupTestMate()", () => {
        it("sets standard executables to empty string", async () => {
            m.getConfiguration.setup((x) => x("testMate.cpp.test")).returns(() => m.workspaceConfiguration.object);
            subject.setupTestMate();
            m.workspaceConfiguration.verify((x) => x.update("executables", ""), Times.once());
        })
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
            mockBundleWatcher.setup((x) => x.queueInstall()).returns(() => Promise.resolve(1));

            await subject.setupRubyExtension();
            m.getConfiguration.verify((x) => x(It.isAny()), Times.never());
        });
        it("checks bundle state if gemfile exists", async () => {
            const extensionGemfile = path.join(builder.root, ".autoproj", "vscode-autoproj", "Gemfile");
            builder.fs.mkdir(".autoproj", "vscode-autoproj");
            builder.fs.mkfile("", ".autoproj", "vscode-autoproj", "Gemfile");
            mockBundleWatcher.setup((x) => x.extensionGemfile).returns(() => extensionGemfile);
            m.getConfiguration.setup((x) => x("rubyLsp")).returns(() => m.workspaceConfiguration.object);

            await subject.setupRubyExtension();
            mockBundleWatcher.verify((x) => x.check(), Times.once());
            mockBundleWatcher.verify((x) => x.queueInstall(), Times.never());
            m.getConfiguration.verify((x) => x(It.isAny()), Times.exactly(3));
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
                m.workspaceConfiguration.verify((x) => x.update("rubyVersionManager", { identifier: "custom" }), Times.once());
                m.workspaceConfiguration.verify((x) => x.update("customRubyCommand", `PATH=${shimsPath}:$PATH`), Times.once());
                m.workspaceConfiguration.verify((x) => x.update("bundleGemfile", extensionGemfile), Times.once());
            });
        });
    });
    describe("writeShims()", () => {
        it("writes all shims", async () => {
            await subject.writeShims();
            const ws = workspaces.workspaces.values().next().value;
            mockShimsWriter.verify((x) => x.writeGdb(ws), Times.once());
            mockShimsWriter.verify((x) => x.writeOpts(ws), Times.once());
            mockShimsWriter.verify((x) => x.writePython(ws), Times.once());
            mockShimsWriter.verify((x) => x.writeRuby(ws), Times.once());
        });
        it("shows an error message if writing fails", async () => {
            mockShimsWriter.setup((x) => x.writeOpts(It.isAny())).throws(new Error("foo"));
            await using(m.showErrorMessage).do(async () => {
                await subject.writeShims();
            });
            m.showErrorMessage.verify((x) => x(It.is((a) => /foo/.test(a))), Times.once());
        });
    });
    describe("cleanupTestMate()", () => {
        it("does nothing if workspace is empty", async () => {
            workspaces.deleteFolder(path.join(builder.root, "autoproj"));
            await using(m.getConfiguration).do(async () => {
                await subject.cleanupTestMate();
            });
            m.getConfiguration.verify((x) => x("testMate.cpp.test"), Times.never());
        });
        it("remove entries that don't belong to any open package", async () => {
            const pkg1 = builder.addPackage("foo");
            const pkg2 = builder.addPackage("bar");
            const pkg3 = builder.addPackage("loren");

            const advancedExecutables = [
                {
                    name: pkg3.name,
                    pattern: path.join(pkg3.builddir, "test", "test_loren")
                },
                {
                    name: pkg1.name,
                    pattern: path.join(pkg1.builddir, "test", "test_foo")
                },
                {
                    name: pkg2.name,
                    pattern: path.join(pkg2.builddir, "test", "test_bar")
                }
            ];

            workspaces.addFolder(pkg1.srcdir);
            workspaces.addFolder(pkg3.srcdir);
            await workspaces.workspaces.values().next().value.reload();
            await host.addFolders(pkg1.srcdir, pkg3.srcdir);

            m.getConfiguration.setup((x) => x("testMate.cpp.test")).returns(() => m.workspaceConfiguration.object);
            m.workspaceConfiguration.setup((x) => x.get<any[]>("advancedExecutables"))
                .returns(() => advancedExecutables);

            await using(m.getConfiguration).do(async () => {
                await subject.cleanupTestMate();
            });

            const expected = [
                {
                    name: pkg1.name,
                    pattern: path.join(pkg1.builddir, "test", "test_foo")
                },
                {
                    name: pkg3.name,
                    pattern: path.join(pkg3.builddir, "test", "test_loren")
                },
            ]
            m.workspaceConfiguration.verify((x) => x.update("advancedExecutables", expected), Times.once());
        });
    });
});