import * as autoproj from './autoproj'
import * as util from './util'
import * as vscode from 'vscode';
import * as TMA from './testMateApi';
import * as fs from 'fs/promises';
import * as pathlib from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import * as cp from 'child_process';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);
export const AUTOPROJ_GCOV_ADAPTER_LABEL = 'Autoproj (gcov)';

export const execute = async (
    cmd: string,
    args: string[],
    cwd: string | undefined,
    token: vscode.CancellationToken,
): Promise<[string, string]> => {
    const proc = cp.spawn(cmd, args, { stdio: 'pipe', cwd });
    const stdout: string[] = [];
    const stderr: string[] = [];

    proc.stdout.on('data', o => stdout.push(o.toString('utf8')));
    proc.stderr.on('data', o => stderr.push(o.toString('utf8')));

    const closeP = new Promise<void>((res, rej) => {
        proc.on('close', (code: number) => {
            if (code === 0) res();
            else rej(new Error(`Command '${cmd}' failed with exit code: ${code}; ${stderr.join('')}`));
        });
        proc.on('error', err => rej(err));

        token.onCancellationRequested(() => {
            proc.kill();
            rej(new Error('Cancelled by user'));
        });
    });

    await closeP;
    return [stdout.join(''), stderr.join('')];
};


interface GcovBranch {
    count: number;
    throw: boolean;
    fallthrough: boolean;
}

interface GcovLine {
    line_number: number;
    count: number;
    branches?: GcovBranch[];
}

interface GcovFunction {
    name: string;
    start_line: number;
    start_column?: number;
    end_line: number;
    end_column?: number;
    execution_count: number;
}

class AggregatedFileCoverage {
    lines = new Map<number, GcovLine>();
    functions = new Map<string, GcovFunction>();

    mergeLine(l: GcovLine) {
        if (typeof l.line_number !== 'number' || typeof l.count !== 'number') return;

        if (!this.lines.has(l.line_number)) {
            this.lines.set(l.line_number, { line_number: l.line_number, count: 0, branches: [] });
        }
        const target = this.lines.get(l.line_number)!;
        target.count += l.count;

        if (Array.isArray(l.branches)) {
            target.branches = target.branches || [];
            for (let i = 0; i < l.branches.length; i++) {
                const branch = l.branches[i];
                if (typeof branch.count !== 'number') continue;

                if (!target.branches[i]) {
                    target.branches[i] = { count: 0, fallthrough: !!branch.fallthrough, throw: !!branch.throw };
                }
                target.branches[i].count += branch.count;
            }
        }
    }

    mergeFunction(f: GcovFunction) {
        if (typeof f.name !== 'string' || typeof f.execution_count !== 'number') return;

        if (!this.functions.has(f.name)) {
            this.functions.set(f.name, { ...f, execution_count: 0 });
        }
        this.functions.get(f.name)!.execution_count += f.execution_count;
    }
}

class GcovFileCoverage extends vscode.FileCoverage {
    constructor(
        uri: vscode.Uri,
        statementCoverage: vscode.TestCoverageCount,
        branchCoverage: vscode.TestCoverageCount,
        declarationCoverage: vscode.TestCoverageCount,
        private readonly log: vscode.LogOutputChannel,
        aggregatedData: AggregatedFileCoverage,
    ) {
        super(uri, statementCoverage, branchCoverage, declarationCoverage);
        this.data.aggregatedData = aggregatedData;
    }

    private readonly data: { aggregatedData?: AggregatedFileCoverage; details?: vscode.FileCoverageDetail[] } = {};

    async load(token: vscode.CancellationToken): Promise<vscode.FileCoverageDetail[]> {
        if (!this.data.aggregatedData) return [];
        if (this.data.details) return this.data.details;

        const details: vscode.FileCoverageDetail[] = [];
        try {
            const { lines, functions } = this.data.aggregatedData;

            for (const line of lines.values()) {
                if (token.isCancellationRequested) return details;

                const lineIdx = Math.max(0, line.line_number - 1);
                const range = new vscode.Range(lineIdx, 0, lineIdx, 1);

                const branchCovs: vscode.BranchCoverage[] = [];
                if (line.branches) {
                    for (const b of line.branches) {
                        branchCovs.push(new vscode.BranchCoverage(b.count, range));
                    }
                }

                details.push(new vscode.StatementCoverage(line.count, range, branchCovs.length > 0 ? branchCovs : undefined));
            }

            for (const func of functions.values()) {
                if (token.isCancellationRequested) return details;

                const startLine = Math.max(0, func.start_line - 1);
                const startCol = Math.max(0, (func.start_column || 1) - 1);
                const endLine = Math.max(0, func.end_line - 1);
                const endCol = Math.max(0, (func.end_column || 1) - 1);

                const range = new vscode.Range(startLine, startCol, endLine, endCol);
                details.push(new vscode.DeclarationCoverage(func.name || '<unknown>', func.execution_count, range));
            }

            this.data.details = details;
            delete this.data.aggregatedData;
        } catch (e) {
            this.log.error('Error loading detailed coverage in gcov.ts:', e, this.data);
        }
        return details;
    }
}

class GcovTestMateTestRunHandler implements TMA.TestMateTestRunHandler {
    constructor(
        private readonly testRun: TMA.TestMateTestRun,
        private readonly log: vscode.LogOutputChannel,
        private readonly workspaces: autoproj.Workspaces,
    ) { }

    readonly allowExecutableConcurrentInvocations = false;
    builder?: TMA.TestMateProcessBuilder;

    private data:
        | {
            tmpDir: {
                path: string;
                remove(): Promise<void>;
            };
            dispose: () => void;
        }
        | undefined = undefined;

    async getPackage(): Promise<autoproj.IPackage> {
        const executable = this.builder?.cmd;
        if (!executable) {
            throw new Error('Process has not started');
        }
        const r = await this.workspaces.getPackageByBuildPath(executable);
        if (!r) {
            throw new Error(`No package found for executable path ${executable}`);
        }
        return r.package;
    }

    async getGcdaPath() {
        let pkg: autoproj.IPackage;
        try {
            pkg = await this.getPackage();
        } catch (e) {
            this.log.error(`Cannot find .gcda files: ${e}`);
            return [];
        }

        this.log.debug('Looking for .gcda files in package builddir', pkg.builddir);
        return await vscode.workspace.findFiles(
            new vscode.RelativePattern(pkg.builddir, '**/*.gcda'),
            '**/{node_modules,_deps}/**',
        );
    }

    async cleanupGcda() {
        const gcdaFiles = await this.getGcdaPath();
        await Promise.all(gcdaFiles.map(f => fs.unlink(f.fsPath).catch(e => this.log.error('unlink', e, f.fsPath))));
    }

    async init(): Promise<void> {
        let path: string
        path = await fs.mkdtemp(pathlib.join(os.tmpdir(), 'gcov-'));
        this.data = {
            tmpDir: {
                path,
                remove: async () => fs.rm(path, { recursive: true, force: true }),
            },
            async dispose() {
                await this.tmpDir.remove();
            },
        };
        this.log.debug('tmpDir', this.data.tmpDir.path);
    }

    async beginProcess(builder: TMA.TestMateProcessBuilder): Promise<void> {
        this.builder = builder
    }

    async finalise(progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        if (!this.data) throw new Error('assert:data');
        try {
            if (!this.testRun.token.isCancellationRequested) {
                await this.finaliseInner(progress);
            }
        } catch (e) {
            this.log.error('gcov.finalise:', e);
        } finally {
            await this.data.dispose();
            await this.cleanupGcda();
        }
    }

    async finaliseInner(progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        if (!this.data) throw new Error('assert:data');

        const gcdaFiles = await this.getGcdaPath();

        if (gcdaFiles.length === 0) {
            this.log.warn('No .gcda files found. Ensure code is compiled with --coverage and executed successfully.');
            return;
        }

        progress.report({ message: 'gcov' });
        const fileCoverageMap = new Map<string, AggregatedFileCoverage>();

        // Sequential process execution prevents OS EMFILE limits
        for (const file of gcdaFiles) {
            if (this.testRun.token.isCancellationRequested) return;

            try {
                await execute(
                    'gcov',
                    [
                        '--preserve-paths', //to resolve filename collisions
                        '--json-format',
                        file.fsPath,
                    ],
                    this.data.tmpDir.path,
                    this.testRun.token,
                );
            } catch (e) {
                this.log.error(`Failed to execute gcov on ${file.fsPath}`, e);
            }
        }

        const gcovOutputFiles = await fs.readdir(this.data.tmpDir.path);
        const jsonGzFiles = gcovOutputFiles.filter(f => f.endsWith('.gcov.json.gz'));

        progress.report({ message: 'aggregating' });

        // Execute decompression and parsing concurrently mapping over all generated files
        const parsePromises = jsonGzFiles.map(async gzFile => {
            if (this.testRun.token.isCancellationRequested) return;
            const filePath = pathlib.join(this.data!.tmpDir.path, gzFile);

            let jsonStr: string;
            try {
                const buffer = (await fs.readFile(filePath));
                jsonStr = (await gunzip(new Uint8Array(buffer))).toString('utf8');
            } catch (e) {
                this.log.error(`Failed to decompress ${gzFile}`, e);
                return;
            }

            let coverageJson;
            try {
                coverageJson = JSON.parse(jsonStr);
            } catch (e) {
                this.log.error(`Failed to parse JSON from ${gzFile}`, e);
                return;
            }

            if (!Array.isArray(coverageJson['files'])) return;

            const cwd = coverageJson['current_working_directory'] || this.builder!.cwd

            for (const sourceFile of coverageJson['files']) {
                const rawFilePath = sourceFile['file'];
                if (!rawFilePath || typeof rawFilePath !== 'string') continue;

                const absoluteFilePath = pathlib.isAbsolute(rawFilePath) ? rawFilePath : pathlib.resolve(cwd, rawFilePath);
                const pkg = await this.getPackage();
                if (!absoluteFilePath.startsWith(pkg.srcdir)) {
                    continue;
                }

                const testDirs = [`${pkg.srcdir}/test`, `${pkg.srcdir}/tests`];
                if (testDirs.some(testDir => util.isSubdirOf(absoluteFilePath, testDir))) {
                    continue;
                }

                if (!fileCoverageMap.has(absoluteFilePath)) {
                    fileCoverageMap.set(absoluteFilePath, new AggregatedFileCoverage());
                }

                const aggregated = fileCoverageMap.get(absoluteFilePath)!;

                if (Array.isArray(sourceFile['lines'])) {
                    for (const line of sourceFile['lines']) {
                        aggregated.mergeLine(line as GcovLine);
                    }
                }

                if (Array.isArray(sourceFile['functions'])) {
                    for (const func of sourceFile['functions']) {
                        aggregated.mergeFunction(func as GcovFunction);
                    }
                }
            }
        });

        await Promise.all(parsePromises);
        if (this.testRun.token.isCancellationRequested) return;

        progress.report({ message: 'reporting' });

        for (const [filePath, aggregated] of fileCoverageMap.entries()) {
            let linesTotal = 0,
                linesCovered = 0;
            let branchesTotal = 0,
                branchesCovered = 0;
            let funcsTotal = 0,
                funcsCovered = 0;

            for (const line of aggregated.lines.values()) {
                linesTotal++;
                if (line.count > 0) linesCovered++;

                if (line.branches) {
                    for (const branch of line.branches) {
                        branchesTotal++;
                        if (branch.count > 0) branchesCovered++;
                    }
                }
            }

            for (const func of aggregated.functions.values()) {
                funcsTotal++;
                if (func.execution_count > 0) funcsCovered++;
            }

            const uri = vscode.Uri.file(filePath);
            const statementCov = new vscode.TestCoverageCount(linesCovered, linesTotal);
            const branchCov = new vscode.TestCoverageCount(branchesCovered, branchesTotal);
            const declCov = new vscode.TestCoverageCount(funcsCovered, funcsTotal);

            this.testRun.addCoverage(new GcovFileCoverage(uri, statementCov, branchCov, declCov, this.log, aggregated));
        }
    }
}

export class TestMateAdapter implements TMA.TestMateTestRunProfileAdapter {
    constructor(private readonly log: vscode.LogOutputChannel, private readonly workspaces: autoproj.Workspaces) { }

    label = AUTOPROJ_GCOV_ADAPTER_LABEL;
    kind = vscode.TestRunProfileKind.Coverage;
    tag?: vscode.TestTag = undefined;

    createTestRunHandler(
        testRun: TMA.TestMateTestRun,
        _workspaceFolder: vscode.WorkspaceFolder,
    ): TMA.TestMateTestRunHandler {
        return new GcovTestMateTestRunHandler(testRun, this.log, this.workspaces);
    }

    async loadDetailedCoverage(
        _testRun: TMA.TestMateTestRun,
        fileCoverage: vscode.FileCoverage,
        token: vscode.CancellationToken,
    ): Promise<vscode.FileCoverageDetail[]> {
        if (fileCoverage instanceof GcovFileCoverage) {
            try {
                return await fileCoverage.load(token);
            } catch (e) {
                this.log.error('loadDetailedCoverage', e, fileCoverage.uri);
                return [];
            }
        } else throw Error('expected FileCoverage');
    }

    dispose(): void { }
}

export async function register(
    outputChannel: vscode.LogOutputChannel,
    subscriptions: vscode.Disposable[],
    workspaces: autoproj.Workspaces
) {
    const testMateExtensionId = 'matepek.vscode-catch2-test-adapter';
    const log = util.getLogger(outputChannel, 'gcov');
    const testMateExtension = vscode.extensions.getExtension<TMA.TestMateAPI>(testMateExtensionId);

    if (testMateExtension) {
        const testMate = await testMateExtension.activate();
        log.info(`Activated TestMate extension ${testMateExtensionId}`);

        const adapter = new TestMateAdapter(log, workspaces);
        const profile = testMate.createTestRunProfile(adapter);
        log.info(`Created TestMate adapter ${adapter.label}, kind: ${adapter.kind}`);

        subscriptions.push(adapter, profile);
    } else {
        log.error(`Could not get TestMate extension ${testMateExtensionId}`);
    }
}