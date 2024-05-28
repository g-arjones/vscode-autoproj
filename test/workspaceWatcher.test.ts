import * as assert from "assert";
import * as child_process from "child_process";
import * as fileWatcher from "../src/fileWatcher";
import { setTimeout as sleep } from "timers/promises";
import { Workspace } from "../src/autoproj";
import { WatchManager, WatchProcess } from "../src/workspaceWatcher";
import { WorkspaceBuilder, Mocks } from "./helpers";
import { GlobalMock, GlobalScope, IMock, It, Mock, Times } from "typemoq";
import { using } from "./using";
import { fs } from "../src/cmt/pr";
import { IAsyncExecution } from "../src/util";

describe("WatchManager", () => {
    let builder: WorkspaceBuilder;
    let workspace: Workspace;
    let mocks: Mocks;
    let subject: WatchManager;

    beforeEach(() => {
        mocks = new Mocks();
        builder = new WorkspaceBuilder();
        workspace = builder.workspace;
        subject = new WatchManager(mocks.logOutputChannel.object);
    });
    describe("createProcess()", () => {
        it("creates a WatchProcess instance for the given workspace", () => {
            const proc = subject.createProcess(workspace);
            assert.strictEqual(proc["_workspace"], workspace);
        })
    });
    describe("with mocked processes", () => {
        let mockSubject: IMock<WatchManager>;
        let mockProcess: IMock<WatchProcess>;
        beforeEach(() => {
            mockProcess = Mock.ofType<WatchProcess>();
            mockSubject = Mock.ofInstance(subject);
            mockSubject.callBase = true;
            subject = mockSubject.object;

            mockSubject.setup((x) => x.createProcess(It.isAny())).returns(() => mockProcess.object);
        });
        describe("start()", () => {
            it("creates and starts a WatchProcess", () => {
                subject.start(workspace);
                mockProcess.verify((x) => x.start(), Times.once());
            });
            it("starts a previously created WatchProcess", () => {
                subject["_folderToProcess"].set(workspace.root, mockProcess.object);
                subject.start(workspace);
                mockSubject.verify((x) => x.createProcess(It.isAny()), Times.never());
                mockProcess.verify((x) => x.start(), Times.once());
            });
        });
        describe("stop()", () => {
            it("stops a previously started WatchProcess", async () => {
                subject.start(workspace);
                await subject.stop(workspace);
                await subject.stop(workspace); // no-op
                mockProcess.verify((x) => x.start(), Times.once());
                mockProcess.verify((x) => x.stop(), Times.once());
            })
        });
        describe("dispose()", () => {
            it("stops and disposes of processes", async () => {
                subject.start(workspace);
                subject.dispose();
                mockProcess.verify((x) => x.stop(), Times.once());
                mockProcess.verify((x) => x.dispose(), Times.once());
                assert.equal(subject["_folderToProcess"].size, 0);
            })
        });
    });
});

describe("WatchProcess", () => {
    let builder: WorkspaceBuilder;
    let workspace: Workspace;
    let mocks: Mocks;
    let mockChild: IMock<child_process.ChildProcessWithoutNullStreams>;
    let subject: WatchProcess;
    let stopped: boolean;
    let sendError: ((error: Error) => void) | undefined;
    let sendCode: ((code: number) => void) | undefined;
    let execution: IAsyncExecution;
    let spawned: boolean;
    beforeEach(() => {
        mocks = new Mocks();
        builder = new WorkspaceBuilder();
        workspace = builder.workspace;
        mockChild = Mock.ofType<child_process.ChildProcessWithoutNullStreams>();
        mockChild.setup((x) => x.killed).returns(() => stopped);
        subject = new WatchProcess(workspace, mocks.logOutputChannel.object);

        WatchProcess.RESTART_RETRIES = 2;
        WatchProcess.RESTART_PROCESS_TIMEOUT_SEC = 0.001;
        WatchProcess.STALE_PID_FILE_TIMEOUT_SEC = 0.001;

        stopped = false;
        spawned = false;
        mocks.asyncSpawn.setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
            .callback(() => {
                execution = {
                    childProcess: mockChild.object,
                    returnCode: new Promise<number | null>((resolve, reject) => {
                        sendCode = resolve;
                        sendError = reject;
                        spawned = true;
                    })
                }
            })
            .returns(() => execution);

        using(mocks.asyncSpawn, mocks.showErrorMessage);

        // uncomment to debug
        // mocks.logOutputChannel.setup((x) => x.info(It.isAny())).callback((...msg) => {
        //     console.log(...msg);
        // })
        // mocks.logOutputChannel.setup((x) => x.error(It.isAny())).callback((...msg) => {
        //     console.error(...msg);
        // })
        // mocks.logOutputChannel.setup((x) => x.warn(It.isAny())).callback((...msg) => {
        //     console.warn(...msg);
        // })
    });
    afterEach(() => {
        subject.dispose();
    })
    async function stopProcess(code: number) {
        stopped = true;
        spawned = false;
        sendCode!(code);
        await subject.finish();
    }
    async function failProcess(message: string) {
        stopped = false;
        spawned = false;
        sendError!(new Error(message));
        await subject.finish();
    }
    async function killProcess() {
        stopped = false;
        spawned = false;
        sendCode!(1);
    }
    async function waitProcess() {
        do { await sleep(10); } while (!spawned);
    }
    function assertSpawned(times: Times) {
        mocks.asyncSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()), times);
    }
    describe("start()", () => {
        it("starts the autoproj watch process", async () => {
            subject.start();
            await waitProcess();
            await stopProcess(0);
            assertSpawned(Times.once());
        });
        it("does not start an already running process", async () => {
            subject.start();
            subject.start();
            await waitProcess();
            subject.start();
            await stopProcess(0);
            assertSpawned(Times.once());
        });
        it("restarts up to 2 times", async () => {
            subject.start();
            await waitProcess();
            await killProcess();
            await waitProcess();
            await killProcess();
            await waitProcess();
            await killProcess();
            await subject.finish();
            assertSpawned(Times.exactly(3));
        });
        it("shows an error if process cannot be started", async () => {
            subject.start();
            await waitProcess();
            await failProcess("Permission denied");
            await subject.finish();
            mocks.showErrorMessage.verify((x) => x(It.isAny()), Times.once());
            assertSpawned(Times.once());
        });
        it("removes pid file if its stale", async () => {
            builder.fs.registerFile(subject.pidFile);
            await fs.writeFile(subject.pidFile, "31337");
            const mockKill = GlobalMock.ofInstance(process.kill, "kill", process);
            mockKill.setup((x) => x(31337, 0)).throws(new Error("No such process"));
            await using(mockKill).do(async () => {
                subject.start();
                await waitProcess();
                await stopProcess(0);
                await subject.finish();
            });
            assert(!await fs.exists(subject.pidFile));
            assertSpawned(Times.once());
        });
        it("waits if autoproj watch is already running", async () => {
            builder.fs.registerFile(subject.pidFile);
            await fs.writeFile(subject.pidFile, "31337");
            const mockKill = GlobalMock.ofInstance(process.kill, "kill", process);
            mockKill.setup((x) => x(31337, 0)).returns(() => true);
            await using(mockKill).do(async () => {
                subject.start();
                await sleep(100);
                assert(await fs.exists(subject.pidFile));
                assertSpawned(Times.never());
                await fs.unlink(subject.pidFile);
            });
        });
        it("starts as soon as a previous autoproj watch process ends", async () => {
            builder.fs.registerFile(subject.pidFile);
            await fs.writeFile(subject.pidFile, "31337");
            const mockKill = GlobalMock.ofInstance(process.kill, "kill", process);
            mockKill.setup((x) => x(31337, 0)).returns(() => true);
            await using(mockKill).do(async () => {
                subject.start();
                await sleep(100);
                assert(await fs.exists(subject.pidFile));
                assertSpawned(Times.never());
                await fs.unlink(subject.pidFile);
                await waitProcess();
            });
            assertSpawned(Times.once());
        });
    });
    describe("stop()", () => {
        it("stops a running autoproj watch process", async () => {
            subject.start();
            await waitProcess();
            stopped = true;
            mockChild.setup((x) => x.kill()).callback(() => sendCode!(0));
            await subject.stop();
            mockChild.verify((x) => x.kill(), Times.once());
        });
        it("does nothing if a process is not running", async () => {
            await subject.stop();
            mockChild.verify((x) => x.kill(), Times.never());
        });
    });
    describe("dispose()", () => {
        it("disposes of the internal file watcher", () => {
            const mockFileWatcher = GlobalMock.ofType<fileWatcher.FileWatcher>(fileWatcher.FileWatcher, fileWatcher);
            GlobalScope.using(mockFileWatcher).with(() => {
                subject.dispose();
                subject = new WatchProcess(workspace, mocks.logOutputChannel.object);
                subject.dispose();
            });
            mockFileWatcher.verify((x) => x.dispose(), Times.once());
        });
    });
    describe("readPid()", () => {
        it("throws if pid file is invalid", async () => {
            builder.fs.registerFile(subject.pidFile);
            await fs.writeFile(subject.pidFile, "foobar");
            await assert.rejects(subject.readPid(), /Invalid autoproj watch PID file/);
            await fs.unlink(subject.pidFile);
        });
    });
});