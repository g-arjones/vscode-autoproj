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
import { fs } from "../src/cmt/pr";
import { using } from "./using";
import { host, Mocks, TempFS, WorkspaceBuilder } from "./helpers";
import { rmdirSync, unlinkSync } from "fs";

describe("Commands", () => {
    let mocks: Mocks;
    let builder1: WorkspaceBuilder;
    let builder2: WorkspaceBuilder;
    let workspaces: autoproj.Workspaces;
    let subject: commands.Commands;

    beforeEach(() => {
        builder1 = new WorkspaceBuilder();
        builder2 = new WorkspaceBuilder();
        mocks = new Mocks();
        workspaces = new autoproj.Workspaces();
        subject = new commands.Commands(workspaces, mocks.logOutputChannel.object);
    });
    describe("updateWorkspaceEnvironment()", () => {
        let execution: util.IAsyncExecution;
        let mockProgressView: IMock<progress.ProgressView>;
        let mockSubject: IMock<commands.Commands>;
        let workspace: autoproj.Workspace;
        beforeEach(() => {
            mockProgressView = Mock.ofType<progress.ProgressView>();
            workspace = builder1.workspace;
            mockSubject = Mock.ofInstance(subject);
            subject = mockSubject.target;
            using(mocks.asyncSpawn, mocks.createProgressView);

            mocks.createProgressView.setup((x) => x(It.isAny())).returns(() => mockProgressView.object);
            mocks.asyncSpawn.setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny())).returns(() => execution);
        });
        it("does nothing if canceled", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(undefined));
            await subject.updateWorkspaceEnvironment();
            mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.never());
        });
        it("throws if spawn fails while updating workspace environment", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));

            execution = {
                childProcess: undefined as any,
                returnCode: Promise.reject(new Error("ENOENT"))
            };
            await assert.rejects(subject.updateWorkspaceEnvironment(), /Could not update/);
            await assert.rejects(subject.updateWorkspaceEnvironment(), /Could not update/);
            mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.exactly(2));
        });
        it("throws if workspace environment update fails", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));

            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(2)
            };
            await assert.rejects(subject.updateWorkspaceEnvironment(), /Failed while updating/);
            await assert.rejects(subject.updateWorkspaceEnvironment(), /Failed while updating/);
            mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.exactly(2));
        });
        it("does not run envsh if another update is pending", async () => {
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
            mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.once());
        });
        it("updates workspace environment", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));

            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(0)
            };

            await subject.updateWorkspaceEnvironment();
            await subject.updateWorkspaceEnvironment();
            mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.exactly(2));
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
            using(mocks.showQuickPick);
        });
        it("throws if there are no autoproj workspaces", async () => {
            await assert.rejects(subject.showWorkspacePicker(), /No Autoproj workspace/);
        });
        it("skip picker if there is only one workspace", async () => {
            workspaces.add(builder1.workspace);
            const ws = await subject.showWorkspacePicker();
            mocks.showQuickPick.verify((x) => x(It.isAny(), It.isAny()), Times.never());
            assert.strictEqual(ws, builder1.workspace);
        });
        it("returns undefined if canceled", async () => {
            workspaces.add(builder1.workspace);
            workspaces.add(builder2.workspace);
            choices.push(makeChoice(builder1.workspace));
            choices.push(makeChoice(builder2.workspace));

            mocks.showQuickPick.setup((x) => x(choices, It.isAny())).returns(() => Promise.resolve(undefined));
            const ws = await subject.showWorkspacePicker();
            assert(!ws);
        });
        it("returns the picked workspace", async () => {
            workspaces.add(builder1.workspace);
            workspaces.add(builder2.workspace);
            choices.push(makeChoice(builder1.workspace));
            choices.push(makeChoice(builder2.workspace));

            mocks.showQuickPick.setup((x) => x(choices, It.isAny() as vscode.QuickPickOptions))
                .returns(() => Promise.resolve(choices[0]));

            const ws = await subject.showWorkspacePicker();
            mocks.showQuickPick.verify((x) => x(choices, It.isAny()), Times.once());
            assert.strictEqual(ws, choices[0].workspace);
        });
    });
    describe("packagePickerChoices()", () => {
        let packageOne: autoproj.IPackage;
        let packageTwo: autoproj.IPackage;
        let packageSetOne: autoproj.IPackageSet;
        beforeEach(() => {
            packageOne = builder1.addPackage("one");
            packageTwo = builder1.addPackage("two");
            packageSetOne = builder1.addPackageSet("set.one");
            workspaces.add(builder1.workspace);
        });
        it("throws if installation manifest loading fails", async () => {
            await fs.unlink(builder1.fs.fullPath(".autoproj", "installation-manifest"));
            await assert.rejects(subject.packagePickerChoices(), /Could not load installation manifest/);
        });
        it("returns all packages if workspace is empty", async () => {
            const choices = await subject.packagePickerChoices();
            assert.deepStrictEqual(choices, [
                {
                    description: `${builder1.workspace.name} (buildconf)`,
                    label: "$(root-folder) autoproj",
                    folder: {
                        name: `autoproj (${builder1.workspace.name})`,
                        uri: vscode.Uri.file(builder1.fs.fullPath("autoproj"))
                    }
                },
                {
                    description: builder1.workspace.name,
                    label: "$(folder) one",
                    folder: {
                        name: packageOne.name,
                        uri: vscode.Uri.file(packageOne.srcdir)
                    }
                },
                {
                    description: `${builder1.workspace.name} (package set)`,
                    label: "$(folder-library) set.one",
                    folder: {
                        name: "set.one (package set)",
                        uri: vscode.Uri.file(builder1.fs.fullPath("autoproj", "remotes", "set.one"))
                    }
                },
                {
                    description: builder1.workspace.name,
                    label: "$(folder) two",
                    folder: {
                        name: packageTwo.name,
                        uri: vscode.Uri.file(packageTwo.srcdir)
                    }
                },
            ]);
        });
        it("returns packages that are not in the current workspace", async () => {
            workspaces.addFolder(builder1.fs.fullPath("autoproj"));
            workspaces.addFolder(packageSetOne.user_local_dir);
            workspaces.addFolder(packageOne.srcdir);
            await host.addFolders(
                builder1.fs.fullPath("autoproj"),
                packageSetOne.user_local_dir,
                packageOne.srcdir
            )

            const choices = await subject.packagePickerChoices();
            assert.deepStrictEqual(choices, [{
                description: builder1.workspace.name,
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
            packageOne = builder1.addPackage("one");
            packageTwo = builder1.addPackage("two");
            workspaces.add(builder1.workspace);
            choices = [{
                description: builder1.workspace.name,
                label: "$(folder) one",
                folder: { name: packageOne.name, uri: vscode.Uri.file(packageOne.srcdir) }
            },
            {
                description: builder1.workspace.name,
                label: "$(folder) two",
                folder: { name: packageTwo.name, uri: vscode.Uri.file(packageTwo.srcdir) }
            }];
            mockSubject = Mock.ofInstance(subject);
            subject = mockSubject.target;
            using(mocks.showQuickPick);
        });
        it("throws if manifest loading fails", async () => {
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => Promise.reject(new Error("test")));
            await assert.rejects(subject.addPackageToWorkspace(), /test/);
        });
        describe("with a mocked updateWorkspaceFolders() function", () => {
            it("sorts the folder list", async () => {
                const packageSetFoo: autoproj.IPackageSet = builder1.addPackageSet("set.foo");
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
                await host.addFolders(
                    builder1.fs.fullPath("autoproj"),
                    packageTwo.srcdir,
                    packageSetFoo.user_local_dir);

                using(mocks.updateWorkspaceFolders);

                type Folder = { name: string, uri: vscode.Uri };
                const sortedFolders = [
                    It.is((x: Folder) => x.name == "autoproj" && x.uri.fsPath == builder1.fs.fullPath("autoproj")),
                    It.is((x: Folder) => x.name == "set.foo" && x.uri.fsPath == packageSetFoo.user_local_dir),
                    It.is((x: Folder) => x.name == "_"), // the test-workspace default folder
                    It.is((x: Folder) => x.name == "one" && x.uri.fsPath == packageOne.srcdir),
                    It.is((x: Folder) => x.name == "two" && x.uri.fsPath == packageTwo.srcdir)
                ];

                const promise = Promise.resolve([choices[0]]);
                mockSubject.setup((x) => x.packagePickerChoices()). returns(() => promise);
                mocks.updateWorkspaceFolders.setup((x) => x(0, 4, ...sortedFolders)).returns(() => true);
                mocks.showQuickPick.setup((x) => x([choices[0]], options)).returns(() => Promise.resolve(choices[0]));
                await subject.addPackageToWorkspace();
                mocks.updateWorkspaceFolders.verify((x) => x(0, 4, ...sortedFolders), Times.once());
            });
            it("shows an error if folder could not be added", async () => {
                using(mocks.updateWorkspaceFolders);

                const promise = Promise.resolve(choices);
                mockSubject.setup((x) => x.packagePickerChoices()).returns(() => promise);
                mocks.showQuickPick.setup((x) => x(choices, options)).returns(() => Promise.resolve(choices[1]));
                mocks.updateWorkspaceFolders.setup((x) => x(0, null,
                        { uri: vscode.Uri.file(packageTwo.srcdir) })).returns(() => false);

                await assert.rejects(subject.addPackageToWorkspace(),
                    new RegExp(`Could not add folder: ${packageTwo.srcdir}`));
            });
        });
    });
    describe("guessCurrentTestBinaryDir()", () => {
        let root: string;
        let pkg: autoproj.IPackage;
        beforeEach(() => {
            root = builder1.fs.root;
            subject = new commands.Commands(workspaces, mocks.logOutputChannel.object);

            pkg = builder1.addPackage("foobar");
            workspaces.addFolder(pkg.srcdir);
        });
        afterEach(async () => {
            await host.closeAllTabs();
        });
        it("returns the first workspace root if no editors are open", async () => {
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(root).fsPath);
        });
        it("returns the first workspace root if the current open file is not in any workspace", async () => {
            const tempfs = new TempFS();
            tempfs.init();

            try {
                const filePath = tempfs.mkfile("foo", "foo");
                await vscode.window.showTextDocument(vscode.Uri.file(filePath));
                assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(root).fsPath);
            } finally {
                tempfs.clear();
            }
        });
        it("returns the first workspace root if the current open file is not in any package", async () => {
            builder1.fs.mkdir("foo");
            const filePath = builder1.fs.mkfile("empty", "foo", "bar");
            await vscode.window.showTextDocument(vscode.Uri.file(filePath));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(root).fsPath);
        });
        it("returns the first workspace root if the build folder does not exist", async () => {
            builder1.fs.mkdir(...builder1.packageSrcDir(pkg.name));
            const filePath = builder1.fs.mkfile("empty", ...builder1.packageSrcDir(pkg.name), "main.cpp");
            builder1.fs.rmdir(...builder1.packageBuildDir(pkg.name));
            await vscode.window.showTextDocument(vscode.Uri.file(filePath));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(root).fsPath);
        });
        it("returns the build folder if test folder does not exist", async () => {
            builder1.fs.mkdir(...builder1.packageSrcDir(pkg.name));
            const filePath = builder1.fs.mkfile("empty", ...builder1.packageSrcDir(pkg.name), "main.cpp");
            builder1.fs.mkdir(...builder1.packageBuildDir(pkg.name));
            await vscode.window.showTextDocument(vscode.Uri.file(filePath));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, vscode.Uri.file(pkg.builddir).fsPath);
        });
        it("returns the test folder if it exists", async () => {
            builder1.fs.mkdir(...builder1.packageSrcDir(pkg.name));
            const filePath = builder1.fs.mkfile("empty", ...builder1.packageSrcDir(pkg.name), "main.cpp");
            builder1.fs.mkdir(...builder1.packageBuildDir(pkg.name), "test");
            await vscode.window.showTextDocument(vscode.Uri.file(filePath));
            assert.equal((await subject.guessCurrentTestBinaryDir()).fsPath, path.join(pkg.builddir, "test"));
        });
    });
    describe("startDebugging()", () => {
        let root: string;
        let pkg: autoproj.IPackage;
        let testArguments: string;
        let testExecutable: vscode.Uri;
        let startDebugging: IGlobalMock<typeof vscode.debug.startDebugging>;
        beforeEach(() => {
            root = builder1.fs.root;
            workspaces = new autoproj.Workspaces();
            subject = new commands.Commands(workspaces, mocks.logOutputChannel.object);

            pkg = builder1.addPackage("foobar");
            workspaces.addFolder(pkg.srcdir);

            const openDialogReturn = () => Promise.resolve(testExecutable ? [testExecutable] : undefined);
            mocks.showOpenDialog.setup((x) => x(It.isAny())).returns(openDialogReturn);
            mocks.showInputBox.setup((x) => x(It.isAny())).returns(() => Promise.resolve(testArguments));
            startDebugging = GlobalMock.ofInstance(
                vscode.debug.startDebugging,
                "startDebugging",
                vscode.debug);

            using(mocks.showOpenDialog, mocks.showInputBox, startDebugging);
        });
        it("throws if workspace is empty", async () => {
            workspaces.deleteFolder(pkg.srcdir);
            await assert.rejects(subject.startDebugging(), new Error("Cannot debug an empty workspace"));
        });
        it("aborts if canceled while waiting for program selection", async () => {
            await subject.startDebugging();
            mocks.showInputBox.verify((x) => x(It.isAny()), Times.never());
        });
        it("aborts if canceled while waiting for program arguments", async () => {
            testExecutable = vscode.Uri.file(path.join(pkg.builddir, "test", "test_suite"));
            await subject.startDebugging();
            startDebugging.verify((x) => x(It.isAny(), It.isAny()), Times.never());
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
                startDebugging.verify((x) => x(It.isAny(), matches), Times.once());
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

                await host.addFolders(pkg.srcdir);
                startDebugging.setup((x) => x(It.isAny(), It.isAny())).callback((ws, config) => {
                    selectedWs = ws;
                    selectedConfig = config;
                });

                await subject.startDebugging();
                assert.deepEqual({ ws: selectedWs, config: selectedConfig }, subject["_lastDebuggingSession"]);
            });
        });
    });
    describe("addLaunchConfiguration()", () => {
        let selected: any;
        let mockSubject: IMock<commands.Commands>;
        beforeEach(() => {
            mockSubject = Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        afterEach(async () => {
            await vscode.workspace.getConfiguration("launch").update("configurations", undefined);
        });
        it("does nothing if user cancels", async () => {
            selected = undefined;
            mockSubject.setup((x) => x.generateDebugConfiguration()).returns(() => Promise.resolve(undefined));
            await subject.addLaunchConfiguration();
            assert.deepEqual([], vscode.workspace.getConfiguration("launch").get("configurations"));
        });
        it("adds a launch configuration", async () => {
            const config = {
                "name": "foo",
                "type": "cppdbg",
                "request": "launch",
                "cwd": "/path/to",
                "program": "/path/to/foo",
                "MIMode": "gdb",
            }
            selected = { config: config, ws: vscode.workspace.workspaceFolders![0] };
            mockSubject.setup((x) => x.generateDebugConfiguration()).returns(() => Promise.resolve(selected));
            await subject.addLaunchConfiguration();
            assert.deepEqual([config], vscode.workspace.getConfiguration("launch").get("configurations"));
        });

    });
    describe("restartDebugging()", () => {
        let startDebugging: IGlobalMock<typeof vscode.debug.startDebugging>;
        beforeEach(() => {
            startDebugging = GlobalMock.ofInstance(
                vscode.debug.startDebugging,
                "startDebugging",
                vscode.debug);

            using(startDebugging);
        });
        it("restarts last debugging session", async () => {
            const wsFolder: vscode.WorkspaceFolder = {
                index: 0,
                name: "foobar",
                uri: vscode.Uri.file("/path/to/ws/src/foobar")
            }
            const config = { name: "launch (gdb)" };
            subject["_lastDebuggingSession"]= { ws: wsFolder, config: config! } as any;
            await subject.restartDebugging();
            startDebugging.verify((x) => x(wsFolder, config as any), Times.once());
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
            let pkg: autoproj.IPackage;
            beforeEach(() => {
                subject = new commands.Commands(workspaces, mocks.logOutputChannel.object);

                pkg = builder1.addPackage("foobar");
                workspaces.addFolder(pkg.srcdir);

                const lastConfig: vscode.DebugConfiguration = {
                    "name": "foo",
                    "type": "cppdbg",
                    "request": "launch"
                };
                subject["_lastDebuggingSession"] = { ws: "" as any, config: lastConfig };
            });
            afterEach(async () => {
                await vscode.workspace.getConfiguration("launch").update("configurations", undefined);
            });
            it("does not add the same launch configuration", async () => {
                const currentConfigs: vscode.DebugConfiguration[] = [{
                    "name": "foo",
                    "type": "cppdbg",
                    "request": "launch"
                }];
                await vscode.workspace.getConfiguration("launch").update("configurations", currentConfigs);
                await subject.saveLastDebuggingSession();
                const newConfigs = vscode.workspace.getConfiguration("launch").get("configurations");
                assert.deepStrictEqual(newConfigs, currentConfigs);
            });
            it("sorts launch configurations while adding a new one", async () => {
                const currentConfigs: vscode.DebugConfiguration[] = [
                    {
                        "name": "w",
                        "type": "cppdbg",
                        "request": "launch"
                    },
                    {
                        "name": "a",
                        "type": "cppdbg",
                        "request": "launch"
                    },
                ];

                await vscode.workspace.getConfiguration("launch").update("configurations", currentConfigs);
                await subject.saveLastDebuggingSession();

                const expectedConfigs = [
                    {
                        "name": "a",
                        "type": "cppdbg",
                        "request": "launch"
                    },
                    {
                        "name": "foo",
                        "type": "cppdbg",
                        "request": "launch"
                    },
                    {
                        "name": "w",
                        "type": "cppdbg",
                        "request": "launch"
                    }
                ];
                const newConfigs = vscode.workspace.getConfiguration("launch").get("configurations");
                assert.deepStrictEqual(newConfigs, expectedConfigs);
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
            let root: string;
            let supression: boolean;
            beforeEach(() => {
                root = builder1.fs.root;

                workspaces.addFolder(root);
                mocks.getConfiguration.setup((x) => x("autoproj")).returns(() => mocks.workspaceConfiguration.object);
                mocks.workspaceConfiguration.setup((x) => x.get<boolean>("supressCmakeBuildTypeOverrideNotice"))
                    .returns(() => supression);

                supression = false;
                subject = new commands.Commands(workspaces, mocks.logOutputChannel.object);
                using(mocks.getConfiguration, mocks.showInformationMessage);
            });
            function assertNotice(show: boolean) {
                const times = show ? Times.once() : Times.never();
                mocks.showInformationMessage.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), times);
            }
            function assertSetSupression(update: boolean) {
                const times = update ? Times.once() : Times.never();
                mocks.workspaceConfiguration.verify((x) => x.update("supressCmakeBuildTypeOverrideNotice", true), times);
            }
            it("does nothing if user cancels", async () => {
                mockSubject = Mock.ofInstance(subject);
                mockSubject.callBase = true;
                mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(undefined));

                await mockSubject.object.enableCmakeDebuggingSymbols();
                assertNotice(false);
            });
            it("throws if script cannot be created", async () => {
                builder1.fs.mkfile("empty", "autoproj", "overrides.d"); // create file to make mkdir_p fail
                await assert.rejects(subject.enableCmakeDebuggingSymbols(), /Could not create overrides script/);
                assertNotice(false);
            });
            describe("the overrides script is created", () => {
                let filePath: string;
                beforeEach(() => {
                    builder1.fs.registerDir("autoproj", "overrides.d");
                    builder1.fs.registerFile("autoproj", "overrides.d", "vscode-autoproj-cmake-build-type.rb");
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
                    mocks.showInformationMessage.setup((x) => x(
                        It.isAny(), It.isAny(), It.isAny(), It.isAny())).returns(() => doNotShowAgainClicked);

                    await subject.enableCmakeDebuggingSymbols();
                    assertSetSupression(true);
                });
            });
        });
    });
    describe("openWorkspace()", () => {
        let options: vscode.OpenDialogOptions;
        let selectedUri: vscode.Uri | undefined;
        beforeEach(() => {
            options = {
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: "Open",
                title: "Select an an Autoproj workspace folder"
            };
            mocks.showOpenDialog.setup((x) => x(options))
                .returns(() => Promise.resolve(selectedUri ? [selectedUri] : undefined)).verifiable();
            using(mocks.showOpenDialog);
        });
        it("throws if an autoproj workspace is already open", async () => {
            workspaces.add(builder1.workspace);
            await assert.rejects(subject.openWorkspace(), /Opening multiple Autoproj workspaces is not supported/);
        });
        it("throws if selected folder is not in an autoproj workspace", async () => {
            let tempfs: TempFS;
            tempfs = new TempFS();
            try {
                const emptyFolder = tempfs.init();
                selectedUri = vscode.Uri.file(emptyFolder);
                await assert.rejects(subject.openWorkspace(), /The selected folder is not in an Autoproj workspace/);
            } finally {
                tempfs.clear();
            }
        });
        describe("with a mocked updateWorkspaceFolders() function", () => {
            it("does nothing if user cancels", async () => {
                selectedUri = undefined
                await subject.openWorkspace();
                mocks.updateWorkspaceFolders.verify((x) => x(0, 1, It.isAny()), Times.never());
            });
            it("adds the buildconf as the first folder of the workspace", async () => {
                selectedUri = vscode.Uri.file(builder1.root);
                await using(mocks.updateWorkspaceFolders).do(async () => {
                    await subject.openWorkspace();
                });

                type Folder = { name: string, uri: vscode.Uri };
                const buildconf = builder1.fs.fullPath("autoproj");
                const sortedFolders = [
                    It.is((x: Folder) => x.name == `autoproj (${builder1.workspace.name})` && x.uri.fsPath == buildconf),
                    It.is((x: Folder) => x.name == "_"), // the test-workspace default folder
                ];

                mocks.updateWorkspaceFolders.verify((x) => x(0, 1, ...sortedFolders), Times.once());
            });
        });
    });
    describe("removeTestMateEntry()", () => {
        let advancedExecutables;
        let pick: number | undefined;
        let details: { workspaceFolderValue };
        beforeEach(() => {
            details = { workspaceFolderValue: undefined };
            mocks.getConfiguration.setup((x) => x("testMate.cpp.test", It.isAny()))
                .returns(() => mocks.workspaceConfiguration.object);
            mocks.workspaceConfiguration.setup((x) => x.get<any[]>("advancedExecutables"))
                .returns(() => advancedExecutables);
            mocks.workspaceConfiguration.setup((x) => x.inspect("advancedExecutables"))
                .returns(() => details as any);

            let items: vscode.QuickPickItem[] = It.isAny();
            let options: vscode.QuickPickOptions = It.isAny();
            mocks.showQuickPick.setup((x) => x(items, options)).returns((i, o) => {
                return Promise.resolve(pick != undefined ? i[pick] : undefined);
            });
            using(mocks.getConfiguration, mocks.showQuickPick);
        });
        it("throws if there are not executables to remove", async () => {
            await assert.rejects(subject.removeTestMateEntry(), /There are no TestMate C\+\+ entries to remove/);
        });
        it("does nothing if user cancels", async () => {
            advancedExecutables = [
                { name: "foo" },
                { name: "bar" },
            ];
            await subject.removeTestMateEntry();
            const expected = It.is((x: vscode.QuickPickItem[]) => {
                return x[0].label == "$(debug-console) bar" &&
                       x[1].label == "$(debug-console) foo"
            });
            mocks.showQuickPick.verify((x) => x(expected, It.isAny()), Times.once());
            mocks.workspaceConfiguration.verify((x) => x.update(It.isAny(), It.isAny()), Times.never());
        });
        it("removes the selected entry", async () => {
            advancedExecutables = [
                { name: "foo" },
                { name: "bar" },
            ];
            pick = 1;
            await subject.removeTestMateEntry();
            mocks.workspaceConfiguration.verify((x) => {
                    x.update("advancedExecutables", [advancedExecutables[1]], vscode.ConfigurationTarget.Workspace)
                },
                Times.once());
        });
        it("removes setting if empty", async () => {
            advancedExecutables = [{ name: "foo" }];
            pick = 0;
            await subject.removeTestMateEntry();
            mocks.workspaceConfiguration.verify((x) => {
                    x.update("advancedExecutables", undefined, vscode.ConfigurationTarget.Workspace)
                },
                Times.once());
        });
    });
    describe("removeDebugConfiguration()", () => {
        let pick: number | undefined;
        const debugConfigs = [
            {
                "name": "foo",
                "type": "cppdbg",
                "request": "launch",
                "program": "/path/to/foo"
            },
            {
                "name": "bar",
                "type": "cppdbg",
                "request": "launch",
                "program": "/path/to/bar"
            }
        ];
        beforeEach(() => {
            let items: vscode.QuickPickItem[] = It.isAny();
            let options: vscode.QuickPickOptions = It.isAny();
            mocks.showQuickPick.setup((x) => x(items, options)).returns((i, o) => {
                return Promise.resolve(pick != undefined ? i[pick] : undefined);
            });
            using(mocks.showQuickPick);
        });
        afterEach(async () => {
            await vscode.workspace.getConfiguration("launch", null).update("configurations", undefined);
        });
        it("throws if there are not executables to remove", async () => {
            await assert.rejects(subject.removeDebugConfiguration(), /There are no launch configurations to remove/);
        });
        it("does nothing if user cancels", async () => {
            await vscode.workspace.getConfiguration("launch").update("configurations", debugConfigs);
            await subject.removeDebugConfiguration();
            const expected = It.is((x: vscode.QuickPickItem[]) => {
                return x[0].label == "$(debug) bar" &&
                       x[1].label == "$(debug) foo"
            });
            mocks.showQuickPick.verify((x) => x(expected, It.isAny()), Times.once());
            assert.deepStrictEqual(debugConfigs, vscode.workspace.getConfiguration("launch").get("configurations"));
        });
        it("removes the selected entry", async () => {
            await vscode.workspace.getConfiguration("launch", null)
                .update("configurations", debugConfigs, vscode.ConfigurationTarget.Workspace);

            pick = 1;
            await subject.removeDebugConfiguration();
            const expected = [debugConfigs[1]];

            assert.deepStrictEqual(expected, vscode.workspace.getConfiguration("launch").get("configurations"));
        });
        it("removes locally scoped launch configuration", async () => {
            workspaces.add(builder1.workspace);
            const pkg = builder1.addPackage("foo");
            workspaces.addFolder(pkg.srcdir);
            await host.addFolders(pkg.srcdir);
            await vscode.workspace.getConfiguration("launch", vscode.Uri.file(pkg.srcdir))
                .update("configurations", debugConfigs, vscode.ConfigurationTarget.WorkspaceFolder);

            pick = 1;
            await subject.removeDebugConfiguration();
            const expected = [debugConfigs[1]];
            const actual = vscode.workspace.getConfiguration("launch", vscode.Uri.file(pkg.srcdir)).get("configurations");

            unlinkSync(path.join(pkg.srcdir, ".vscode", "launch.json"));
            rmdirSync(path.join(pkg.srcdir, ".vscode"));

            assert.deepStrictEqual(actual, expected);
        });
    });
    describe("addPackageToTestMate()", () => {
        let advancedExecutables;
        let pick: number | undefined;
        beforeEach(() => {
            mocks.getConfiguration.setup((x) => x("testMate.cpp.test"))
                .returns(() => mocks.workspaceConfiguration.object);
            mocks.workspaceConfiguration.setup((x) => x.get<any[]>("advancedExecutables"))
                .returns(() => advancedExecutables);

            let items: vscode.QuickPickItem[] = It.isAny();
            let options: vscode.QuickPickOptions = It.isAny();
            mocks.showQuickPick.setup((x) => x(items, options)).returns((i, o) => {
                return Promise.resolve(pick != undefined ? i[pick] : undefined);
            });
            using(mocks.getConfiguration, mocks.showQuickPick);
        });
        it("throws if workspace is empty", async () => {
            await assert.rejects(subject.addPackageToTestMate(), /No packages to add/);
        })
        describe("in a non empty workspace", () => {
            let pkg1: autoproj.IPackage;
            let pkg2: autoproj.IPackage;
            let pkg3: autoproj.IPackage;
            beforeEach(async () => {
                workspaces.add(builder1.workspace);
                pkg1 = builder1.addPackage("foo");
                pkg2 = builder1.addPackage("bar");
                pkg3 = builder1.addPackage("scripts");
                delete (pkg3 as any).builddir;

                workspaces.addFolder(pkg1.srcdir);
                workspaces.addFolder(pkg2.srcdir);
                workspaces.addFolder(pkg3.srcdir);
                await host.addFolders(pkg1.srcdir, pkg2.srcdir, pkg3.srcdir);
            });
            it("does nothing if user cancels", async () => {
                await subject.addPackageToTestMate();
                // packages with no builddir should be filtered
                const expected = It.is((x: vscode.QuickPickItem[]) => {
                    return x[0].label == `$(folder) ${pkg2.name}` &&
                           x[1].label == `$(folder) ${pkg1.name}`
                });
                mocks.showQuickPick.verify((x) => x(expected, It.isAny()), Times.once());
                mocks.workspaceConfiguration.verify((x) => x.update(It.isAny(), It.isAny()), Times.never());
            });
            function testMateEntry(pkg: autoproj.IPackage) {
                return {
                    "name": pkg.name,
                    "pattern": path.join(pkg.builddir, "**", "*{test,Test,TEST}*"),
                    "cwd": "${absDirpath}",
                    "testGrouping": {
                        "groupByLabel": {
                            "label": pkg.name,
                            "description": builder1.workspace.name,
                            "groupByTags": {
                                "description": "${baseFilename}",
                                "tags": [], "tagFormat": "${tag}"
                            }
                        },
                    },
                    "gtest": {
                        "debug.enableOutputColouring": true,
                    },
                    "executionWrapper": {
                        "path": builder1.workspace.autoprojExePath(),
                        "args": ["exec", "--use-cache", "${cmd}", "${argsFlat}"]
                    },
                    "debug.configTemplate": {
                        "type": "cppdbg",
                        "MIMode": "gdb",
                        "program": "${exec}",
                        "args": "${argsArray}",
                        "cwd": "${cwd}",
                        "miDebuggerPath": path.join(builder1.workspace.root, ShimsWriter.RELATIVE_SHIMS_PATH, "gdb")
                    }
                }
            }
            it("does nothing if package was already added", async () => {
                pick = 1;
                advancedExecutables = [testMateEntry(pkg1)];

                await subject.addPackageToTestMate();
                mocks.showQuickPick.verify((x) => x(It.isAny(), It.isAny()), Times.once());
                mocks.workspaceConfiguration.verify((x) => x.update(It.isAny(), It.isAny()), Times.never());
            });
            it("adds and sorts the selected package", async () => {
                pick = 0;
                advancedExecutables = [testMateEntry(pkg1)];

                const expected = [testMateEntry(pkg2), testMateEntry(pkg1)];
                await subject.addPackageToTestMate();
                mocks.showQuickPick.verify((x) => x(It.isAny(), It.isAny()), Times.once());
                mocks.workspaceConfiguration.verify((x) => x.update("advancedExecutables", expected), Times.once());
            });
        });
    });
    describe("enablePackageTests()", () => {
        it("throws if workspace is empty", async () => {
            await assert.rejects(subject.enablePackageTests(), /No packages to enable tests/);
        })
        describe("in a non empty workspace", () => {
            let pick: number | undefined;
            let pkg1: autoproj.IPackage;
            let pkg2: autoproj.IPackage;
            let pkg3: autoproj.IPackage;
            let execution: util.IAsyncExecution;
            beforeEach(async () => {
                workspaces.add(builder1.workspace);
                pkg1 = builder1.addPackage("foo");
                pkg2 = builder1.addPackage("bar");
                pkg3 = builder1.addPackage("scripts");

                workspaces.addFolder(pkg1.srcdir);
                workspaces.addFolder(pkg2.srcdir);
                workspaces.addFolder(pkg3.srcdir);
                await host.addFolders(pkg1.srcdir, pkg2.srcdir, pkg3.srcdir);

                let items: vscode.QuickPickItem[] = It.isAny();
                let options: vscode.QuickPickOptions = It.isAny();

                using(mocks.asyncSpawn, mocks.showQuickPick);
                mocks.showQuickPick.setup((x) => x(items, options)).returns((i, o) => {
                    return Promise.resolve(pick != undefined ? i[pick] : undefined);
                });
                mocks.asyncSpawn.setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny())).returns(() => execution);

            });
            it("does nothing if user cancels", async () => {
                await subject.enablePackageTests();
                mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.never());
            });
            it("enables package tests", async () => {
                pick = 0;
                execution = {
                    childProcess: undefined as any,
                    returnCode: Promise.resolve(0)
                };
                await subject.enablePackageTests();
                const cmd = ["test", "enable", "bar"];
                mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), cmd, It.isAny()), Times.once());
            });
            it("throws if command fails", async () => {
                pick = 0;
                execution = {
                    childProcess: undefined as any,
                    returnCode: Promise.resolve(1)
                };
                await assert.rejects(subject.enablePackageTests(), /Could not enable 'bar' tests/);
            });
            it("throws if command cannot be executed", async () => {
                pick = 0;
                execution = {
                    childProcess: undefined as any,
                    returnCode: Promise.reject(new Error("ENOENT"))
                };
                await assert.rejects(subject.enablePackageTests(), /Could not enable 'bar' tests: ENOENT/);
            });
        });
    });
    describe("enableTestsByDefault()", () => {
        let mockSubject: IMock<commands.Commands>;
        let selectedWorkspace: autoproj.Workspace | undefined;
        let execution: util.IAsyncExecution;
        beforeEach(() => {
            mockSubject = Mock.ofInstance(subject);
            subject = mockSubject.target;

            using(mocks.asyncSpawn);
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(selectedWorkspace));
            mocks.asyncSpawn.setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny())).returns(() => execution);
        });
        describe("in a non empty workspace", () => {
            it("does nothing if user cancels", async () => {
                selectedWorkspace = undefined;
                await subject.enableTestsByDefault();
                mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.never());
            });
            it("enables tests by default", async () => {
                selectedWorkspace = builder1.workspace;
                execution = {
                    childProcess: undefined as any,
                    returnCode: Promise.resolve(0)
                };
                await subject.enableTestsByDefault();
                const cmd = ["test", "default", "on"];
                mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), cmd, It.isAny()), Times.once());
            });
            it("throws if command fails", async () => {
                selectedWorkspace = builder1.workspace;
                execution = {
                    childProcess: undefined as any,
                    returnCode: Promise.resolve(1)
                };
                const error = RegExp(`Could not enable '${selectedWorkspace.name}' tests`);
                await assert.rejects(subject.enableTestsByDefault(), error);
            });
            it("throws if command cannot be executed", async () => {
                selectedWorkspace = builder1.workspace;
                execution = {
                    childProcess: undefined as any,
                    returnCode: Promise.reject(new Error("ENOENT"))
                };
                const error = RegExp(`Could not enable '${selectedWorkspace.name}' tests: ENOENT`);
                await assert.rejects(subject.enableTestsByDefault(), error);
            });
        });
    });
    describe("handleError()", () => {
        it("runs and handles errors on functions and async functions", async () => {
            using(mocks.showErrorMessage);

            const fn = Mock.ofInstance(() => {});
            const asyncFn = Mock.ofInstance(async () => { });

            await subject.handleError(fn.object);
            await subject.handleError(asyncFn.object);

            await subject.handleError(() => { throw new Error("foobar"); });
            await subject.handleError(async () => { throw new Error("foobar"); });

            fn.verify((x) => x(), Times.once());
            asyncFn.verify((x) => x(), Times.once());
            mocks.showErrorMessage.verify((x) => x("foobar"), Times.exactly(2));
        });
    });
    describe("register()", () => {
        let register: IGlobalMock<typeof vscode.commands.registerCommand>;
        beforeEach(() => {
            register = GlobalMock.ofInstance(
                vscode.commands.registerCommand,
                "registerCommand",
                vscode.commands);

            using(register);
        });
        function setupMocks(methodName: string, command: string) {
            register.setup((x) => x(command, It.isAny())).callback((_, cb) => cb());

            const mock = Mock.ofInstance(() => Promise.resolve());
            Object.assign(subject, {...subject, [methodName]: mock.object });

            return mock;
        }
        it("registers all commands", async () => {
            const disposables: vscode.Disposable[] = [];
            const mocks = [
                setupMocks("updateWorkspaceEnvironment", "autoproj.updateWorkspaceEnvironment"),
                setupMocks("addPackageToWorkspace", "autoproj.addPackageToWorkspace"),
                setupMocks("startDebugging", "autoproj.startDebugging"),
                setupMocks("saveLastDebuggingSession", "autoproj.saveLastDebuggingSession"),
                setupMocks("restartDebugging", "autoproj.restartDebugging"),
                setupMocks("enableCmakeDebuggingSymbols", "autoproj.enableCmakeDebuggingSymbols"),
                setupMocks("addPackageToTestMate", "autoproj.addPackageToTestMate"),
                setupMocks("removeTestMateEntry", "autoproj.removeTestMateEntry"),
                setupMocks("removeDebugConfiguration", "autoproj.removeDebugConfiguration"),
                setupMocks("openWorkspace", "autoproj.openWorkspace"),
                setupMocks("enablePackageTests", "autoproj.enablePackageTests"),
                setupMocks("enableTestsByDefault", "autoproj.enableTestsByDefault"),
                setupMocks("disablePackageTests", "autoproj.disablePackageTests"),
                setupMocks("disableTestsByDefault", "autoproj.disableTestsByDefault"),
                setupMocks("addLaunchConfiguration", "autoproj.addLaunchConfiguration")
            ];

            subject.register(disposables);
            for (const mock of mocks) {
                mock.verify((x) => x(), Times.once());
            }
            assert.equal(disposables.length, mocks.length);
        });
    });
});
