"use strict";
import * as assert from "assert";
import { basename, dirname } from "path";
import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as commands from "../src/commands";
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
        let mockWorkspace: IMock<autoproj.Workspace>;
        let mockSubject: IMock<commands.Commands>;
        let mockTask: IMock<vscode.Task>;
        const taskDefinition: vscode.TaskDefinition = {
            mode: tasks.WorkspaceTaskMode.UpdateEnvironment,
            type: tasks.TaskType.Workspace,
            workspace: "/path/to/workspace",
        };
        beforeEach(() => {
            mockWorkspace = mockWorkspaces.addWorkspace("/path/to/workspace");
            mockTask = mocks.createTask(taskDefinition).mockTask;
            mockWrapper.setup((x) => x.fetchTasks(tasks.WorkspaceTaskFilter)).
                returns(() => Promise.resolve([mockTask.object]));
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
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(mockWorkspace.object));
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
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(mockWorkspace.object));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.executeTask(mockTask.object), Times.once());
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
                { name: "autoproj (buildconf)", srcdir: "/path/to/autoproj" });
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
        it("handles an empty workspace", async () => {
            const promise = Promise.resolve(choices);
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => promise);
            mockWrapper.setup((x) => x.updateWorkspaceFolders(0, null, It.isAny())).returns(() => true);
            mockWrapper.setup((x) => x.showQuickPick(promise,
                options, It.isAny())).returns(() => Promise.resolve(choices[1]));
            await subject.addPackageToWorkspace();

            mockWrapper.verify((x) => x.updateWorkspaceFolders(0, null,
                { name: "tools/two", uri: vscode.Uri.file("/path/to/tools/two") }), Times.once());
        });
        it("keeps the folder list sorted", async () => {
            const folder1: vscode.WorkspaceFolder = {
                index: 0,
                name: "autoproj",
                uri: vscode.Uri.file("/path/to/autoproj"),
            };
            const folder2: vscode.WorkspaceFolder = {
                index: 0,
                name: "tools/two",
                uri: vscode.Uri.file("/path/to/tools/two"),
            };
            const promise = Promise.resolve(choices);
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => [folder1, folder2]);
            mockSubject.setup((x) => x.packagePickerChoices()). returns(() => promise);
            mockWrapper.setup((x) => x.updateWorkspaceFolders(0, null, It.isAny())).returns(() => true);
            mockWrapper.setup((x) => x.showQuickPick(promise,
                options, It.isAny())).returns(() => Promise.resolve(choices[0]));
            await subject.addPackageToWorkspace();

            mockWrapper.verify((x) => x.updateWorkspaceFolders(1, null,
                { name: "drivers/one", uri: vscode.Uri.file("/path/to/drivers/one") }), Times.once());
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
    describe("register()", () => {
        function setupWrapper(command: string, callback: (command, cb) => void) {
            mockWrapper.setup((x) => x.registerAndSubscribeCommand(command, It.isAny())).callback(callback);
        }

        it("registers all commands", async () => {
            let updatePackageInfoCb: () => Promise<void>;
            let addPackageToWorkspaceCb: () => Promise<void>;

            const mockUpdatePackageInfo = Mock.ofInstance(() => Promise.resolve());
            subject.updatePackageInfo = mockUpdatePackageInfo.object;

            const mockAddPackageToWorkspace = Mock.ofInstance(() => Promise.resolve());
            subject.addPackageToWorkspace = mockAddPackageToWorkspace.object;

            setupWrapper("autoproj.updatePackageInfo", (command, cb) => updatePackageInfoCb = cb);
            setupWrapper("autoproj.addPackageToWorkspace", (command, cb) => addPackageToWorkspaceCb = cb);

            subject.register();
            updatePackageInfoCb!();
            addPackageToWorkspaceCb!();

            mockUpdatePackageInfo.verify((x) => x(), Times.once());
            mockAddPackageToWorkspace.verify((x) => x(), Times.once());
        });
    });
});
