import * as assert from "assert";
import * as vscode from "vscode";
import * as progress from "../src/progress";
import { GlobalMock, IGlobalMock, IMock, It, Mock, Times } from "typemoq";
import { using } from "./using";

describe("ProgressView()", () => {
    let mockWithProgress: IGlobalMock<typeof vscode.window.withProgress>;
    let mockProgress: IMock<vscode.Progress<{ message?: string, increment?: number }>>;
    let mockToken: IMock<vscode.CancellationToken>;
    let subject: progress.ProgressView;
    type TaskType = (progress: vscode.Progress<{ message?: string; increment?: number }>,
                     token: vscode.CancellationToken) => Thenable<void>;

    beforeEach(() => {
        mockWithProgress = GlobalMock.ofInstance(vscode.window.withProgress, "withProgress", vscode.window);
        mockToken = Mock.ofType<vscode.CancellationToken>();
        mockProgress = Mock.ofType<vscode.Progress<{ message?: string, increment?: number }>>();
        mockWithProgress.setup((x) => x(It.isAny(), It.isAny())).
            callback((options: vscode.ProgressOptions, task: TaskType) => {
                task(mockProgress.object, mockToken.object);
            });

        using(mockWithProgress);
        subject = progress.createProgressView();
        subject.show();
    });
    describe("show()", () => {
        beforeEach(() => {
            subject = progress.createProgressView("the title");
        });
        it("creates an instance of a progress notification", () => {
            const expectedOptions: vscode.ProgressOptions = {
                cancellable: false,
                location: vscode.ProgressLocation.Notification,
                title: "the title",
            };
            subject.show();
            mockWithProgress.verify((x) => x(expectedOptions, It.isAny()), Times.once());
        });
    });
    describe("get title()", () => {
        beforeEach(() => {
            subject = progress.createProgressView("the title");
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
            mockProgress.verify((x) => x.report({ message: "", increment: 20}), Times.once());
        });
        it("updates the text", () => {
            subject.update("something", 20);
            assert.equal(subject.text, "something");
            mockProgress.verify((x) => x.report({ message: "something", increment: 20}), Times.once());
        });
        it("resets the progress", () => {
            subject.update("", -20);
            assert.equal(subject.progress, 0);
            mockProgress.verify((x) => x.report({ message: "", increment: -20}), Times.once());
        });
    });
    describe("close()", () => {
        it("closes the notification", async () => {
            subject.close();
            await subject.wait();
        });
    });
});
