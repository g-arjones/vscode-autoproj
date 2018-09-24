"use strict";
import * as assert from "assert";
import { basename, dirname } from "path";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as commands from "../src/commands";
import * as context from "../src/context";
import * as wrappers from "../src/wrappers";
import * as helpers from "./helpers";

describe("Commands", () => {
    let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<context.Context>;
    let subject: commands.Commands;

    beforeEach(() => {
        mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        subject = new commands.Commands(mockContext.object,
            mockWrapper.object);
        mockContext.setup((x) => x.workspaces).returns(() => mockWorkspaces.object);
    });
    describe("updatePackageInfo()", () => {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockSubject: TypeMoq.IMock<commands.Commands>;
        let mockTask: TypeMoq.IMock<vscode.Task>;
        const taskDefinition: vscode.TaskDefinition = {
            mode: "update-environment",
            type: "autoproj-workspace",
            workspace: "/path/to/workspace",
        };
        beforeEach(() => {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockTask = TypeMoq.Mock.ofType<vscode.Task>();
            mockTask.setup((x: any) => x.then).returns(() => undefined);
            mockWorkspace.setup((x) => x.root).returns(() => "/path/to/workspace");
            mockWorkspace.setup((x: any) => x.then).returns(() => undefined);
            mockTask.setup((x) => x.definition).returns(() => taskDefinition);
            mockWrapper.setup((x) => x.fetchTasks()).returns(() => Promise.resolve([mockTask.object]));
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("does nothing if canceled", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).
                returns(() => Promise.resolve(undefined));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.executeTask(TypeMoq.It.isAny()), TypeMoq.Times.never());
        });
        it("handles an exception while updating workspace info", async () => {
            mockWrapper.reset();
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(mockWorkspace.object));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.executeTask(TypeMoq.It.isAny()), TypeMoq.Times.never());
        });
        it("handles an exception if workspace is empty", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.reject(new Error("test")));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            mockWrapper.verify((x) => x.executeTask(TypeMoq.It.isAny()), TypeMoq.Times.never());
        });
        it("updates workspace info", async () => {
            mockSubject.setup((x) => x.showWorkspacePicker()).returns(() => Promise.resolve(mockWorkspace.object));
            await subject.updatePackageInfo();
            mockWrapper.verify((x) => x.executeTask(mockTask.object), TypeMoq.Times.once());
        });
    });
    describe("showWorkspacePicker()", () => {
        let choices: Array<{ label, description, ws }>;
        let mockOne: TypeMoq.IMock<autoproj.Workspace>;
        let mockTwo: TypeMoq.IMock<autoproj.Workspace>;
        let workspaces: Map<string, autoproj.Workspace>;

        function makeChoice(ws: autoproj.Workspace) {
            return {
                description: basename(dirname(ws.root)),
                label: basename(ws.root),
                ws,
            };
        }
        beforeEach(() => {
            workspaces = new Map();
            mockOne = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockTwo = TypeMoq.Mock.ofType<autoproj.Workspace>();

            mockOne.setup((x) => x.root).returns(() => "/ws/one");
            mockTwo.setup((x) => x.root).returns(() => "/ws/two");
            mockOne.setup((x: any) => x.then).returns(() => undefined);
            mockTwo.setup((x: any) => x.then).returns(() => undefined);

            choices = [];
            choices.push(makeChoice(mockOne.object));
            choices.push(makeChoice(mockTwo.object));
            workspaces.set("/ws/one", mockOne.object);
            workspaces.set("/ws/two", mockTwo.object);
        });
        it("throws if there are no autoproj workspaces", async () => {
            mockWorkspaces.setup((x) => x.workspaces).returns(() => new Map());
            await helpers.assertThrowsAsync(subject.showWorkspacePicker(),
                /No Autoproj workspace/);
        });
        it("skip picker if there is only one workspace", async () => {
            const tempWs: Map<string, autoproj.Workspace> = new Map();
            tempWs.set("/ws/one", mockOne.object);
            mockWorkspaces.setup((x) => x.workspaces).returns(() => tempWs);
            const ws = await subject.showWorkspacePicker();
            mockWrapper.verify((x) => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny()), TypeMoq.Times.never());
            assert.strictEqual(ws, mockOne.object);
        });
        it("returns undefined if canceled", async () => {
            mockWorkspaces.setup((x) => x.workspaces).returns(() => workspaces);
            mockWorkspaces.setup((x) => x.forEachWorkspace(TypeMoq.It.isAny())).
                returns((callback) => workspaces.forEach(callback));
            mockWrapper.setup((x) => x.showQuickPick(choices,
                TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

            const ws = await subject.showWorkspacePicker();
            assert(!ws);
        });
        it("returns the picked workspace", async () => {
            mockWorkspaces.setup((x) => x.workspaces).returns(() => workspaces);
            mockWorkspaces.setup((x) => x.forEachWorkspace(TypeMoq.It.isAny())).
                returns((callback) => workspaces.forEach(callback));
            mockWrapper.setup((x) => x.showQuickPick(choices,
                TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[0]));

            const ws = await subject.showWorkspacePicker();
            mockWrapper.verify((x) => x.showQuickPick(choices, TypeMoq.It.isAny()),
                TypeMoq.Times.once());
            assert.strictEqual(ws, choices[0].ws);
        });
    });
    describe("packagePickerChoices()", () => {
        let mockWs: TypeMoq.IMock<autoproj.Workspace>;
        let mockWsInfo: TypeMoq.IMock<autoproj.WorkspaceInfo>;
        let mockPackageOne: TypeMoq.IMock<autoproj.IPackage>;
        let mockPackageTwo: TypeMoq.IMock<autoproj.IPackage>;
        let mockPackageSetOne: TypeMoq.IMock<autoproj.IPackageSet>;
        let pathToPackage: Map<string, autoproj.IPackage>;
        let pathToPackageSet: Map<string, autoproj.IPackageSet>;
        beforeEach(() => {
            mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWsInfo = TypeMoq.Mock.ofType<autoproj.WorkspaceInfo>();
            mockPackageOne = TypeMoq.Mock.ofType<autoproj.IPackage>();
            mockPackageTwo = TypeMoq.Mock.ofType<autoproj.IPackage>();
            mockPackageSetOne = TypeMoq.Mock.ofType<autoproj.IPackageSet>();
            pathToPackage = new Map();
            pathToPackageSet = new Map();
            mockWs.setup((x) => x.name).returns(() => "to");
            mockWs.setup((x) => x.root).returns(() => "/path/to");
            mockWsInfo.setup((x: any) => x.then).returns(() => undefined);
            mockWsInfo.setup((x) => x.path).returns(() => "/path/to");
            mockPackageOne.setup((x) => x.srcdir).returns(() => "/path/to/one");
            mockPackageSetOne.setup((x) => x.user_local_dir).returns(() => "/path/to/autoproj/remotes/set.one");
            mockPackageTwo.setup((x) => x.srcdir).returns(() => "/path/to/two");
            mockPackageOne.setup((x) => x.name).returns(() => "one");
            mockPackageTwo.setup((x) => x.name).returns(() => "two");
            mockPackageSetOne.setup((x) => x.name).returns(() => "set.one");
            pathToPackage.set("/path/to/two", mockPackageTwo.object);
            pathToPackage.set("/path/to/one", mockPackageOne.object);
            pathToPackageSet.set("/path/to/autoproj/remotes/set.one", mockPackageSetOne.object);
            mockWorkspaces.setup((x) => x.forEachWorkspace(TypeMoq.It.isAny())).
                callback((cb) => cb(mockWs.object));
        });
        it("throws if installation manifest loading fails", async () => {
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);
            mockWs.setup((x) => x.info()).returns(() => Promise.reject("test"));
            await helpers.assertThrowsAsync(subject.packagePickerChoices(),
                /Could not load installation manifest/);
        });
        it("returns all packages if workspace is empty", async () => {
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);
            mockWs.setup((x) => x.info()).returns(() => Promise.resolve(mockWsInfo.object));
            mockWsInfo.setup((x) => x.packages).returns(() => pathToPackage);
            mockWsInfo.setup((x) => x.packageSets).returns(() => pathToPackageSet);

            const choices = await subject.packagePickerChoices();
            assert.equal(choices.length, 4);
            assert.deepStrictEqual(choices[0].pkg,
                { name: "autoproj (buildconf)", srcdir: "/path/to/autoproj" });
            assert.strictEqual(choices[0].label, "autoproj");
            assert.strictEqual(choices[0].description, "to (buildconf)");
            assert.strictEqual(choices[1].pkg, mockPackageOne.object);
            assert.strictEqual(choices[1].label, "one");
            assert.strictEqual(choices[1].description, "to");
            assert.deepStrictEqual(choices[2].pkg,
                { name: "set.one (package set)", srcdir: "/path/to/autoproj/remotes/set.one" });
            assert.strictEqual(choices[2].label, "set.one");
            assert.strictEqual(choices[2].description, "to (package set)");
            assert.strictEqual(choices[3].pkg, mockPackageTwo.object);
            assert.strictEqual(choices[3].label, "two");
            assert.strictEqual(choices[3].description, "to");
        });
        it("returns packages that are not in the current workspace", async () => {
            const folder: vscode.WorkspaceFolder = {
                index: 0,
                name: "one",
                uri: vscode.Uri.file("/path/to/one"),
            };
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => [folder]);
            mockWs.setup((x) => x.info()).returns(() => Promise.resolve(mockWsInfo.object));
            mockWsInfo.setup((x) => x.packages).returns(() => pathToPackage);
            mockWsInfo.setup((x) => x.packageSets).returns(() => pathToPackageSet);

            const choices = await subject.packagePickerChoices();
            assert.equal(choices.length, 3);
            assert.deepStrictEqual(choices[0].pkg,
                { name: "autoproj (buildconf)", srcdir: "/path/to/autoproj" });
            assert.strictEqual(choices[0].label, "autoproj");
            assert.strictEqual(choices[0].description, "to (buildconf)");
            assert.deepStrictEqual(choices[1].pkg,
                { name: "set.one (package set)", srcdir: "/path/to/autoproj/remotes/set.one" });
            assert.strictEqual(choices[1].label, "set.one");
            assert.strictEqual(choices[1].description, "to (package set)");
            assert.strictEqual(choices[2].pkg, mockPackageTwo.object);
            assert.strictEqual(choices[2].label, "two");
            assert.strictEqual(choices[2].description, "to");
        });
    });
    describe("addPackageToWorkspace()", () => {
        let mockSubject: TypeMoq.IMock<commands.Commands>;
        let mockPackageOne: TypeMoq.IMock<autoproj.IPackage>;
        let mockPackageTwo: TypeMoq.IMock<autoproj.IPackage>;
        let choices: Array<{ label, description, pkg }> = [];
        const options: vscode.QuickPickOptions = {
            matchOnDescription: true,
            placeHolder: "Select a package to add to this workspace",
        };
        beforeEach(() => {
            mockPackageOne = TypeMoq.Mock.ofType<autoproj.IPackage>();
            mockPackageTwo = TypeMoq.Mock.ofType<autoproj.IPackage>();
            mockPackageOne.setup((x) => x.srcdir).returns(() => "/path/to/drivers/one");
            mockPackageTwo.setup((x) => x.srcdir).returns(() => "/path/to/tools/two");
            mockPackageOne.setup((x) => x.name).returns(() => "drivers/one");
            mockPackageTwo.setup((x) => x.name).returns(() => "tools/two");
            choices = [{
                description: "to",
                label: "one",
                pkg: mockPackageOne.object,
            },
            {
                description: "to",
                label: "two",
                pkg: mockPackageTwo.object,
            }];
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("shows an error message if manifest loading fails", async () => {
            mockSubject.setup((x) => x.packagePickerChoices()).
                returns(() => Promise.reject(new Error("test")));
            await subject.addPackageToWorkspace();
            mockWrapper.verify((x) => x.showErrorMessage("test"),
                TypeMoq.Times.once());
        });
        it("shows a quick pick ui", async () => {
            const promise = Promise.resolve(choices);
            mockSubject.setup((x) => x.packagePickerChoices()).
                returns(() => promise);
            await subject.addPackageToWorkspace();

            mockWrapper.verify((x) => x.showErrorMessage(TypeMoq.It.isAny()),
                TypeMoq.Times.never());
            mockWrapper.verify((x) => x.showQuickPick(promise,
                options, TypeMoq.It.isAny()), TypeMoq.Times.once());
        });
        it("handles an empty workspace", async () => {
            const promise = Promise.resolve(choices);
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);
            mockSubject.setup((x) => x.packagePickerChoices()).
                returns(() => promise);
            mockWrapper.setup((x) => x.showQuickPick(promise,
                options, TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[1]));
            await subject.addPackageToWorkspace();

            mockWrapper.verify((x) => x.updateWorkspaceFolders(0, null,
                { name: "tools/two", uri: vscode.Uri.file("/path/to/tools/two") }),
                TypeMoq.Times.once());
        });
        it("keeps the folder list sorted", async () => {
            const folder: vscode.WorkspaceFolder = {
                index: 0,
                name: "tools/two",
                uri: vscode.Uri.file("/path/to/tools/two"),
            };
            const promise = Promise.resolve(choices);
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => [folder]);
            mockSubject.setup((x) => x.packagePickerChoices()). returns(() => promise);
            mockWrapper.setup((x) => x.showQuickPick(promise,
                options, TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[0]));
            await subject.addPackageToWorkspace();

            mockWrapper.verify((x) => x.updateWorkspaceFolders(0, null,
                { name: "drivers/one", uri: vscode.Uri.file("/path/to/drivers/one") }), TypeMoq.Times.once());
        });
        it("shows an error if folder could not be added", async () => {
            const promise = Promise.resolve(choices);
            mockWrapper.setup((x) => x.workspaceFolders).returns(() => undefined);
            mockSubject.setup((x) => x.packagePickerChoices()).returns(() => promise);
            mockWrapper.setup((x) => x.showQuickPick(promise,
                options, TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[1]));
            mockWrapper.setup((x) => x.updateWorkspaceFolders(0, null,
                    { uri: vscode.Uri.file("/path/to/tools/two") })).returns(() => false);

            await subject.addPackageToWorkspace();
            mockWrapper.verify((x) => x.showErrorMessage("Could not add folder: /path/to/tools/two"),
                TypeMoq.Times.once());
        });
    });
    describe("showOutputChannel()", () => {
        let mockOutputChannel: TypeMoq.IMock<vscode.OutputChannel>;
        beforeEach(() => {
            mockOutputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
            mockContext.setup((x) => x.outputChannel).returns(() => mockOutputChannel.object);
        });
        it("shows the output channel", async () => {
            subject.showOutputChannel();
            mockOutputChannel.verify((x) => x.show(), TypeMoq.Times.once());
        });
    });
    describe("register()", () => {
        function setupWrapper(command: string, callback: (command, cb) => void) {
            mockWrapper.setup((x) => x.registerAndSubscribeCommand(command, TypeMoq.It.isAny())).callback(callback);
        }

        it("registers all commands", async () => {
            let updatePackageInfoCb: () => Promise<void>;
            let showOutputChannelCb: () => void;
            let addPackageToWorkspaceCb: () => Promise<void>;

            const mockUpdatePackageInfo = TypeMoq.Mock.ofInstance(() => Promise.resolve());
            subject.updatePackageInfo = mockUpdatePackageInfo.object;

            const mockShowOutputChannel = TypeMoq.Mock.ofInstance(() => {
                // no-op
            });
            subject.showOutputChannel = mockShowOutputChannel.object;

            const mockAddPackageToWorkspace = TypeMoq.Mock.ofInstance(() => Promise.resolve());
            subject.addPackageToWorkspace = mockAddPackageToWorkspace.object;

            setupWrapper("autoproj.updatePackageInfo", (command, cb) => updatePackageInfoCb = cb);
            setupWrapper("autoproj.showOutputChannel", (command, cb) => showOutputChannelCb = cb);
            setupWrapper("autoproj.addPackageToWorkspace", (command, cb) => addPackageToWorkspaceCb = cb);

            subject.register();
            updatePackageInfoCb!();
            showOutputChannelCb!();
            addPackageToWorkspaceCb!();

            mockUpdatePackageInfo.verify((x) => x(), TypeMoq.Times.once());
            mockShowOutputChannel.verify((x) => x(), TypeMoq.Times.once());
            mockAddPackageToWorkspace.verify((x) => x(), TypeMoq.Times.once());
        });
    });
});
