'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../src/wrappers';
import * as context from '../src/context';
import * as helpers from './helpers';
import * as autoproj from '../src/autoproj';
import { basename, dirname } from 'path';
import * as commands from '../src/commands';

describe("Commands", function () {
    let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<context.Context>;
    let subject: commands.Commands;

    beforeEach(function () {
        mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        subject = new commands.Commands(mockContext.object,
            mockWrapper.object);
        mockContext.setup(x => x.workspaces).returns(() => mockWorkspaces.object);
    })
    describe("updatePackageInfo()", function () {
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        let mockSubject: TypeMoq.IMock<commands.Commands>;
        beforeEach(function () {
            mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWorkspace.setup((x: any) => x.then).returns(() => undefined);
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("does nothing if canceled", async function () {
            mockSubject.setup(x => x.showWorkspacePicker()).
                returns(() => Promise.resolve(undefined));
            await subject.updatePackageInfo();
            mockContext.verify(x => x.updateWorkspaceInfo(TypeMoq.It.isAny()),
                TypeMoq.Times.never());
        })
        it("handles an exception while updating workspace info", async function () {
            mockSubject.setup(x => x.showWorkspacePicker()).
                returns(() => Promise.resolve(mockWorkspace.object));
            mockContext.setup(x => x.updateWorkspaceInfo(mockWorkspace.object)).
                returns(() => Promise.reject(new Error("test")));
            await subject.updatePackageInfo();
            mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            mockContext.verify(x => x.updateWorkspaceInfo(mockWorkspace.object),
                TypeMoq.Times.once());
        })
        it("handles an exception if workspace is empty", async function () {
            mockSubject.setup(x => x.showWorkspacePicker()).
                returns(() => Promise.reject(new Error("test")));
            await subject.updatePackageInfo();
            mockWrapper.verify(x => x.showErrorMessage("test"), TypeMoq.Times.once());
            mockContext.verify(x => x.updateWorkspaceInfo(TypeMoq.It.isAny()),
                TypeMoq.Times.never());
        })
        it("updates workspace info", async function () {
            mockSubject.setup(x => x.showWorkspacePicker()).
                returns(() => Promise.resolve(mockWorkspace.object));
            mockContext.setup(x => x.updateWorkspaceInfo(mockWorkspace.object)).
                returns(() => Promise.resolve());
            await subject.updatePackageInfo();
            mockContext.verify(x => x.updateWorkspaceInfo(mockWorkspace.object),
                TypeMoq.Times.once());
        })
    })
    describe("showWorkspacePicker()", function () {
        let choices: { label, description, ws }[];
        let mockOne: TypeMoq.IMock<autoproj.Workspace>;
        let mockTwo: TypeMoq.IMock<autoproj.Workspace>;
        let workspaces: Map<string, autoproj.Workspace>;

        function makeChoice(ws: autoproj.Workspace) {
            return {
                label: basename(ws.root),
                description: basename(dirname(ws.root)),
                ws: ws
            }
        }
        beforeEach(function () {
            workspaces = new Map();
            mockOne = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockTwo = TypeMoq.Mock.ofType<autoproj.Workspace>();

            mockOne.setup(x => x.root).returns(() => "/ws/one");
            mockTwo.setup(x => x.root).returns(() => "/ws/two");
            mockOne.setup((x: any) => x.then).returns(() => undefined);
            mockTwo.setup((x: any) => x.then).returns(() => undefined);

            choices = [];
            choices.push(makeChoice(mockOne.object));
            choices.push(makeChoice(mockTwo.object));
            workspaces.set("/ws/one", mockOne.object);
            workspaces.set("/ws/two", mockTwo.object);
        })
        it("throws if there are no autoproj workspaces", async function () {
            mockWorkspaces.setup(x => x.workspaces).returns(() => new Map());
            await helpers.assertThrowsAsync(subject.showWorkspacePicker(),
                /No Autoproj workspace/)
        })
        it("skip picker if there is only one workspace", async function () {
            let tempWs: Map<string, autoproj.Workspace> = new Map();
            tempWs.set("/ws/one", mockOne.object);
            mockWorkspaces.setup(x => x.workspaces).returns(() => tempWs);
            let ws = await subject.showWorkspacePicker();
            mockWrapper.verify(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny()), TypeMoq.Times.never());
            assert.strictEqual(ws, mockOne.object);
        })
        it("returns undefined if canceled", async function () {
            mockWorkspaces.setup(x => x.workspaces).returns(() => workspaces);
            mockWorkspaces.setup(x => x.forEachWorkspace(TypeMoq.It.isAny())).
                returns((callback) => workspaces.forEach(callback));
            mockWrapper.setup(x => x.showQuickPick(choices,
                TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

            let ws = await subject.showWorkspacePicker();
            assert(!ws);
        });
        it("returns the picked workspace", async function () {
            mockWorkspaces.setup(x => x.workspaces).returns(() => workspaces);
            mockWorkspaces.setup(x => x.forEachWorkspace(TypeMoq.It.isAny())).
                returns((callback) => workspaces.forEach(callback));
            mockWrapper.setup(x => x.showQuickPick(choices,
                TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[0]))

            let ws = await subject.showWorkspacePicker();
            mockWrapper.verify(x => x.showQuickPick(choices, TypeMoq.It.isAny()),
                TypeMoq.Times.once());
            assert.strictEqual(ws, choices[0].ws);
        });
    })
    describe("packagePickerChoices()", function () {
        let mockWs: TypeMoq.IMock<autoproj.Workspace>;
        let mockWsInfo: TypeMoq.IMock<autoproj.WorkspaceInfo>;
        let mockPackageOne: TypeMoq.IMock<autoproj.Package>;
        let mockPackageTwo: TypeMoq.IMock<autoproj.Package>;
        let pathToPackage: Map<string, autoproj.Package>;
        beforeEach(function () {
            mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
            mockWsInfo = TypeMoq.Mock.ofType<autoproj.WorkspaceInfo>();
            mockPackageOne = TypeMoq.Mock.ofType<autoproj.Package>();
            mockPackageTwo = TypeMoq.Mock.ofType<autoproj.Package>();
            pathToPackage = new Map();
            mockWs.setup(x => x.name).returns(() => 'to')
            mockWs.setup(x => x.root).returns(() => '/path/to')
            mockWsInfo.setup((x: any) => x.then).returns(() => undefined);
            mockWsInfo.setup(x => x.path).returns(() => '/path/to');
            mockPackageOne.setup(x => x.srcdir).returns(() => '/path/to/one');
            mockPackageTwo.setup(x => x.srcdir).returns(() => '/path/to/two');
            mockPackageOne.setup(x => x.name).returns(() => 'one');
            mockPackageTwo.setup(x => x.name).returns(() => 'two');
            pathToPackage.set('/path/to/two', mockPackageTwo.object);
            pathToPackage.set('/path/to/one', mockPackageOne.object);
            mockWorkspaces.setup(x => x.forEachWorkspace(TypeMoq.It.isAny())).
                callback((cb) => cb(mockWs.object));
        })
        it("throws if installation manifest loading fails", async function () {
            mockWrapper.setup(x => x.workspaceFolders).returns(() => undefined);
            mockWs.setup(x => x.info()).returns(() => Promise.reject('test'));
            await helpers.assertThrowsAsync(subject.packagePickerChoices(),
                /Could not load installation manifest/)
        })
        it("returns all packages if workspace is empty", async function () {
            mockWrapper.setup(x => x.workspaceFolders).returns(() => undefined);
            mockWs.setup(x => x.info()).returns(() => Promise.resolve(mockWsInfo.object));
            mockWsInfo.setup(x => x.packages).returns(() => pathToPackage);

            const choices = await subject.packagePickerChoices();
            assert.equal(choices.length, 3);
            assert.deepStrictEqual(choices[0].pkg,
                { name: 'autoproj', srcdir: '/path/to/autoproj' });
            assert.strictEqual(choices[0].label, 'autoproj');
            assert.strictEqual(choices[0].description, 'to Build Configuration');
            assert.strictEqual(choices[1].pkg, mockPackageOne.object);
            assert.strictEqual(choices[1].label, 'one');
            assert.strictEqual(choices[1].description, 'to');
            assert.strictEqual(choices[2].pkg, mockPackageTwo.object);
            assert.strictEqual(choices[2].label, 'two');
            assert.strictEqual(choices[2].description, 'to');
        })
        it("returns packages that are not in the current workspace", async function () {
            let folder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file('/path/to/one'),
                name: 'one',
                index: 0
            }
            mockWrapper.setup(x => x.workspaceFolders).returns(() => [folder]);
            mockWs.setup(x => x.info()).returns(() => Promise.resolve(mockWsInfo.object));
            mockWsInfo.setup(x => x.packages).returns(() => pathToPackage);

            const choices = await subject.packagePickerChoices();
            assert.equal(choices.length, 2);
            assert.deepStrictEqual(choices[0].pkg,
                { name: 'autoproj', srcdir: '/path/to/autoproj' });
            assert.strictEqual(choices[0].label, 'autoproj');
            assert.strictEqual(choices[0].description, 'to Build Configuration');
            assert.strictEqual(choices[1].pkg, mockPackageTwo.object);
            assert.strictEqual(choices[1].label, 'two');
            assert.strictEqual(choices[1].description, 'to');
        })
    })
    describe("addPackageToWorkspace()", function () {
        let mockSubject: TypeMoq.IMock<commands.Commands>;
        let mockPackageOne: TypeMoq.IMock<autoproj.Package>;
        let mockPackageTwo: TypeMoq.IMock<autoproj.Package>;
        let choices: { label, description, pkg }[] = [];
        const options: vscode.QuickPickOptions = {
            placeHolder: 'Select a package to add to this workspace'
        }
        beforeEach(function () {
            mockPackageOne = TypeMoq.Mock.ofType<autoproj.Package>();
            mockPackageTwo = TypeMoq.Mock.ofType<autoproj.Package>();
            mockPackageOne.setup(x => x.srcdir).returns(() => '/path/to/one');
            mockPackageTwo.setup(x => x.srcdir).returns(() => '/path/to/two');
            mockPackageOne.setup(x => x.name).returns(() => 'one');
            mockPackageTwo.setup(x => x.name).returns(() => 'two');
            choices = [{
                label: 'one',
                description: 'to',
                pkg: mockPackageOne.object
            },
            {
                label: 'two',
                description: 'to',
                pkg: mockPackageTwo.object
            }];
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("shows an error message if manifest loading fails", async function () {
            mockSubject.setup(x => x.packagePickerChoices()).
                returns(() => Promise.reject(new Error('test')));
            await subject.addPackageToWorkspace();
            mockWrapper.verify(x => x.showErrorMessage("test"),
                TypeMoq.Times.once());
        })
        it("shows a quick pick ui", async function () {
            const promise = Promise.resolve(choices);
            mockSubject.setup(x => x.packagePickerChoices()).
                returns(() => promise);
            await subject.addPackageToWorkspace();

            mockWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAny()),
                TypeMoq.Times.never());
            mockWrapper.verify(x => x.showQuickPick(promise,
                options, TypeMoq.It.isAny()), TypeMoq.Times.once());
        })
        it("handles an empty workspace", async function () {
            const promise = Promise.resolve(choices);
            mockWrapper.setup(x => x.workspaceFolders).returns(() => undefined);
            mockSubject.setup(x => x.packagePickerChoices()).
                returns(() => promise);
            mockWrapper.setup(x => x.showQuickPick(promise,
                options, TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[1]));
            await subject.addPackageToWorkspace();

            mockWrapper.verify(x => x.updateWorkspaceFolders(0, null,
                { name: 'two', uri: vscode.Uri.file('/path/to/two') }),
                TypeMoq.Times.once());
        })
        it("keeps the folder list sorted", async function () {
            const folder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file('/path/to/two'),
                name: 'two',
                index: 0
            }
            const promise = Promise.resolve(choices);
            mockWrapper.setup(x => x.workspaceFolders).returns(() => [folder]);
            mockSubject.setup(x => x.packagePickerChoices()).
                returns(() => promise);
            mockWrapper.setup(x => x.showQuickPick(promise,
                options, TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[0]));
            await subject.addPackageToWorkspace();

            mockWrapper.verify(x => x.updateWorkspaceFolders(0, null,
                { name: 'one', uri: vscode.Uri.file('/path/to/one') }),
                TypeMoq.Times.once());
        })
        it("shows an error if folder could not be added", async function () {
            const promise = Promise.resolve(choices);
            mockWrapper.setup(x => x.workspaceFolders).returns(() => undefined);
            mockSubject.setup(x => x.packagePickerChoices()).
                returns(() => promise);
            mockWrapper.setup(x => x.showQuickPick(promise,
                options, TypeMoq.It.isAny())).returns(() => Promise.resolve(choices[1]));
            mockWrapper.setup(x => x.updateWorkspaceFolders(0, null,
                    { uri: vscode.Uri.file('/path/to/two') })).returns(() => false);

            await subject.addPackageToWorkspace();
            mockWrapper.verify(x => x.showErrorMessage("Could not add folder: /path/to/two"),
                TypeMoq.Times.once());
        })
    })
});
