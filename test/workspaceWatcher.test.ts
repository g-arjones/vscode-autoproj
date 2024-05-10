import * as assert from "assert";
import * as child_process from "child_process";
import * as fileWatcher from "../src/fileWatcher";
import { setTimeout as sleep } from "timers/promises";
import { LogOutputChannel } from "vscode";
import { Workspace } from "../src/autoproj";
import { WatchManager, WatchProcess } from "../src/workspaceWatcher";
import * as helpers from "./helpers";
import { VSCode } from "../src/wrappers";
import { GlobalMock, GlobalScope, IGlobalMock, IMock, It, Mock, Times } from "typemoq";
import { UsingResult, using } from "./using";
import { fs } from "../src/cmt/pr";

describe("WatchManager", () => {
    let builder: helpers.WorkspaceBuilder;
    let root: string;
    let workspace: Workspace;
    let mockChannel: IMock<LogOutputChannel>;
    let mockWrapper: IMock<VSCode>;
    let subject: WatchManager;

    beforeEach(() => {
        root = helpers.init();
        builder = new helpers.WorkspaceBuilder(root);
        mockChannel = Mock.ofType<LogOutputChannel>();
        mockWrapper = Mock.ofType<VSCode>();
        workspace = new Workspace(root);
        subject = new WatchManager(mockChannel.object, mockWrapper.object);
    });
    afterEach(() => {
        helpers.clear();
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
    interface Readable {
        on: (event: string, listener: (chunk: any) => void) => Readable
    }

    let builder: helpers.WorkspaceBuilder;
    let root: string;
    let workspace: Workspace;
    let mockChannel: IMock<LogOutputChannel>;
    let mockWrapper: IMock<VSCode>;
    let mockSpawn: IGlobalMock<typeof child_process.spawn>;
    let mockChild: IMock<child_process.ChildProcessWithoutNullStreams>;
    let mockStdout: IMock<Readable>;
    let mockStderr: IMock<Readable>;
    let usingResult: UsingResult;
    let subject: WatchProcess;
    let stopped: boolean;
    let sendError: ((error: Error) => void) | undefined;
    let sendCode: ((code: number) => void) | undefined;
    beforeEach(() => {
        root = helpers.init();
        builder = new helpers.WorkspaceBuilder(root);
        workspace = new Workspace(root);
        mockChannel = Mock.ofType<LogOutputChannel>();
        mockWrapper = Mock.ofType<VSCode>();
        mockSpawn = GlobalMock.ofInstance(child_process.spawn, "spawn", child_process);
        mockChild = Mock.ofType<child_process.ChildProcessWithoutNullStreams>();
        mockStdout = Mock.ofType<Readable>();
        mockStderr = Mock.ofType<Readable>();
        usingResult = using(mockSpawn);
        usingResult.commit();

        stopped = false;
        subject = new WatchProcess(workspace, mockChannel.object, mockWrapper.object);
        mockSpawn.setup((x) => x(It.isAny(), It.isAny(), It.isAny())).returns(() => mockChild.object);
        mockChild.setup((x) => x.stderr).returns(() => mockStderr.object as any);
        mockChild.setup((x) => x.stdout).returns(() => mockStdout.object as any);
        mockChild.setup((x) => x.stdout).returns(() => mockStdout.object as any);
        mockChild.setup((x) => x.killed).returns(() => stopped);
        mockChild.setup((x) => x.on("error", It.isAny())).callback((event, listener) => {
            sendError = listener;
        });
        mockChild.setup((x) => x.on("exit", It.isAny())).callback((event, listener) => {
            sendCode = listener;
        });

        WatchProcess.RESTART_RETRIES = 1
        WatchProcess.RESTART_PROCESS_TIMEOUT_SEC = 0.001;
        WatchProcess.STALE_PID_FILE_TIMEOUT_SEC = 0.001;

        // uncomment to debug
        // mockChannel.setup((x) => x.info(It.isAny())).callback((...msg) => {
        //     console.log(...msg);
        // })
        // mockChannel.setup((x) => x.error(It.isAny())).callback((...msg) => {
        //     console.error(...msg);
        // })
        // mockChannel.setup((x) => x.warn(It.isAny())).callback((...msg) => {
        //     console.warn(...msg);
        // })
    });
    afterEach(() => {
        helpers.clear();
        usingResult.rollback();
        subject.dispose();
    })
    async function stopProcess(code: number) {
        stopped = true;
        const send = sendCode!
        sendCode = undefined;
        sendError = undefined;
        send(code);
        await subject.finish();
    }
    async function failProcess(message: string) {
        stopped = false;
        const send = sendError!
        sendCode = undefined;
        sendError = undefined;
        send(new Error(message));
        await subject.finish();
    }
    async function killProcess() {
        stopped = false;
        const send = sendCode!
        sendCode = undefined;
        sendError = undefined;
        send(1);
        await sleep(10);
    }
    async function waitProcess() {
        do { await sleep(1); } while (!sendCode || !sendError);
    }
    describe("start()", () => {
        it("starts the autoproj watch process", async () => {
            subject.start();
            await waitProcess();
            await stopProcess(0);
            mockSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.once());
        });
        it("does not start an already running process", async () => {
            subject.start();
            subject.start();
            await waitProcess();
            subject.start();
            await stopProcess(0);
            mockSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.once());
        });
        it("restarts up to 1 time", async () => {
            subject.start();
            await waitProcess();
            await killProcess();
            await waitProcess();
            await killProcess();
            await subject.finish();
            mockSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.exactly(2));
        });
        it("shows an error if process cannot be started", async () => {
            subject.start();
            await waitProcess();
            await failProcess("Permission denied");
            await subject.finish();
            mockWrapper.verify((x) => x.showErrorMessage(It.isAny()), Times.once());
            mockSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.once());
        });
        it("removes pid file if its stale", async () => {
            helpers.registerFile(subject.pidFile);
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
            mockSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.once());
        });
        it("waits if autoproj watch is already running", async () => {
            helpers.registerFile(subject.pidFile);
            await fs.writeFile(subject.pidFile, "31337");
            const mockKill = GlobalMock.ofInstance(process.kill, "kill", process);
            mockKill.setup((x) => x(31337, 0)).returns(() => true);
            await using(mockKill).do(async () => {
                subject.start();
                await sleep(100);
                assert(await fs.exists(subject.pidFile));
                mockSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.never());
                await fs.unlink(subject.pidFile);
            });
        });
        it("starts as soon as a previous autoproj watch process ends", async () => {
            helpers.registerFile(subject.pidFile);
            await fs.writeFile(subject.pidFile, "31337");
            const mockKill = GlobalMock.ofInstance(process.kill, "kill", process);
            mockKill.setup((x) => x(31337, 0)).returns(() => true);
            await using(mockKill).do(async () => {
                subject.start();
                await sleep(100);
                assert(await fs.exists(subject.pidFile));
                mockSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.never());
                await fs.unlink(subject.pidFile);
                await waitProcess();
            });
            mockSpawn.verify((x) => x(It.isAny(), It.isAny(), It.isAny()), Times.once());
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
        it("does nothing if a process is not runningg", async () => {
            await subject.stop();
            mockChild.verify((x) => x.kill(), Times.never());
        });
    });
    describe("dispose()", () => {
        it("disposes of the internal file watcher", () => {
            const mockFileWatcher = GlobalMock.ofType<fileWatcher.FileWatcher>(fileWatcher.FileWatcher, fileWatcher);
            GlobalScope.using(mockFileWatcher).with(() => {
                subject.dispose();
                subject = new WatchProcess(workspace, mockChannel.object, mockWrapper.object);
                subject.dispose();
            });
            mockFileWatcher.verify((x) => x.dispose(), Times.once());
        });
    });
    describe("readPid()", () => {
        it("throws if pid file is invalid", async () => {
            helpers.registerFile(subject.pidFile);
            await fs.writeFile(subject.pidFile, "foobar");
            await assert.rejects(subject.readPid(), /Invalid autoproj watch PID file/);
            await fs.unlink(subject.pidFile);
        });
    });
});