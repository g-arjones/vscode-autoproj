"use strict";
import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as context from "../src/context";
import * as wrappers from "../src/wrappers";
import * as helpers from "./helpers";

class TestContext {
    public root: string;
    public mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    public workspaces: autoproj.Workspaces;
    public outputChannel: vscode.OutputChannel;
    public workspaceFolders: vscode.WorkspaceFolder[];

    public subject: context.Context;
    constructor() {
        this.root = helpers.init();
        this.mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        this.mockWrapper.setup((x) => x.workspaceFolders)
            .returns(() => this.workspaceFolders);
        this.workspaces = new autoproj.Workspaces();
        const mockOutputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        mockOutputChannel.setup((x) => x.dispose()).returns(() => undefined);

        this.outputChannel = mockOutputChannel.object;
        this.subject = new context.Context(this.workspaces, mockOutputChannel.object);
    }

    public clear(): void {
        helpers.clear();
    }
}

describe("Context tests", () => {
    let testContext: TestContext;
    beforeEach(() => {
        testContext = new TestContext();
    });
    afterEach(() => {
        testContext.clear();
    });

    function verifyContextUpdated(times) {
        const mock = TypeMoq.Mock.ofInstance(() => undefined);
        mock.object();
        testContext.subject.onUpdate(mock);
        mock.verify((x) => x(), times);
    }
    it("returns the given workspaces", () => {
        assert.strictEqual(testContext.workspaces, testContext.subject.workspaces);
    });
    it("calls envsh and fires the update event", async () => {
        const mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
        await testContext.subject.updateWorkspaceInfo(mockWs.object);
        mockWs.verify((x) => x.envsh(), TypeMoq.Times.once());
        verifyContextUpdated(TypeMoq.Times.once());
    });
    it("returns the given output channel", () => {
        assert.strictEqual(testContext.outputChannel, testContext.subject.outputChannel);
    });
});
