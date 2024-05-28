import * as assert from "assert";
import { Mocks, WorkspaceBuilder } from "./helpers";
import * as path from "path";
import * as progress from "../src/progress";
import * as util from "../src/util";
import * as fileWatcher from "../src/fileWatcher";
import { BundleWatcher, BundleManager } from "../src/bundleWatcher";
import { Workspace } from "../src/autoproj";
import { GlobalMock, IGlobalMock, IMock, It, Mock, Times } from "typemoq";
import { using } from "./using";
import { fs } from "../src/cmt/pr";
import { setTimeout as sleep } from "timers/promises";

describe("BundleManager", () => {
    let mocks: Mocks;
    let builder: WorkspaceBuilder;
    let workspace: Workspace;
    let subject: BundleManager;

    beforeEach(() => {
        mocks = new Mocks();
        builder = new WorkspaceBuilder();
        workspace = builder.workspace;
        subject = new BundleManager(mocks.logOutputChannel.object);
        using(mocks.showErrorMessage);
    })
    describe("getWatcher()", () => {
        it("always returns the same watcher", () => {
            const watcher = subject.getWatcher(workspace);
            assert.equal(watcher, subject.getWatcher(workspace));
        });
        describe("with a mock watcher", () => {
            let mockSubject: IMock<BundleManager>;
            let mockWatcher: IMock<BundleWatcher>;
            beforeEach(() => {
                mockSubject = Mock.ofInstance(subject);
                mockSubject.callBase = true;

                mockWatcher = Mock.ofType<BundleWatcher>();
                mockSubject.setup((x) => x.createWatcher(workspace)).returns(() => mockWatcher.object);
                subject = mockSubject.object;
            });
            it("delegates calls", async () => {
                await subject.check(workspace);
                await subject.install(workspace);
                subject.dispose();
                subject.unwatch(workspace);

                mockWatcher.verify((x) => x.check(), Times.once());
                mockWatcher.verify((x) => x.queueInstall(), Times.once());
                mockWatcher.verify((x) => x.dispose(), Times.exactly(2));
            });
        });
    })
});

describe("BundleWatcher", () => {
    let builder: WorkspaceBuilder;
    let mocks: Mocks;
    let workspace: Workspace;
    let subject: BundleWatcher;
    let mockView: IMock<progress.ProgressView>;
    let extensionGemfile: string;
    let stateFile: string;
    let execution: util.IAsyncExecution;

    beforeEach(() => {
        mocks = new Mocks();
        builder = new WorkspaceBuilder();
        workspace = builder.workspace;
        mockView = Mock.ofType<progress.ProgressView>();
        using(mocks.asyncSpawn, mocks.createProgressView, mocks.showErrorMessage);

        let envshFile = path.join(workspace.root, "env.sh");
        extensionGemfile = path.join(workspace.root, ".autoproj", "vscode-autoproj", "Gemfile");
        stateFile = path.join(workspace.root, ".autoproj", "vscode-autoproj", "state.json");
        const cmd = `. ${envshFile} && BUNDLE_GEMFILE='${extensionGemfile}' exec bundle install`;

        mocks.createProgressView.setup((x) => x(It.isAny())).returns((x) => mockView.object);
        mocks.asyncSpawn.setup((x) => x(mocks.logOutputChannel.object, "/bin/sh", ["-c", cmd]))
            .callback(() => builder.fs.mkfile("three", ".autoproj", "vscode-autoproj", "Gemfile.lock"))
            .returns(() => execution)

        subject = new BundleWatcher(workspace, mocks.logOutputChannel.object);

        builder.fs.registerDir(".autoproj", "vscode-autoproj");
        builder.fs.registerFile(".autoproj", "vscode-autoproj", "Gemfile");
        builder.fs.registerFile(".autoproj", "vscode-autoproj", "Gemfile.lcok");
        builder.fs.registerFile(".autoproj", "vscode-autoproj", "state.json");
        builder.fs.mkdir("install", "gems");
        builder.fs.mkfile("one", "install", "gems", "Gemfile.lock");
        builder.fs.mkfile("two", ".autoproj", "Gemfile.lock");
    })
    afterEach(() => {
        subject.dispose();
    });
    function assertFailureUi(show: boolean) {
        const times = show ? Times.once() : Times.never();
        mockView.verify((x) => x.show(), Times.once());
        mockView.verify((x) => x.close(), Times.once());
        mocks.logOutputChannel.verify((x) => x.show(), times);
        mocks.showErrorMessage.verify((x) => x(It.isAny()), times);
    }
    function assertSpawned(times: number) {
        mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.exactly(times));
    }
    describe("queueInstall()", async () => {
        it("shows a progress and an error UI in case of failure", async () => {
            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(1)
            };

            await subject.queueInstall();
            assertFailureUi(true);
        });
        it("shows a progress and an error UI if bundle cannot be executed", async () => {
            const error = Promise.reject(new Error("Error"));
            await error.catch((error) => {}); // to avoid mocha complaining about unhandled rejections

            execution = {
                childProcess: undefined as any,
                returnCode: error
            };

            await subject.queueInstall();
            assertFailureUi(true);
        });
        it("shows a progress and an error UI if gemfile cannot be created", async () => {
            builder.fs.mkdir(".autoproj", "vscode-autoproj", "Gemfile"); // mkdir to make 'fs.writeFile' fail
            await subject.queueInstall();
            assertSpawned(0);
            assertFailureUi(true);
        })
        it("writes the extension Gemfile", async () => {
            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(0)
            };

            const gemfileContents = [
                '# frozen_string_literal: true',
                '# AUTO GENERATED BY THE VSCODE AUTOPROJ EXTENSION',
                'source "https://rubygems.org"',
                '',
                `eval_gemfile "${workspace.root}/install/gems/Gemfile"`,
                `eval_gemfile "${workspace.root}/.autoproj/Gemfile"`,
                'gem "ruby-lsp"',
                'gem "debug"',
                ''
            ].join("\n");

            await subject.queueInstall();
            assertSpawned(1);
            assertFailureUi(false);
            assert.equal(gemfileContents, await fs.readFile(extensionGemfile))
        });
        it("writes the state of the bundle", async () => {
            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(0)
            };

            const state = {
                [await subject.userLockPath]: "fe05bcdcdc4928012781a5f1a2a77cbb5398e106",
                [subject.autoprojLockPath]: "ad782ecdac770fc6eb9a62e44f90873fb97fb26b",
                [subject.extensionLockPath]: "b802f384302cb24fbab0a44997e820bf2e8507bb"
            }

            await subject.queueInstall();
            assertSpawned(1);
            assertFailureUi(false);
            assert.deepStrictEqual(state, JSON.parse(await fs.readFile(stateFile)))
        });
        it("starts watching the bundle for changes", async () => {
            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(0)
            };

            await subject.queueInstall();
            await fs.writeFile(await subject.userLockPath, "foo");
            await sleep(50);
            assertSpawned(2);
        });
    });
    describe("getSavedState()", () => {
        it("returns an empty object if it state cannot be read", async () => {
            assert.deepStrictEqual({}, await subject.getSavedState());
        });
    });
    describe("check()", () => {
        it("does nothing if bundle is up-to-date", async () => {
            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(0)
            };

            await subject.queueInstall();
            await subject.check();
            assertSpawned(1);
        });
        it("does nothing if gemfile does not exist", async () => {
            await subject.check();
            assertSpawned(0);
        });
        it("re-installs if bundle changed", async () => {
            execution = {
                childProcess: undefined as any,
                returnCode: Promise.resolve(0)
            };

            await subject.queueInstall();
            await subject.unwatch();
            await fs.writeFile(await subject.userLockPath, "foo");
            await subject.check();
            assertSpawned(2);
        });
    });
    describe("with a fake file watcher", () => {
        let mockFileWatcher: IGlobalMock<fileWatcher.FileWatcher>;
        beforeEach(() => {
            mockFileWatcher = GlobalMock.ofType<fileWatcher.FileWatcher>(fileWatcher.FileWatcher, fileWatcher);
            using(mockFileWatcher);

            subject.dispose();
            subject = new BundleWatcher(workspace, mocks.logOutputChannel.object);
        })
        describe("dispose()", () => {
            it("disposes of file watcher", () => {
                subject.dispose();
                mockFileWatcher.verify((x) => x.dispose(), Times.once());
            });
        });
        describe("watch()", () => {
            it("does not start watching twice", async () => {
                await subject.watch();
                await subject.watch();

                const userLockPath = await subject.userLockPath;
                mockFileWatcher.verify((x) => x.startWatching(userLockPath, It.isAny()), Times.once());
                mockFileWatcher.verify((x) => x.startWatching(subject.autoprojLockPath, It.isAny()), Times.once());
                mockFileWatcher.verify((x) => x.startWatching(subject.extensionLockPath, It.isAny()), Times.once());
            });
        });
        describe("unwatch()", () => {
            it("does not stop watching twice", async () => {
                await subject.watch();
                await subject.unwatch();
                await subject.unwatch();

                const userLockPath = await subject.userLockPath;
                mockFileWatcher.verify((x) => x.stopWatching(userLockPath), Times.once());
                mockFileWatcher.verify((x) => x.stopWatching(subject.autoprojLockPath), Times.once());
                mockFileWatcher.verify((x) => x.stopWatching(subject.extensionLockPath), Times.once());
            });
        });
    });
});