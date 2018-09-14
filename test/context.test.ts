'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../src/wrappers';
import * as context from '../src/context';
import * as autoproj from '../src/autoproj';
import * as helpers from './helpers';

class TestContext
{
    root: string;
    mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    workspaces: autoproj.Workspaces;

    workspaceFolders: vscode.WorkspaceFolder[];

    subject: context.Context;
    constructor()
    {
        this.root = helpers.init();
        this.mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        this.mockWrapper.setup(x => x.workspaceFolders)
            .returns(() => this.workspaceFolders);
        this.workspaces = new autoproj.Workspaces;
        let mockOutputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        mockOutputChannel.setup(x => x.dispose()).returns(() => undefined)

        this.subject = new context.Context(
            this.mockWrapper.object,
            this.workspaces,
            mockOutputChannel.object);
    }

    clear(): void
    {
        helpers.clear();
    }
}

describe("Context tests", function () {
    let testContext: TestContext;
    beforeEach(function () {
        testContext = new TestContext;
    })
    afterEach(function () {
        testContext.clear();
    })

    function verifyContextUpdated(times) {
        const mock = TypeMoq.Mock.ofInstance(() => undefined);
        mock.object();
        testContext.subject.onUpdate(mock);
        mock.verify(x => x(), times);
    }
    it("returns the given workspaces", function () {
        assert.strictEqual(testContext.workspaces, testContext.subject.workspaces);
    });
    it("calls envsh and fires the update event", async function () {
        const mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
        await testContext.subject.updateWorkspaceInfo(mockWs.object);
        mockWs.verify(x => x.envsh(), TypeMoq.Times.once());
        verifyContextUpdated(TypeMoq.Times.once());
    });
});
