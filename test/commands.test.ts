"use strict";
import * as assert from "assert";
import * as path from "path";
import { basename, dirname } from "path";
import { GlobalMock, IGlobalMock, IMock, It, Mock, Times } from "typemoq";
import * as _ from "lodash";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as commands from "../src/commands";
import * as progress from "../src/progress";
import { ShimsWriter } from "../src/shimsWriter";
import * as util from "../src/util";
import * as wrappers from "../src/wrappers";
import * as helpers from "./helpers";
import * as mocks from "./mocks";
import { fs } from "../src/cmt/pr";
import { UsingResult, using } from "./using";
import { BundleManager, BundleWatcher } from "../src/bundleWatcher";

describe("Commands", () => {
    let mockChannel: IMock<vscode.LogOutputChannel>;
    let mockWorkspaces: mocks.MockWorkspaces;
    let mockWrapper: IMock<wrappers.VSCode>;
    let mockBundleManager: IMock<BundleManager>
    let subject: commands.Commands;

    beforeEach(() => {
        mockChannel = Mock.ofType<vscode.LogOutputChannel>();
        mockWorkspaces = new mocks.MockWorkspaces();
        mockWrapper = Mock.ofType<wrappers.VSCode>();
        mockBundleManager = Mock.ofType<BundleManager>();
        subject = new commands.Commands(
            mockWorkspaces.object, mockWrapper.object, mockChannel.object, mockBundleManager.object);
    });
    describe("updateWorkspaceEnvironment()", () => {
        let usingResult: UsingResult;
        let execution: util.IAsyncExecution;
        let mockCreateProgress: IGlobalMock<typeof progress.createProgressView>;
        let mockProgressView: IMock<progress.ProgressView>;
        let mockAsyncSpawn: IGlobalMock<typeof util.asyncSpawn>;
        let mockSubject: IMock<commands.Commands>;
        let workspace: autoproj.Workspace;0
        beforeEach(() => {
            mockProgressView = Mock.ofType<progress.ProgressView>();
            mockAsyncSpawn = GlobalMock.ofInstance(util.asyncSpawn, "asyncSpawn", util);
            mockCreateProgress = GlobalMock.ofInstance(progress.createProgressView, "createProgressView", progress);
            workspace = mockWorkspaces.addWorkspace("/path/to/workspace").object;
            mockSubject = Mock.ofInstance(subject);
            subject = mockSubject.target;
            usingResult = using(mockAsyncSpawn, mockCreateProgress);
            usingResult.commit();

            mockCreateProgress.setup((x) => x(It.isAny(), It.isAny())).returns(() => mockProgressView.object);
            mockAsyncSpawn.setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny())).returns(() => execution);
        });
        afterEach(() => {
            usingResult.rollback();
        })
        it("does nothing if canceled", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(undefined));
            await subject.updateWorkspaceEnvironment();
            mockAsyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.never());
        });
        it("throws if spawn fails while updating workspace environment", async () => {
            mockWrapper.reset();
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));

            execution = {
                childProcess: undefined as any,
                returnCode: Promise.reject(new Error("ENOENT"))
            };
            await assert.rejects(subject.updateWorkspaceEnvironment(), /Could not update/);
            await assert.rejects(subject.updateWorkspaceEnvironment(), /Could not update/);
            mockAsyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.exactly(2));
        });
        it("throws if workspace environment update fails", async () => {
            mockWrapper.reset();
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));

            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(2)
            };
            await assert.rejects(subject.updateWorkspaceEnvironment(), /Failed while updating/);
            await assert.rejects(subject.updateWorkspaceEnvironment(), /Failed while updating/);
            mockAsyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.exactly(2));
        });
        it("does not run envsh if another update is pending", async () => {
            mockWrapper.reset();
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));

            let resolveReturnCode: (returnCode: number | null) => void;
            const returnCode = new Promise<number | null>((resolve) => resolveReturnCode = resolve);
            execution = {
                childProcess: undefined as any,
                returnCode: returnCode
            };

            const promises = [
                subject.updateWorkspaceEnvironment(),
                subject.updateWorkspaceEnvironment()
            ]

            resolveReturnCode!(0);
            await Promise.all(promises);
            mockAsyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.once());
        });
        it("updates workspace environment", async () => {
            mockWrapper.reset();
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));

            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(0)
            };

            await subject.updateWorkspaceEnvironment();
            await subject.updateWorkspaceEnvironment();
            mockAsyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.exactly(2));
        });
    });
    describe("showWorkspacePicker()", () => {
        let choices: { label, description, workspace }[];
        function makeChoice(ws: autoproj.Workspace) {
            return {
                description: basename(dirname(ws.root)),
                label: `$(root-folder) ${basename(ws.root)}`,
                workspace: ws,
            };
        }
        beforeEach(() => {
            choices = [];
        });
        it("throws if there are no autoproj workspaces", async () => {
            await helpers.assertThrowsAsync(subject.showWorkspacePicker(),
                /No Autoproj workspace/);
        });
        it("skip picker if there is only one workspace", async () => {
            const workspace = mockWorkspaces.addWorkspace("/ws/one").object;
            const ws = await subject.showWorkspacePicker();
            mockWrapper.verify((x) => x.showQuickPick(It.isAny(), It.isAny()), Times.never());
            assert.strictEqual(ws, workspace);
        });
        it("returns undefined if canceled", async () => {
            const wsOne = mockWorkspaces.addWorkspace("/ws/one").object;
            const wsTwo = mockWorkspaces.addWorkspace("/ws/two").object;
            choices.push(makeChoice(wsOne));
            choices.push(makeChoice(wsTwo));

            mockWrapper.setup((x) => x.showQuickPick(choices, It.isAny())).returns(() => Promise.resolve(undefined));
            const ws = await subject.showWorkspacePicker();
            assert(!ws);
        });
        it("returns the picked workspace", async () => {
            const wsOne = mockWorkspaces.addWorkspace("/ws/one").object;
            const wsTwo = mockWorkspaces.addWorkspace("/ws/two").object;
            choices.push(makeChoice(wsOne));
            choices.push(makeChoice(wsTwo));

            mockWrapper.setup((x) => x.showQuickPick(choices, It.isAny())).returns(() => Promise.resolve(choices[0]));
            const ws = await subject.showWorkspacePicker();
            mockWrapper.verify((x) => x.showQuickPick(choices, It.isAny()), Times.once());
            assert.strictEqual(ws, choices[0].workspace);
        });
    });
    describe("packagePickerChoices()", () => {
        let packageOne: autoproj.IPackage;
        let packageTwo: autoproj.IPackage;
        beforeEach(() => {
            packageOne = mockWorkspaces.addPackageToWorkspace("/path/to/one", "/path/to").object;
            packageTwo = mockWorkspaces.addPackageToWorkspace("/path/to/two", "/path/to").object;
            mockWorkspaces.addPackageSetToWorkspace("/path/to/autoproj/remotes/set.one", "/path/to");
        });
        it("throws if installation manifest loading fails", async () => {
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);
            mockWorkspaces.invalidateWorkspaceInfo("/path/to");
            await helpers.assertThrowsAsync(subject.packagePickerChoices(),
                /Could not load installation manifest/);
        });
        it("returns all packages if workspace is empty", async () => {
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);

            const choices = await subject.packagePickerChoices();
            assert.deepStrictEqual(choices, [
                {
                    description: "to (buildconf)",
                    label: "$(root-folder) autoproj",
                    folder: {
                        name: "autoproj (to)",
                        uri: vscode.Uri.file("/path/to/autoproj")
                    }
                },
                {
                    description: "to",
                    label: "$(folder) one",
                    folder: {
                        name: packageOne.name,
                        uri: vscode.Uri.file(packageOne.srcdir)
                    }
                },
                {
                    description: "to (package set)",
                    label: "$(folder-library) set.one",
                    folder: {
                        name: "set.one (package set)",
                        uri: vscode.Uri.file("/path/to/autoproj/remotes/set.one")
                    }
                },
                {
                    description: "to",
                    label: "$(folder) two",
                    folder: {
                        name: packageTwo.name,
                        uri: vscode.Uri.file(packageTwo.srcdir)
                    }
                },
            ]);
        });
        it("returns packages that are not in the current workspace", async () => {
            const folder1: vscode.WorkspaceFolder = {
                index: 0,
                name: "autoproj (buildconf)",
                uri: vscode.Uri.file("/path/to/autoproj"),
            };
            const folder2: vscode.WorkspaceFolder = {
                index: 1,
                name: "set.one (package set)",
                uri: vscode.Uri.file("/path/to/autoproj/remotes/set.one"),
            };
            const folder3: vscode.WorkspaceFolder = {
                index: 2,
                name: "one",
                uri: vscode.Uri.file("/path/to/one"),
            };
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => [folder1, folder2, folder3]);

            const choices = await subject.packagePickerChoices();
            assert.deepStrictEqual(choices, [{
                description: "to",
                label: "$(folder) two",
                folder: {
                    name: packageTwo.name,
                    uri: vscode.Uri.file(packageTwo.srcdir)
                }
            }]);
        });
    });
    describe("addPackageToWorkspace()", () => {
        let mockSubject: IMock<commands.Commands>;
        let packageOne: autoproj.IPackage;
        let packageTwo: autoproj.IPackage;
        let choices: { label, description, folder }[] = [];
        const options: vscode.QuickPickOptions = {
            matchOnDescription: true,
            placeHolder: "Select a package to add to this workspace",
        };
        beforeEach(() => {
            packageOne = mockWorkspaces.addPackageToWorkspace("/path/to/drivers/one", "/path/to").object;
            packageTwo = mockWorkspaces.addPackageToWorkspace("/path/to/tools/two", "/path/to").object;
            choices = [{
                description: "to",
                label: "$(folder) one",
                folder: { name: packageOne.name, uri: vscode.Uri.file(packageOne.srcdir) }
            },
            {
                description: "to",
                label: "$(folder) two",
                folder: { name: packageTwo.name, uri: vscode.Uri.file(packageTwo.srcdir) }
            }];
            mockSubject = Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("throws if manifest loading fails", async () => {
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => Promise.reject(new Error("test")));
            await assert.rejects(subject.addPackageToWorkspace(), /test/);
        });
        it("shows a quick pick ui", async () => {
            const promise = Promise.resolve(choices);
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => promise);
            await subject.addPackageToWorkspace();
            mockWrapper.verify((x) => x.showQuickPick(choices, options), Times.once());
        });
        it("sorts the folder list", async () => {
            mockWorkspaces.addPackageSetToWorkspace("/path/to/autoproj/remotes/set.foo", "/path/to");
            const folders: vscode.WorkspaceFolder[] = [
                {
                    index: 0,
                    name: "autoproj (to)",
                    uri: vscode.Uri.file("/path/to/autoproj"),
                },
                {
                    index: 1,
                    name: "tools/two",
                    uri: vscode.Uri.file("/path/to/tools/two"),
                },
                {
                    index: 2,
                    name: "set.foo (package set)",
                    uri: vscode.Uri.file("/path/to/autoproj/remotes/set.foo"),
                }
            ];

            type Folder = { name: string, uri: vscode.Uri };
            const sortedFolders = [
                It.is((x: Folder) => x.name == folders[0].name && x.uri.fsPath == folders[0].uri.fsPath),
                It.is((x: Folder) => x.name == folders[2].name && x.uri.fsPath == folders[2].uri.fsPath),
                It.is((x: Folder) => x.name == "drivers/one" && x.uri.fsPath == "/path/to/drivers/one"),
                It.is((x: Folder) => x.name == folders[1].name && x.uri.fsPath == folders[1].uri.fsPath)
            ];

            const promise = Promise.resolve(choices);
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => folders);
            mockSubject.setup((x) => x.packagePickerChoices()). returns(() => promise);
            mockWrapper.setup((x) => x.updateWorkspaceFolders(0, 3, ...sortedFolders)).returns(() => true);
            mockWrapper.setup((x) => x.showQuickPick(choices, options)).returns(() => Promise.resolve(choices[0]));
            await subject.addPackageToWorkspace();
            mockWrapper.verify((x) => x.updateWorkspaceFolders(0, 3, ...sortedFolders), Times.once());
        });
        it("shows an error if folder could not be added", async () => {
            const promise = Promise.resolve(choices);
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => promise);
            mockWrapper.setup((x) => x.showQuickPick(choices, options)).returns(() => Promise.resolve(choices[1]));
            mockWrapper.setup((x) => x.updateWorkspaceFolders(0, null,
                    { uri: vscode.Uri.file("/path/to/tools/two") })).returns(() => false);

            await assert.rejects(subject.addPackageToWorkspace(), /Could not add folder: \/path\/to\/tools\/two/);
        });
    });
    describe("setupPythonDefaultInterpreter()", () => {
        it("shows an error message if workspace is empty", async () => {
            await assert.rejects(subject.setupPythonDefaultInterpreter(),
                /Cannot setup Python default interpreter for an empty workspace/);
        });
        it("shows an error message when working with multiple autoproj workspaces", async () => {
            mockWorkspaces.addWorkspace("/ws/one");
            mockWorkspaces.addWorkspace("/ws/two");
            await assert.rejects(subject.setupPythonDefaultInterpreter(),
                /Cannot setup Python default interpreter for multiple Autoproj workspaces/);
        })
        it("sets the default python interpreter", async () => {
            mockWorkspaces.addWorkspace("/ws/one");
            const mockConfiguration = Mock.ofType<vscode.WorkspaceConfiguration>();
            mockWrapper.setup((x) => x.getConfiguration()).returns(() => mockConfiguration.object);
            mockWrapper.setup((x) => x.getConfiguration("python.experiments")).returns(() => mockConfiguration.object);
            mockConfiguration.setup((x) => x.get<string[]>("optOutFrom")).returns(() => ["foobar"]);
            await subject.setupPythonDefaultInterpreter();

            const pythonShimPath = path.join("/ws/one", ShimsWriter.RELATIVE_SHIMS_PATH, "python");
            mockConfiguration.verify((x) => x.update("python.defaultInterpreterPath", pythonShimPath), Times.once());
            mockConfiguration.verify((x) => x.update("optOutFrom",
                ["foobar", "pythonTestAdapter"], vscode.ConfigurationTarget.Global), Times.once());
        })
    });
    describe("setupTestMateDebugConfig()", () => {
        it("shows an error message if workspace is empty", async () => {
            await assert.rejects(subject.setupTestMateDebugConfig(), /Cannot setup TestMate/);
        });
        it("shows an error message when working with multiple autoproj workspaces", async () => {
            mockWorkspaces.addWorkspace("/ws/one");
            mockWorkspaces.addWorkspace("/ws/two");
            await assert.rejects(subject.setupTestMateDebugConfig(), /Cannot setup TestMate/);
        })
        it("sets the default python interpreter", async () => {
            mockWorkspaces.addWorkspace("/ws/one");
            const mockConfiguration = Mock.ofType<vscode.WorkspaceConfiguration>();
            mockWrapper.setup((x) => x.getConfiguration("testMate.cpp.debug")).returns(() => mockConfiguration.object);
            await subject.setupTestMateDebugConfig();

            const gdbShimPath = path.join("/ws/one", ShimsWriter.RELATIVE_SHIMS_PATH, "gdb");
            const configTemplate = {
                "type": "cppdbg",
                "MIMode": "gdb",
                "program": "${exec}",
                "args": "${argsArray}",
                "cwd": "${cwd}",
                "miDebuggerPath": gdbShimPath
            }
            mockConfiguration.verify((x) => x.update("configTemplate", configTemplate), Times.once());
        })
    });
    describe("setupRubyExtension()", () => {
        it("shows an error message if workspace is empty", async () => {
            await assert.rejects(subject.setupRubyExtension(),
                /Cannot setup Ruby extension for an empty workspace/);
        });
        it("shows an error message when working with multiple autoproj workspaces", async () => {
            mockWorkspaces.addWorkspace("/ws/one");
            mockWorkspaces.addWorkspace("/ws/two");
            await assert.rejects(subject.setupRubyExtension(),
                /Cannot setup Ruby extension for multiple Autoproj workspaces/);
        });
        describe("in a real workspace", () => {
            let root: string;
            let mockWorkspace: IMock<autoproj.Workspace>;
            let mockBundleWatcher: IMock<BundleWatcher>;
            beforeEach(() => {
                root = helpers.init();
                mockBundleWatcher = Mock.ofType<BundleWatcher>();
                mockWorkspace = mockWorkspaces.addWorkspace(root);
            });
            afterEach(() => {
                helpers.clear();
            });
            it("does nothing if dependencies cannot be installed", async () => {
                // create a file instead of a directory to force error
                mockBundleWatcher.setup((x) => x.queueInstall()).returns(() => Promise.resolve(1));
                mockBundleManager.setup((x) => x.getWatcher(mockWorkspace.object))
                    .returns(() => mockBundleWatcher.object);

                await subject.setupRubyExtension();
                mockWrapper.verify((x) => x.getConfiguration(It.isAny()), Times.never());
            });
            describe("the dependencies are installed", () => {
                let extensionGemfile: string;
                beforeEach(() => {
                    extensionGemfile = path.join(root, ".autoproj", "vscode-autoproj", "Gemfile");
                    mockBundleWatcher.setup((x) => x.extensionGemfile).returns(() => extensionGemfile);
                    mockBundleWatcher.setup((x) => x.queueInstall()).returns(() => Promise.resolve(0));
                    mockBundleManager.setup((x) => x.getWatcher(mockWorkspace.object))
                        .returns(() => mockBundleWatcher.object);
                });
                it("sets ruby extension configuration", async () => {
                    const mockConfiguration = Mock.ofType<vscode.WorkspaceConfiguration>();
                    mockWrapper.setup((x) => x.getConfiguration("rubyLsp")).returns(() => mockConfiguration.object);

                    await subject.setupRubyExtension();

                    const shimsPath = path.join(root, ".autoproj", "vscode-autoproj", "bin");
                    mockConfiguration.verify((x) => x.update("rubyVersionManager.identifier", "custom"), Times.once());
                    mockConfiguration.verify((x) => x.update("customRubyCommand", `PATH=${shimsPath}:$PATH`), Times.once());
                    mockConfiguration.verify((x) => x.update("bundleGemfile", extensionGemfile), Times.once());
                });
            });
        });
    });
    describe("guessCurrentTestBinaryDir()", () => {
        let root: string;
        let builder: helpers.WorkspaceBuilder;
        let workspaces: autoproj.Workspaces;
        let pkg: autoproj.IPackage;
        beforeEach(() => {
            root = helpers.init();
            builder = new helpers.WorkspaceBuilder(root);
            workspaces = new autoproj.Workspaces();
            subject = new commands.Commands(
                workspaces, mockWrapper.object, mockChannel.object, mockBundleManager.object);

            pkg = builder.addPackage("foobar");
            workspaces.addFolder(pkg.srcdir);
        });
        afterEach(() => {
            helpers.clear();
        })
        it("returns the first workspace root if no editors are open", async () => {
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(root).fsPath);
        });
        it("returns the first workspace root if the current open file is not in any workspace", async () => {
            mockWrapper.setup((x) => x.activeDocumentURI).returns(() => vscode.Uri.file("/path/to/file.cpp"));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(root).fsPath);
        });
        it("returns the first workspace root if the current open file is not in any package", async () => {
            mockWrapper.setup((x) => x.activeDocumentURI).returns(() => vscode.Uri.file(path.join(root, "file.cpp")));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(root).fsPath);
        });
        it("returns the first workspace root if the build folder does not exist", async () => {
            helpers.rmdir(...builder.packageBuildDir(pkg.name));
            mockWrapper.setup((x) => x.activeDocumentURI).returns(() => vscode.Uri.file(path.join(pkg.srcdir, "file.cpp")));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(root).fsPath);
        });
        it("returns the build folder if test folder does not exist", async () => {
            mockWrapper.setup((x) => x.activeDocumentURI).returns(() => vscode.Uri.file(path.join(pkg.srcdir, "file.cpp")));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, pkg.builddir);
        });
        it("returns the test folder if it exists", async () => {
            helpers.mkdir(...builder.packageBuildDir(pkg.name), "test");
            mockWrapper.setup((x) => x.activeDocumentURI).returns(() => vscode.Uri.file(path.join(pkg.srcdir, "file.cpp")));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, path.join(pkg.builddir, "test"));
        });
    });
    describe("startDebugging()", () => {
        let root: string;
        let builder: helpers.WorkspaceBuilder;
        let workspaces: autoproj.Workspaces;
        let pkg: autoproj.IPackage;
        let testArguments: string;
        let testExecutable: vscode.Uri;
        beforeEach(() => {
            root = helpers.init();
            builder = new helpers.WorkspaceBuilder(root);
            workspaces = new autoproj.Workspaces();
            subject = new commands.Commands(
                workspaces, mockWrapper.object, mockChannel.object, mockBundleManager.object);

            pkg = builder.addPackage("foobar");
            workspaces.addFolder(pkg.srcdir);

            const openDialogReturn = () => Promise.resolve(testExecutable ? [testExecutable] : undefined);
            mockWrapper.setup((x) => x.showOpenDialog(It.isAny())).returns(openDialogReturn);
            mockWrapper.setup((x) => x.showInputBox(It.isAny())).returns(() => Promise.resolve(testArguments));
        });
        afterEach(() => {
            helpers.clear();
        })
        it("throws if workspace is empty", async () => {
            workspaces.deleteFolder(pkg.srcdir);
            await assert.rejects(subject.startDebugging(), new Error("Cannot debug an empty workspace"));
        });
        it("aborts if canceled while waiting for program selection", async () => {
            await subject.startDebugging();
            mockWrapper.verify((x) => x.showInputBox(It.isAny()), Times.never());
        });
        it("aborts if canceled while waiting for program arguments", async () => {
            testExecutable = vscode.Uri.file(path.join(pkg.builddir, "test", "test_suite"));
            await subject.startDebugging();
            mockWrapper.verify((x) => x.startDebugging(It.isAny(), It.isAny()), Times.never());
        });
        it("throws if the selected program is not in the workspace", async () => {
            testExecutable = vscode.Uri.file(path.join("/test", "test_suite"));
            testArguments = "";
            await assert.rejects(subject.startDebugging(),
                new Error("The selected program is not in any open Autoproj workspace"));
        });
        describe("when a debugging session is started", () => {
            let ws: autoproj.Workspace;
            beforeEach(() => {
                testArguments = "";
                testExecutable = vscode.Uri.file(path.join(pkg.builddir, "test", "test_suite"));
                ws = [...workspaces.workspaces.values()][0];
            });
            function assertStartsDebuggingWith(config: any) {
                const matches = It.is(_.matches(config));
                mockWrapper.verify((x) => x.startDebugging(It.isAny(), matches), Times.once());
            }
            it("splits the test arguments", async () => {
                testArguments = "--gtest_filter=*foobar* --gtest_catch_exceptions=0";
                await subject.startDebugging();
                const args = ["--gtest_filter=*foobar*", "--gtest_catch_exceptions=0"];
                assertStartsDebuggingWith({ "args": args });
            });
            it("sets the debugger path", async () => {
                await subject.startDebugging();
                const debuggerPath = path.join(root, ShimsWriter.RELATIVE_SHIMS_PATH, "gdb")
                assertStartsDebuggingWith({ "miDebuggerPath": debuggerPath });
            });
            it("sets working dir to program dir", async () => {
                await subject.startDebugging();
                assertStartsDebuggingWith({ "cwd": path.dirname(testExecutable.fsPath) });
            });
            it("uses pkg name and ws name in config name when in builddir", async () => {
                testExecutable = vscode.Uri.file(path.join(pkg.builddir, "test", "test_suite"));
                await subject.startDebugging();
                assertStartsDebuggingWith({ "name": `${pkg.name}/test_suite (${ws.name})` });
            });
            it("uses pkg name and ws name in config name when in srcdir", async () => {
                testExecutable = vscode.Uri.file(path.join(pkg.srcdir, "test", "test_suite"));
                await subject.startDebugging();
                assertStartsDebuggingWith({ "name": `${pkg.name}/test_suite (${ws.name})` });
            });
            it("uses ws name in config name when binary is from unknown pkg", async () => {
                testExecutable = vscode.Uri.file(path.join(ws.root, "some_binary"));
                await subject.startDebugging();
                assertStartsDebuggingWith({ "name": `some_binary (${ws.name})` });
            });
            it("saves debugging session for later use", async () => {
                const wsFolder: vscode.WorkspaceFolder = {
                    index: 0,
                    name: pkg.name,
                    uri: vscode.Uri.file(pkg.srcdir)
                }

                let selectedWs;
                let selectedConfig

                mockWrapper.setup((x) => x.getWorkspaceFolder(It.isAny())).returns(() => wsFolder);
                mockWrapper.setup((x) => x.startDebugging(It.isAny(), It.isAny())).callback((ws, config) => {
                    selectedWs = ws;
                    selectedConfig = config;
                });

                await subject.startDebugging();
                assert.deepEqual({ ws: selectedWs, config: selectedConfig }, subject["_lastDebuggingSession"]);
            });
        });
    });
    describe("restartDebugging()", () => {
        it("restarts last debugging session", async () => {
            const wsFolder: vscode.WorkspaceFolder = {
                index: 0,
                name: "foobar",
                uri: vscode.Uri.file("/path/to/ws/src/foobar")
            }
            const config = { name: "launch (gdb)" };
            subject["_lastDebuggingSession"]= { ws: wsFolder, config: config! } as any;
            await subject.restartDebugging();
            mockWrapper.verify((x) => x.startDebugging(wsFolder, config as any), Times.once());
        });
        it("throws if no debugging session was started", async () => {
            await assert.rejects(subject.restartDebugging(), /You have not started a debugging session yet/);
        });
    });
    describe("saveLastDebuggingSession()", () => {
        it("throws if no debugging session was started", async () => {
            await assert.rejects(subject.saveLastDebuggingSession(), /You have not started a debugging session yet/);
        });
        it("throws if workspace is empty", async () => {
            subject["_lastDebuggingSession"] = { ws: "" as any, config: "" as any };
            await assert.rejects(subject.saveLastDebuggingSession(),
                /Cannot save a debugging session in an empty workspace/);
        });
        describe("in a non empty workspace", () => {
            let builder: helpers.WorkspaceBuilder;
            let pkg: autoproj.IPackage;
            let root: string;
            let workspaces: autoproj.Workspaces;
            let mockWorkspaceConfig: IMock<vscode.WorkspaceConfiguration>;
            let currentConfigs: { name: string }[];
            beforeEach(() => {
                root = helpers.init();
                builder = new helpers.WorkspaceBuilder(root);
                workspaces = new autoproj.Workspaces();
                subject = new commands.Commands(
                    workspaces, mockWrapper.object, mockChannel.object, mockBundleManager.object);
                mockWorkspaceConfig = Mock.ofType<vscode.WorkspaceConfiguration>();

                pkg = builder.addPackage("foobar");
                workspaces.addFolder(pkg.srcdir);
                subject["_lastDebuggingSession"] = { ws: "" as any, config: { name: "foobar (gdb)" } as any };
                mockWrapper.setup((x) => x.getConfiguration("launch")).returns(() => mockWorkspaceConfig.object);
                mockWorkspaceConfig.setup((x) => x.configurations).returns(() => currentConfigs);
            });
            it("does not add the same launch configuration", async () => {
                currentConfigs = [{ name: "foobar (gdb)" }]
                await subject.saveLastDebuggingSession();
                mockWorkspaceConfig.verify((x) => x.update(It.isAny(), It.isAny()), Times.never());
            });
            it("sorts launch configurations while addings", async () => {
                currentConfigs = [{ name: "a" }, { name: "c"}];
                subject["_lastDebuggingSession"] = { ws: "" as any, config: { name: "b" } as any };
                await subject.saveLastDebuggingSession();
                const expectedConfigs = [{ name: "a" }, { name: "b" }, { name: "c" }];
                const isEqual = (received) => { return It.is((value) => { return _.isEqual(value, received); }) };
                mockWorkspaceConfig.verify((x) => x.update("configurations", isEqual(expectedConfigs)), Times.once());
            });
            afterEach(() => {
                helpers.clear();
            });
        });
    });
    describe("enableCmakeDebuggingSymbols()", () => {
        it("shows an error message if workspace is empty", async () => {
            await assert.rejects(subject.enableCmakeDebuggingSymbols(),
                /Cannot enable CMake debugging symbols on an empty workspace/);
        });
        describe("in a real workspace", () => {
            let mockSubject: IMock<commands.Commands>;
            let mockWorkspaceConfig: IMock<vscode.WorkspaceConfiguration>;
            let root: string;
            let supression: boolean;
            beforeEach(() => {
                root = helpers.init();
                new helpers.WorkspaceBuilder(root);
                const workspaces = new autoproj.Workspaces();

                workspaces.addFolder(root);
                mockWorkspaceConfig = Mock.ofType<vscode.WorkspaceConfiguration>();

                mockWrapper.setup((x) => x.getConfiguration("autoproj")).returns(() => mockWorkspaceConfig.object);
                mockWorkspaceConfig.setup((x) => x.get<boolean>("supressCmakeBuildTypeOverrideNotice"))
                    .returns(() => supression);

                supression = false;
                subject = new commands.Commands(
                    workspaces, mockWrapper.object, mockChannel.object, mockBundleManager.object);
            });
            afterEach(() => {
                helpers.clear();
            });
            function assertNotice(show: boolean) {
                const times = show ? Times.once() : Times.never();
                mockWrapper.verify((x) => x.showInformationMessage(
                    It.isAny(), It.isAny(), It.isAny(), It.isAny()), times);
            }
            function assertSetSupression(update: boolean) {
                const times = update ? Times.once() : Times.never();
                mockWorkspaceConfig.verify((x) => x.update("supressCmakeBuildTypeOverrideNotice", true), times);
            }
            it("does nothing if user cancels", async () => {
                mockSubject = Mock.ofInstance(subject);
                mockSubject.callBase = true;
                mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(undefined));

                await mockSubject.object.enableCmakeDebuggingSymbols();
                assertNotice(false);
            });
            it("throws if script cannot be created", async () => {
                helpers.mkfile("", "autoproj");
                await assert.rejects(subject.enableCmakeDebuggingSymbols(), /Could not create overrides script/);
                assertNotice(false);
            });
            describe("the overrides script is created", () => {
                let filePath: string;
                beforeEach(() => {
                    helpers.registerDir("autoproj")
                    helpers.registerDir("autoproj", "overrides.d");
                    helpers.registerFile("autoproj", "overrides.d", "vscode-autoproj-cmake-build-type.rb");
                    filePath = path.join(root, "autoproj", "overrides.d", "vscode-autoproj-cmake-build-type.rb");
                });
                it("creates the overrides script", async () => {
                    await subject.enableCmakeDebuggingSymbols();
                    assert(await fs.exists(filePath));
                    assertNotice(true);
                    assertSetSupression(false);
                });
                it("does not show notice if supressed", async () => {
                    supression = true;
                    await subject.enableCmakeDebuggingSymbols();
                    assertNotice(false);
                    assertSetSupression(false);
                });
                it("supresses future notices", async () => {
                    const doNotShowAgainClicked = Promise.resolve({ isCloseAffordance: false });
                    mockWrapper.setup((x) => x.showInformationMessage(
                        It.isAny(), It.isAny(), It.isAny(), It.isAny())).returns(() => doNotShowAgainClicked);

                    await subject.enableCmakeDebuggingSymbols();
                    assertSetSupression(true);
                });
            });
        });
    });
    describe("handleError()", () => {
        it("runs and handles errors on functions and async functions", async () => {
            const fn = Mock.ofInstance(() => {});
            const asyncFn = Mock.ofInstance(async () => { });

            await subject.handleError(fn.object);
            await subject.handleError(asyncFn.object);

            await subject.handleError(() => { throw new Error("foobar"); });
            await subject.handleError(async () => { throw new Error("foobar"); });

            fn.verify((x) => x(), Times.once());
            asyncFn.verify((x) => x(), Times.once());
            mockWrapper.verify((x) => x.showErrorMessage("foobar"), Times.exactly(2));
        });
    });
    describe("register()", () => {
        function setupMocks(methodName: string, command: string) {
            mockWrapper.setup((x) => x.registerAndSubscribeCommand(command, It.isAny())).callback((_, cb) => cb());

            const mock = Mock.ofInstance(() => Promise.resolve());
            Object.assign(subject, {...subject, [methodName]: mock.object });

            return mock;
        }
        it("registers all commands", async () => {
            const mocks = [
                setupMocks("updateWorkspaceEnvironment", "autoproj.updateWorkspaceEnvironment"),
                setupMocks("addPackageToWorkspace", "autoproj.addPackageToWorkspace"),
                setupMocks("setupRubyExtension", "autoproj.setupRubyExtension"),
                setupMocks("startDebugging", "autoproj.startDebugging"),
                setupMocks("saveLastDebuggingSession", "autoproj.saveLastDebuggingSession"),
                setupMocks("restartDebugging", "autoproj.restartDebugging"),
                setupMocks("enableCmakeDebuggingSymbols", "autoproj.enableCmakeDebuggingSymbols"),
                setupMocks("setupTestMateDebugConfig","autoproj.setupTestMateDebugConfig"),
                setupMocks("setupPythonDefaultInterpreter","autoproj.setupPythonDefaultInterpreter")
            ];

            subject.register();
            for (const mock of mocks) {
                mock.verify((x) => x(), Times.once());
            }
        });
    });
});
