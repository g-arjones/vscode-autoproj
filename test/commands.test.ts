"use strict";
import * as assert from "assert";
import * as path from "path";
import { basename, dirname } from "path";
import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as commands from "../src/commands";
import { ShimsWriter } from "../src/shimsWriter";
import * as tasks from "../src/tasks";
import * as wrappers from "../src/wrappers";
import * as helpers from "./helpers";
import * as mocks from "./mocks";

describe("Commands", () => {
    let mockWorkspaces: mocks.MockWorkspaces;
    let mockWrapper: IMock<wrappers.VSCode>;
    let subject: commands.Commands;

    beforeEach(() => {
        mockWorkspaces = new mocks.MockWorkspaces();
        mockWrapper = Mock.ofType<wrappers.VSCode>();
        subject = new commands.Commands(mockWorkspaces.object, mockWrapper.object);
    });
    describe("updatePackageInfo()", () => {
        let mockSubject: IMock<commands.Commands>;
        let workspace: autoproj.Workspace;
        let task: vscode.Task;
        const taskDefinition: vscode.TaskDefinition = {
            mode: tasks.WorkspaceTaskMode.UpdateEnvironment,
            type: tasks.TaskType.Workspace,
            workspace: "/path/to/workspace",
        };
        beforeEach(() => {
            task = mocks.createTask(taskDefinition).object;
            workspace = mockWorkspaces.addWorkspace("/path/to/workspace").object;
            mockWrapper.setup((x) => x.fetchTasks(tasks.WORKSPACE_TASK_FILTER)).returns(() => Promise.resolve([task]));
            mockSubject = Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("does nothing if canceled", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(undefined));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.executeTask(It.isAny()), Times.never());
        });
        it("handles an exception while updating workspace info", async () => {
            mockWrapper.reset();
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
            mockWrapper.verify((x) => x.executeTask(It.isAny()), Times.never());
        });
        it("handles an exception if workspace is empty", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.reject(new Error("test")));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
            mockWrapper.verify((x) => x.executeTask(It.isAny()), Times.never());
        });
        it("updates workspace info", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(workspace));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.executeTask(task), Times.once());
        });
    });
    describe("showWorkspacePicker()", () => {
        let choices: Array<{ label, description, ws }>;
        function makeChoice(ws: autoproj.Workspace) {
            return {
                description: basename(dirname(ws.root)),
                label: basename(ws.root),
                ws,
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
            assert.strictEqual(ws, choices[0].ws);
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
            assert.equal(choices.length, 4);
            assert.deepStrictEqual(choices[0].pkg,
                { name: "autoproj (to)", srcdir: "/path/to/autoproj" });
            assert.strictEqual(choices[0].label, "autoproj");
            assert.strictEqual(choices[0].description, "to (buildconf)");
            assert.strictEqual(choices[1].pkg, packageOne);
            assert.strictEqual(choices[1].label, "one");
            assert.strictEqual(choices[1].description, "to");
            assert.deepStrictEqual(choices[2].pkg,
                { name: "set.one (package set)", srcdir: "/path/to/autoproj/remotes/set.one" });
            assert.strictEqual(choices[2].label, "set.one");
            assert.strictEqual(choices[2].description, "to (package set)");
            assert.strictEqual(choices[3].pkg, packageTwo);
            assert.strictEqual(choices[3].label, "two");
            assert.strictEqual(choices[3].description, "to");
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
            assert.equal(choices.length, 1);
            assert.strictEqual(choices[0].pkg, packageTwo);
            assert.strictEqual(choices[0].label, "two");
            assert.strictEqual(choices[0].description, "to");
        });
    });
    describe("addPackageToWorkspace()", () => {
        let mockSubject: IMock<commands.Commands>;
        let packageOne: autoproj.IPackage;
        let packageTwo: autoproj.IPackage;
        let choices: Array<{ label, description, pkg }> = [];
        const options: vscode.QuickPickOptions = {
            matchOnDescription: true,
            placeHolder: "Select a package to add to this workspace",
        };
        beforeEach(() => {
            packageOne = mockWorkspaces.addPackageToWorkspace("/path/to/drivers/one", "/path/to").object;
            packageTwo = mockWorkspaces.addPackageToWorkspace("/path/to/tools/two", "/path/to").object;
            choices = [{
                description: "to",
                label: "one",
                pkg: packageOne,
            },
            {
                description: "to",
                label: "two",
                pkg: packageTwo,
            }];
            mockSubject = Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("shows an error message if manifest loading fails", async () => {
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => Promise.reject(new Error("test")));
            await subject.addPackageToWorkspace();
            mockWrapper.verify((x) => x.showErrorMessage("test"), Times.once());
        });
        it("shows a quick pick ui", async () => {
            const promise = Promise.resolve(choices);
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => promise);
            await subject.addPackageToWorkspace();

            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.never());
            mockWrapper.verify((x) => x.showQuickPick(promise, options, It.isAny()), Times.once());
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
            mockWrapper.setup((x) => x.showQuickPick(promise,
                options, It.isAny())).returns(() => Promise.resolve(choices[0]));
            await subject.addPackageToWorkspace();
            mockWrapper.verify((x) => x.updateWorkspaceFolders(0, 3, ...sortedFolders), Times.once());
        });
        it("shows an error if folder could not be added", async () => {
            const promise = Promise.resolve(choices);
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => promise);
            mockWrapper.setup((x) => x.showQuickPick(promise,
                options, It.isAny())).returns(() => Promise.resolve(choices[1]));
            mockWrapper.setup((x) => x.updateWorkspaceFolders(0, null,
                    { uri: vscode.Uri.file("/path/to/tools/two") })).returns(() => false);

            await subject.addPackageToWorkspace();
            mockWrapper.verify((x) => x.showErrorMessage("Could not add folder: /path/to/tools/two"), Times.once());
        });
    });
    describe("setupPythonDefaultInterpreter()", () => {
        it("shows an error message if workspace is empty", async () => {
            await subject.setupPythonDefaultInterpreter();
            mockWrapper.verify((x) => x.showErrorMessage(
                "Cannot setup Python default interpreter for an empty workspace"), Times.once());
        })
        it("shows an error message when working with multiple autoproj workspaces", async () => {
            mockWorkspaces.addWorkspace("/ws/one");
            mockWorkspaces.addWorkspace("/ws/two");
            await subject.setupPythonDefaultInterpreter();
            mockWrapper.verify((x) => x.showErrorMessage(
                "Cannot setup Python default interpreter for multiple Autoproj workspaces"), Times.once());
        })
        it("sets the default python interpreter", async () => {
            mockWorkspaces.addWorkspace("/ws/one");
            const mockConfiguration = Mock.ofType<vscode.WorkspaceConfiguration>();
            mockWrapper.setup((x) => x.getConfiguration()).returns(() => mockConfiguration.object);
            await subject.setupPythonDefaultInterpreter();

            const pythonShimPath = path.join("/ws/one", ShimsWriter.RELATIVE_SHIMS_PATH, "python");
            mockConfiguration.verify((x) => x.update("python.defaultInterpreterPath", pythonShimPath), Times.once());
        })
    });
    describe("register()", () => {
        function setupMocks(methodName: string, command: string) {
            mockWrapper.setup((x) => x.registerAndSubscribeCommand(command, It.isAny())).callback((_, cb) => cb());

            const mock = Mock.ofInstance(() => Promise.resolve());
            Object.assign(subject, {...subject, [methodName]: mock.object });

            return mock;
        }

        it("registers all commands", async () => {
            const mockUpdatePackageInfo = setupMocks("updatePackageInfo", "autoproj.updatePackageInfo");
            const mockAddPackageToWorkspace = setupMocks("addPackageToWorkspace", "autoproj.addPackageToWorkspace");
            const mockSetupPythonDefaultInterpreterCb = setupMocks(
                "setupPythonDefaultInterpreter",
                "autoproj.setupPythonDefaultInterpreter"
            );

            subject.register();

            mockUpdatePackageInfo.verify((x) => x(), Times.once());
            mockAddPackageToWorkspace.verify((x) => x(), Times.once());
            mockSetupPythonDefaultInterpreterCb.verify((x) => x(), Times.once());
        });
    });
});
