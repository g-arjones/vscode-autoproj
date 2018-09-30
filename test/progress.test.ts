import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as progress from "../src/progress";
import * as wrappers from "../src/wrappers";

describe("ProgressView()", () => {
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockProgress: TypeMoq.IMock<vscode.Progress<{ message?: string, increment?: number }>>;
    let mockToken: TypeMoq.IMock<vscode.CancellationToken>;
    let subject: progress.ProgressView;
    type TaskType = (progress: vscode.Progress<{ message?: string; increment?: number }>,
                     token: vscode.CancellationToken) => Thenable<void>;

    beforeEach(() => {
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockToken = TypeMoq.Mock.ofType<vscode.CancellationToken>();
        mockProgress = TypeMoq.Mock.ofType<vscode.Progress<{ message?: string, increment?: number }>>();
        mockWrapper.setup((x) => x.withProgress(TypeMoq.It.isAny(), TypeMoq.It.isAny())).
            callback((options: vscode.ProgressOptions, task: TaskType) => {
            task(mockProgress.object, mockToken.object);
        });
        subject = progress.createProgressView(mockWrapper.object);
        subject.show();
    });
    describe("show()", () => {
        beforeEach(() => {
            subject = progress.createProgressView(mockWrapper.object, "the title");
        });
        it("creates an instance of a progress notification", () => {
            const expectedOptions: vscode.ProgressOptions = {
                cancellable: false,
                location: vscode.ProgressLocation.Notification,
                title: "the title",
            };
            subject.show();
            mockWrapper.verify((x) => x.withProgress(expectedOptions, TypeMoq.It.isAny()), TypeMoq.Times.once());
        });
    });
    describe("get title()", () => {
        beforeEach(() => {
            subject = progress.createProgressView(mockWrapper.object, "the title");
        });
        it("returns the title being used", () => {
            assert.equal(subject.title, "the title");
        });
    });
    describe("get progress()", () => {
        it("is initialized with zero", () => {
            assert.equal(subject.progress, 0);
        });
    });
    describe("update()", () => {
        it("updates the progress", () => {
            subject.update("", 20);
            assert.equal(subject.progress, 20);
            mockProgress.verify((x) => x.report({ message: "", increment: 20}), TypeMoq.Times.once());
        });
        it("updates the text", () => {
            subject.update("something", 20);
            assert.equal(subject.text, "something");
            mockProgress.verify((x) => x.report({ message: "something", increment: 20}), TypeMoq.Times.once());
        });
        it("resets the progress", () => {
            subject.update("", -20);
            assert.equal(subject.progress, 0);
            mockProgress.verify((x) => x.report({ message: "", increment: -20}), TypeMoq.Times.once());
        });
    });
    describe("close()", () => {
        it("closes the notification", async () => {
            subject.close();
            await subject.wait();
        });
    });
});
