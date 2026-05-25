"use strict";
import assert = require("assert");
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { GlobalMock, IGlobalMock, It, Mock } from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as coverage from "../src/coverage";
import * as TMA from "../src/testMateApi";
import { host, WorkspaceBuilder } from "./helpers";
import { using } from "./using";

const RESOURCES_DIR = path.resolve(__dirname, "..", "..", "test", "resources");

function createTestRun(token?: vscode.CancellationToken) {
    const coverages: vscode.FileCoverage[] = [];
    const disposeEmitter = new vscode.EventEmitter<void>();
    const tokenSource = new vscode.CancellationTokenSource();
    const testRun: TMA.TestMateTestRun = {
        token: token || tokenSource.token,
        addCoverage(c) { coverages.push(c); },
        appendOutput() { /* noop */ },
        onDidDispose: disposeEmitter.event,
    };
    return { testRun, tokenSource, coverages, disposeEmitter };
}

function gzipJson(obj: any): Uint8Array {
    return new Uint8Array(zlib.gzipSync(JSON.stringify(obj)));
}

interface ILogSpec {
    log: vscode.LogOutputChannel;
    errors: any[][];
    warnings: any[][];
    debugs: any[][];
    infos: any[][];
}

function quietLog(): ILogSpec {
    const errors: any[][] = [];
    const warnings: any[][] = [];
    const debugs: any[][] = [];
    const infos: any[][] = [];
    const log = {
        name: "test.gcov",
        debug: (...args: any[]) => { debugs.push(args); },
        info: (...args: any[]) => { infos.push(args); },
        warn: (...args: any[]) => { warnings.push(args); },
        error: (...args: any[]) => { errors.push(args); }
    } as unknown as vscode.LogOutputChannel;
    return { log, errors, warnings, debugs, infos };
}

describe("Coverage", () => {
    let builder: WorkspaceBuilder;
    let workspaces: autoproj.Workspaces;
    let pkg: autoproj.IPackage;

    beforeEach(() => {
        builder = new WorkspaceBuilder();
        workspaces = new autoproj.Workspaces();
        workspaces.add(builder.workspace);
        pkg = builder.addPackage("foo");
        workspaces.addFolder(pkg.srcdir);
    });

    describe("execute()", () => {
        let tokenSource: vscode.CancellationTokenSource;

        beforeEach(() => {
            tokenSource = new vscode.CancellationTokenSource();
        });

        it("resolves with stdout/stderr when the process exits with code 0", async () => {
            const [stdout, stderr] = await coverage.execute(
                "/bin/sh", ["-c", "printf out; printf err >&2"], "/tmp", tokenSource.token,
            );
            assert.strictEqual(stdout, "out");
            assert.strictEqual(stderr, "err");
        });

        it("rejects when the process exits with a non-zero code", async () => {
            const promise = coverage.execute(
                "/bin/sh", ["-c", "printf boom >&2; exit 2"], "/tmp", tokenSource.token,
            );
            await assert.rejects(promise, /failed with exit code: 2; boom/);
        });

        it("rejects when the process emits an error", async () => {
            const promise = coverage.execute(
                "/nonexistent/binary-that-does-not-exist", [], "/tmp", tokenSource.token,
            );
            await assert.rejects(promise, /ENOENT/);
        });

        it("rejects and kills the process when cancelled", async () => {
            const promise = coverage.execute(
                "/bin/sh", ["-c", "sleep infinity"], undefined, tokenSource.token,
            );
            setImmediate(() => tokenSource.cancel());
            await assert.rejects(promise, /Cancelled by user/);
        });
    });

    describe("TestMateAdapter", () => {
        let logSpec: ReturnType<typeof quietLog>;
        let adapter: coverage.TestMateAdapter;

        beforeEach(() => {
            logSpec = quietLog();
            adapter = new coverage.TestMateAdapter(logSpec.log, workspaces);
        });

        it("exposes the autoproj gcov label and Coverage kind", () => {
            assert.strictEqual(adapter.label, coverage.AUTOPROJ_GCOV_ADAPTER_LABEL);
            assert.strictEqual(adapter.kind, vscode.TestRunProfileKind.Coverage);
            assert.strictEqual(adapter.tag, undefined);
        });

        it("has a no-op dispose", () => {
            assert.doesNotThrow(() => adapter.dispose());
        });

        it("creates a TestRun handler", () => {
            const { testRun } = createTestRun();
            const wsFolder = { uri: vscode.Uri.file(builder.root), name: "ws", index: 0 };
            const handler = adapter.createTestRunHandler(testRun, wsFolder);
            assert.ok(handler);
            assert.strictEqual(handler.allowExecutableConcurrentInvocations, false);
        });

        describe("loadDetailedCoverage()", () => {
            it("throws when given a non-GcovFileCoverage instance", async () => {
                const { testRun, tokenSource } = createTestRun();
                const other = new vscode.FileCoverage(
                    vscode.Uri.file("/x"),
                    new vscode.TestCoverageCount(0, 0),
                    new vscode.TestCoverageCount(0, 0),
                    new vscode.TestCoverageCount(0, 0),
                );
                await assert.rejects(
                    adapter.loadDetailedCoverage!(testRun, other, tokenSource.token),
                    /expected FileCoverage/,
                );
            });
        });
    });

    describe("register()", () => {
        let getExtension: IGlobalMock<typeof vscode.extensions.getExtension>;
        let logSpec: ReturnType<typeof quietLog>;

        beforeEach(() => {
            getExtension = GlobalMock.ofInstance(
                vscode.extensions.getExtension, "getExtension", vscode.extensions);
            using(getExtension);
            logSpec = quietLog();
        });

        it("creates a TestMate adapter and profile when the extension is available", async () => {
            const subs: vscode.Disposable[] = [];
            const profile = Mock.ofType<TMA.TestMateTestRunProfile>();
            profile.setup((x: any) => x.then).returns(() => undefined);
            const testMate: TMA.TestMateAPI = {
                createTestRunProfile: (a) => {
                    assert.strictEqual(a.label, coverage.AUTOPROJ_GCOV_ADAPTER_LABEL);
                    return profile.object;
                }
            };
            const extension: any = {
                isActive: false,
                activate: async () => testMate,
            };
            getExtension.setup((x) => x(It.isAnyString())).returns(() => extension);

            await coverage.register(logSpec.log, subs, workspaces);
            assert.strictEqual(subs.length, 2);
        });

        it("does nothing when the testMate extension is missing", async () => {
            const subs: vscode.Disposable[] = [];
            getExtension.setup((x) => x(It.isAnyString())).returns(() => undefined);

            await coverage.register(logSpec.log, subs, workspaces);
            assert.strictEqual(subs.length, 0);
            assert.ok(logSpec.errors.length > 0);
        });
    });

    describe("GcovTestMateTestRunHandler", () => {
        let executeMock: IGlobalMock<typeof coverage.execute>;
        let logSpec: ReturnType<typeof quietLog>;
        let adapter: coverage.TestMateAdapter;
        let handler: TMA.TestMateTestRunHandler;
        let testRun: TMA.TestMateTestRun;
        let tokenSource: vscode.CancellationTokenSource;
        let coverages: vscode.FileCoverage[];
        let builder1Cmd: string;
        let progress: vscode.Progress<{ message?: string; increment?: number }>;
        let progressReports: any[];

        function makeBuilder(cmd: string, cwd?: string): TMA.TestMateProcessBuilder {
            return { cmd, cwd: cwd || pkg.srcdir, args: [], env: {} };
        }

        function setExecuteToWriteFixture(fixture: string | { write: (cwd: string) => Promise<void> }) {
            executeMock
                .setup((x) => x(It.isAnyString(), It.isAny(), It.isAnyString(), It.isAny()))
                .returns(async (_cmd, _args, cwd) => {
                    if (typeof fixture === "string") {
                        const dest = path.join(cwd!, `out_${path.basename(fixture)}`);
                        await fs.copyFile(path.join(RESOURCES_DIR, fixture), dest);
                    } else {
                        await fixture.write(cwd!);
                    }
                    return ["", ""];
                });
        }

        beforeEach(async () => {
            executeMock = GlobalMock.ofInstance(coverage.execute, "execute", coverage);
            using(executeMock);

            logSpec = quietLog();
            adapter = new coverage.TestMateAdapter(logSpec.log, workspaces);
            const tr = createTestRun();
            testRun = tr.testRun;
            tokenSource = tr.tokenSource;
            coverages = tr.coverages;

            const wsFolder = { uri: vscode.Uri.file(builder.root), name: "ws", index: 0 };
            handler = adapter.createTestRunHandler(testRun, wsFolder);

            builder1Cmd = path.join(pkg.builddir, "test", "test_suite");

            progressReports = [];
            progress = {
                report: (v) => { progressReports.push(v); },
            };

            await host.addFolders(builder.root);
        });

        describe("init() / dispose data", () => {
            it("creates a temporary directory", async () => {
                await handler.init!(progress);
                const tmpDir = (handler as any).data.tmpDir;
                assert.ok(fsSync.existsSync(tmpDir.path));
                builder.fs.registerDir(tmpDir.path);
                await (handler as any).data.dispose();
                assert.ok(!fsSync.existsSync(tmpDir.path));
            });
        });

        describe("beginProcess()", () => {
            it("captures the builder", async () => {
                const b = makeBuilder(builder1Cmd);
                await handler.beginProcess!(b);
                assert.strictEqual((handler as any).builder, b);
            });
        });

        describe("getPackage() / getGcdaPath()", () => {
            it("throws when no process has started", async () => {
                await assert.rejects((handler as any).getPackage(), /Process has not started/);
            });

            it("throws when no package matches the executable path", async () => {
                await handler.beginProcess!(makeBuilder("/no/such/dir/exe"));
                await assert.rejects((handler as any).getPackage(), /No package found/);
            });

            it("getGcdaPath returns [] and logs when no package matches", async () => {
                await handler.beginProcess!(makeBuilder("/no/such/dir/exe"));
                const files = await (handler as any).getGcdaPath();
                assert.deepStrictEqual(files, []);
                assert.ok(logSpec.errors.length > 0);
            });

            it("getGcdaPath returns the .gcda files inside builddir", async () => {
                await handler.beginProcess!(makeBuilder(builder1Cmd));
                const gcdaPath = builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                const files = await (handler as any).getGcdaPath();
                const paths = files.map((f: vscode.Uri) => f.fsPath);
                assert.ok(paths.includes(gcdaPath));
            });
        });

        describe("cleanupGcda()", () => {
            it("unlinks all .gcda files", async () => {
                await handler.beginProcess!(makeBuilder(builder1Cmd));
                const gcdaPath = builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                await (handler as any).cleanupGcda();
                assert.ok(!fsSync.existsSync(gcdaPath));
            });

            it("logs but does not throw when unlink fails", async () => {
                await handler.beginProcess!(makeBuilder(builder1Cmd));
                const missing = path.join(pkg.builddir, "ghost.gcda");
                // synthesize a Uri pointing to a non-existent .gcda
                const origGet = (handler as any).getGcdaPath.bind(handler);
                (handler as any).getGcdaPath = async () => [vscode.Uri.file(missing)];
                await (handler as any).cleanupGcda();
                (handler as any).getGcdaPath = origGet;
                assert.ok(logSpec.errors.length > 0);
            });
        });

        describe("finalise()", () => {
            it("throws an assertion when called before init", async () => {
                await assert.rejects(handler.finalise!(progress) as Promise<void>, /assert:data/);
            });

            it("skips work and disposes when already cancelled", async () => {
                await handler.beginProcess!(makeBuilder(builder1Cmd));
                await handler.init!(progress);
                const tmpDirPath = (handler as any).data.tmpDir.path;
                tokenSource.cancel();
                await handler.finalise!(progress);
                assert.ok(!fsSync.existsSync(tmpDirPath));
            });

            it("logs and still disposes when finaliseInner throws", async () => {
                await handler.beginProcess!(makeBuilder(builder1Cmd));
                await handler.init!(progress);
                const tmpDirPath = (handler as any).data.tmpDir.path;
                const origInner = (handler as any).finaliseInner.bind(handler);
                (handler as any).finaliseInner = async () => { throw new Error("kaboom"); };
                await handler.finalise!(progress);
                (handler as any).finaliseInner = origInner;
                assert.ok(logSpec.errors.some(e => /gcov.finalise/.test(String(e[0]))));
                assert.ok(!fsSync.existsSync(tmpDirPath));
            });

            it("disposes the tmp dir on a successful finalise", async () => {
                await handler.beginProcess!(makeBuilder(builder1Cmd));
                await handler.init!(progress);
                const tmpDirPath = (handler as any).data.tmpDir.path;
                // No .gcda files: finaliseInner returns early (warn) without throwing.
                await handler.finalise!(progress);
                assert.ok(!fsSync.existsSync(tmpDirPath));
            });
        });

        describe("finaliseInner()", () => {
            beforeEach(async () => {
                await handler.beginProcess!(makeBuilder(builder1Cmd));
                await handler.init!(progress);
            });

            it("throws when called before init data exists", async () => {
                const fresh = adapter.createTestRunHandler(testRun, { uri: vscode.Uri.file(builder.root), name: "ws", index: 0 });
                await assert.rejects((fresh as any).finaliseInner(progress), /assert:data/);
            });

            it("warns and returns when no .gcda files are present", async () => {
                await (handler as any).finaliseInner(progress);
                assert.ok(logSpec.warnings.length > 0);
                assert.strictEqual(coverages.length, 0);
            });

            it("logs but continues when gcov execute() rejects", async () => {
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                executeMock
                    .setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
                    .returns(() => Promise.reject(new Error("gcov-fail")));
                await (handler as any).finaliseInner(progress);
                assert.ok(logSpec.errors.some(e => /Failed to execute gcov/.test(String(e[0]))));
                assert.strictEqual(coverages.length, 0);
            });

            it("logs when decompression fails", async () => {
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                setExecuteToWriteFixture("notgz.gcov.json.gz");
                await (handler as any).finaliseInner(progress);
                assert.ok(logSpec.errors.some(e => /Failed to decompress/.test(String(e[0]))));
                assert.strictEqual(coverages.length, 0);
            });

            it("logs when JSON parse fails", async () => {
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                setExecuteToWriteFixture("badjson.gcov.json.gz");
                await (handler as any).finaliseInner(progress);
                assert.ok(logSpec.errors.some(e => /Failed to parse JSON/.test(String(e[0]))));
                assert.strictEqual(coverages.length, 0);
            });

            it("skips JSON payloads without a files array", async () => {
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                setExecuteToWriteFixture("nofiles.gcov.json.gz");
                await (handler as any).finaliseInner(progress);
                assert.strictEqual(coverages.length, 0);
            });

            it("aggregates coverage and applies inclusion / exclusion filters", async () => {
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                const inside = path.join(pkg.srcdir, "lib.cpp");
                const insideTest = path.join(pkg.srcdir, "test", "test_lib.cpp");
                const outside = "/outside/file.cpp";
                const payload = {
                    current_working_directory: pkg.srcdir,
                    files: [
                        {
                            file: "lib.cpp",
                            lines: [
                                { line_number: 10, count: 5, branches: [
                                    { count: 3, fallthrough: true, throw: false },
                                    { count: 0, fallthrough: false, throw: true },
                                ] },
                                { line_number: 11, count: 0 },
                                { line_number: "bogus", count: 1 } as any,
                                { line_number: 12, count: "bogus" } as any,
                                { line_number: 13, count: 1, branches: [{ count: "bogus" } as any] },
                            ],
                            functions: [
                                { name: "foo", start_line: 5, end_line: 15, execution_count: 4 },
                                { name: "bar", start_line: 16, start_column: 2, end_line: 20, end_column: 4, execution_count: 0 },
                                { name: "", start_line: 21, end_line: 22, execution_count: 1 },
                                { name: 42, execution_count: 1, start_line: 1, end_line: 1 } as any,
                                { name: "baz", execution_count: "bogus", start_line: 1, end_line: 1 } as any,
                            ],
                        },
                        // re-merge to exercise update paths in mergeLine / mergeFunction
                        {
                            file: "lib.cpp",
                            lines: [
                                { line_number: 10, count: 2, branches: [
                                    { count: 1, fallthrough: true, throw: false },
                                ] },
                                "not-an-object" as any,
                            ],
                            functions: [
                                { name: "foo", start_line: 5, end_line: 15, execution_count: 3 },
                            ],
                        },
                        { file: insideTest, lines: [{ line_number: 1, count: 1 }] },
                        { file: outside, lines: [{ line_number: 1, count: 1 }] },
                        { file: null },
                        { file: "no-arrays.cpp" },
                    ],
                };
                executeMock
                    .setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
                    .returns(async (_cmd, _args, cwd) => {
                        await fs.writeFile(path.join(cwd!, "out.gcov.json.gz"), gzipJson(payload));
                        return ["", ""];
                    });

                await (handler as any).finaliseInner(progress);
                assert.strictEqual(coverages.length, 2);
                const fc = coverages.find((c) => c.uri.fsPath === inside)!;
                assert.ok(fc, "expected coverage for lib.cpp");
                assert.strictEqual(fc.declarationCoverage!.total, 3);
                assert.strictEqual(fc.declarationCoverage!.covered, 2);

                const details = await adapter.loadDetailedCoverage!(testRun, fc, tokenSource.token);
                const statements = details.filter((d) => d instanceof vscode.StatementCoverage);
                const declarations = details.filter((d) => d instanceof vscode.DeclarationCoverage);
                assert.ok(statements.length >= 3);
                assert.strictEqual(declarations.length, 3);

                // Second load returns the cached empty list because aggregatedData was consumed
                const second = await adapter.loadDetailedCoverage!(testRun, fc, tokenSource.token);
                assert.deepStrictEqual(second, []);
            });

            it("uses builder.cwd when current_working_directory is missing", async () => {
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                const payload = {
                    files: [
                        { file: "lib.cpp", lines: [{ line_number: 1, count: 1 }] },
                    ],
                };
                executeMock
                    .setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
                    .returns(async (_cmd, _args, cwd) => {
                        await fs.writeFile(path.join(cwd!, "out.gcov.json.gz"), gzipJson(payload));
                        return ["", ""];
                    });

                await (handler as any).finaliseInner(progress);
                assert.strictEqual(coverages.length, 1);
                assert.strictEqual(coverages[0].uri.fsPath, path.join(pkg.srcdir, "lib.cpp"));
            });

            it("stops after the per-file gcov loop when cancelled", async () => {
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "b.gcda");
                let count = 0;
                executeMock
                    .setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
                    .returns(() => {
                        count++;
                        if (count === 1) tokenSource.cancel();
                        return Promise.resolve(["", ""] as [string, string]);
                    });
                await (handler as any).finaliseInner(progress);
                assert.strictEqual(coverages.length, 0);
                assert.strictEqual(count, 1);
            });

            it("stops before adding coverage when cancelled after parse", async () => {
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                const payload = {
                    current_working_directory: pkg.srcdir,
                    files: [{ file: "lib.cpp", lines: [{ line_number: 1, count: 1 }] }],
                };
                executeMock
                    .setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
                    .returns(async (_cmd, _args, cwd) => {
                        await fs.writeFile(path.join(cwd!, "out.gcov.json.gz"), gzipJson(payload));
                        return ["", ""];
                    });
                // cancel between gcov call and the post-parse barrier
                const origReport = progress.report;
                progress.report = (v) => {
                    if (v.message === "aggregating") tokenSource.cancel();
                    return origReport.call(progress, v);
                };
                await (handler as any).finaliseInner(progress);
                assert.strictEqual(coverages.length, 0);
            });
        });

        describe("loadDetailedCoverage() cancellation & error handling", () => {
            async function buildCoverage(): Promise<vscode.FileCoverage> {
                return buildPayloadCoverage();
            }

            async function buildPayloadCoverage(): Promise<vscode.FileCoverage> {
                await handler.beginProcess!(makeBuilder(builder1Cmd));
                await handler.init!(progress);
                builder.fs.mkfile("", ...builder.packageBuildDir("foo"), "a.gcda");
                const payload = {
                    current_working_directory: pkg.srcdir,
                    files: [{
                        file: "lib.cpp",
                        lines: [
                            { line_number: 1, count: 1, branches: [{ count: 0, fallthrough: false, throw: false }] },
                            { line_number: 2, count: 1 },
                        ],
                        functions: [
                            { name: "f1", start_line: 1, end_line: 2, execution_count: 1 },
                            { name: "f2", start_line: 3, end_line: 4, execution_count: 1 },
                        ],
                    }],
                };
                executeMock
                    .setup((x) => x(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
                    .returns(async (_cmd, _args, cwd) => {
                        await fs.writeFile(path.join(cwd!, "out.gcov.json.gz"), gzipJson(payload));
                        return ["", ""];
                    });
                await (handler as any).finaliseInner(progress);
                assert.ok(coverages.length >= 1);
                return coverages[coverages.length - 1];
            }

            it("returns partial results when cancelled mid-load", async () => {
                const fc = await buildCoverage();
                const ts = new vscode.CancellationTokenSource();
                ts.cancel();
                const details = await adapter.loadDetailedCoverage!(testRun, fc, ts.token);
                assert.deepStrictEqual(details, []);
            });

            it("stops iterating lines when token cancels mid-load", async () => {
                const fc = await buildPayloadCoverage();
                let count = 0;
                const wrapped: vscode.CancellationToken = {
                    get isCancellationRequested() { return ++count > 1; },
                    onCancellationRequested: tokenSource.token.onCancellationRequested,
                };
                const details = await adapter.loadDetailedCoverage!(testRun, fc, wrapped);
                assert.strictEqual(details.length, 1);
            });

            it("stops iterating functions when token cancels mid-load", async () => {
                const fc = await buildPayloadCoverage();
                let count = 0;
                const wrapped: vscode.CancellationToken = {
                    get isCancellationRequested() { return ++count > 2; },
                    onCancellationRequested: tokenSource.token.onCancellationRequested,
                };
                const details = await adapter.loadDetailedCoverage!(testRun, fc, wrapped);
                // 2 lines processed before the third check triggers cancellation in the functions loop.
                assert.strictEqual(details.length, 2);
            });

            it("returns the cached details when both fields are present", async () => {
                const fc = await buildCoverage();
                const sentinel: vscode.FileCoverageDetail[] = [
                    new vscode.StatementCoverage(7, new vscode.Range(0, 0, 0, 1)),
                ];
                (fc as any).data.aggregatedData = (fc as any).data.aggregatedData || { lines: new Map(), functions: new Map() };
                (fc as any).data.details = sentinel;
                const details = await adapter.loadDetailedCoverage!(testRun, fc, tokenSource.token);
                assert.strictEqual(details, sentinel);
            });

            it("logs and returns [] when load() throws", async () => {
                const fc = await buildCoverage();
                // Corrupt the cached aggregated data so iteration throws.
                (fc as any).data.aggregatedData = { get lines() { throw new Error("boom"); }, functions: new Map() };
                const details = await adapter.loadDetailedCoverage!(testRun, fc, tokenSource.token);
                assert.deepStrictEqual(details, []);
                assert.ok(logSpec.errors.length > 0);
            });

            it("logs and returns [] when load throws synchronously outside the inner try", async () => {
                const fc = await buildCoverage();
                // Replace load with a thrower to exercise the outer catch in loadDetailedCoverage
                (fc as any).load = () => { throw new Error("outer-boom"); };
                const details = await adapter.loadDetailedCoverage!(testRun, fc, tokenSource.token);
                assert.deepStrictEqual(details, []);
                assert.ok(logSpec.errors.some((e) => /loadDetailedCoverage/.test(String(e[0]))));
            });
        });
    });
});
