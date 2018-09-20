"use strict";
import * as assert from "assert";
import { basename as pathBasename, join as pathJoin, relative as pathRelative } from "path";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as tasks from "../src/tasks";
import * as wrappers from "../src/wrappers";
import * as helpers from "./helpers";

describe("Task provider", () => {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let subject: tasks.AutoprojProvider;
    let wrapper: TypeMoq.IMock<wrappers.VSCode>;
    let workspaceFolders: vscode.WorkspaceFolder[];

    beforeEach(() => {
        root = helpers.init();
        workspaces = new autoproj.Workspaces();
        wrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        workspaceFolders = [];
        wrapper.setup((x) => x.workspaceFolders).returns(() => workspaceFolders);
    });
    afterEach(() => {
        helpers.clear();
    });

    function addFolder(folderPath: string) {
        const folder: vscode.WorkspaceFolder = {
            index: workspaceFolders.length,
            name: pathBasename(folderPath),
            uri: vscode.Uri.file(folderPath),
        };

        workspaces.addFolder(folderPath);
        workspaceFolders.push(folder);
        wrapper.setup((x) => x.getWorkspaceFolder(folderPath)).returns(() => folder);
    }
    function assertTask(task: vscode.Task, process: string, args: string[],
                        name: string, scope: vscode.TaskScope | vscode.WorkspaceFolder) {
        const actualProcess = (task.execution as vscode.ProcessExecution).process;
        const actualArgs = (task.execution as vscode.ProcessExecution).args;
        assert.deepEqual(scope, task.scope);
        assert.equal(name, task.name);
        assert.equal(actualProcess, process);
        assert.deepEqual(actualArgs, args);
    }
    function autoprojExePath(basePath) {
        const wsRoot = autoproj.findWorkspaceRoot(basePath) as string;
        return autoproj.autoprojExePath(wsRoot);
    }
    function assertWatchTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["watch", "--show-events"];
        const name = `${pathBasename(wsRoot)}: Watch`;
        assertTask(task, process, args, name, workspaceFolders[0]);
        assert.equal(task.isBackground, true);
        assert.deepEqual(task.presentationOptions, { reveal: vscode.TaskRevealKind.Never });
    }
    function assertBuildTask(task: vscode.Task, wsRoot: string, pkgPath?: string, pkgName?: string) {
        const process = autoprojExePath(pkgPath ? pkgPath : wsRoot);
        const args = ["build", "--tool"];
        let scope = workspaceFolders[0];
        let name = `${pathBasename(wsRoot)}: Build`;

        if (pkgPath) {
            args.push(pkgPath);
            name += ` ${pkgName}`;
            scope = wrapper.object.getWorkspaceFolder(pkgPath)!;
        }

        assertTask(task, process, args, name, scope);
    }
    function assertForceBuildTask(task: vscode.Task, wsRoot: string, pkgPath: string, pkgName: string) {
        const process = autoprojExePath(pkgPath);
        const args = ["build", "--tool", "--force", "--deps=f", "--no-confirm", pkgPath];
        const name = `${pathBasename(wsRoot)}: Force Build ${pkgName} (nodeps)`;
        const scope = wrapper.object.getWorkspaceFolder(pkgPath)!;
        assertTask(task, process, args, name, scope);
    }
    function assertNodepsBuildTask(task: vscode.Task, wsRoot: string, pkgPath: string, pkgName: string) {
        const process = autoprojExePath(pkgPath);
        const args = ["build", "--tool", "--deps=f", pkgPath];
        const name = `${pathBasename(wsRoot)}: Build ${pkgName} (nodeps)`;
        const scope = wrapper.object.getWorkspaceFolder(pkgPath)!;
        assertTask(task, process, args, name, scope);
    }
    function assertUpdateTask(task: vscode.Task, wsRoot: string, pkgPath?: string, pkgName?: string) {
        const process = autoprojExePath(pkgPath ? pkgPath : wsRoot);
        const args = ["update", "--progress=f", "-k", "--color"];
        let scope = workspaceFolders[0];
        let name = `${pathBasename(wsRoot)}: Update`;

        if (pkgPath) {
            args.push(pkgPath);
            name += ` ${pkgName}`;
            scope = wrapper.object.getWorkspaceFolder(pkgPath)!;
        }
        assertTask(task, process, args, name, scope);
    }
    function assertCheckoutTask(task: vscode.Task, wsRoot: string, pkgPath?: string, pkgName?: string) {
        const process = autoprojExePath(pkgPath ? pkgPath : wsRoot);
        const args = ["update", "--progress=f", "-k", "--color", "--checkout-only"];
        let name = `${pathBasename(wsRoot)}: Checkout`;
        let scope = workspaceFolders[0];

        if (pkgPath) {
            args.push(pkgPath);
            name += ` ${pkgName}`;
            scope = wrapper.object.getWorkspaceFolder(pkgPath)!;
        }
        assertTask(task, process, args, name, scope);
    }
    function assertOsdepsTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["osdeps", "--color"];
        const name = `${pathBasename(wsRoot)}: Install OS Dependencies`;
        const scope = workspaceFolders[0];
        assertTask(task, process, args, name, scope);
    }
    function assertUpdateConfigTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["update", "--progress=f", "-k", "--color", "--config"];
        const name = `${pathBasename(wsRoot)}: Update Configuration`;
        const scope = workspaceFolders[0];
        assertTask(task, process, args, name, scope);
    }
    function packageName(pkgPath: string, wsRoot: string, installManifest: autoproj.IPackage[]): string {
        const pkgInfo = installManifest.find((pkg) => pkg.srcdir === pkgPath);
        if (pkgInfo) {
            return pkgInfo.name;
        }
        return pathRelative(wsRoot, pkgPath);
    }
    async function assertAllPackageTasks(pkgPath: string, wsRoot: string, installManifest: autoproj.IPackage[] = []) {
        const args = [wsRoot, pkgPath, packageName(pkgPath, wsRoot, installManifest)];
        const buildTask = await subject.buildTask(pkgPath);
        assert.notEqual(buildTask, undefined);
        assertBuildTask.apply(this, [buildTask, ...args]);

        const nodepsBuildTask = await subject.nodepsBuildTask(pkgPath);
        assert.notEqual(nodepsBuildTask, undefined);
        assertNodepsBuildTask.apply(this, [nodepsBuildTask, ...args]);

        const forceBuildTask = await subject.forceBuildTask(pkgPath);
        assert.notEqual(forceBuildTask, undefined);
        assertForceBuildTask.apply(this, [forceBuildTask, ...args]);

        const updateTask = await subject.updateTask(pkgPath);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask.apply(this, [updateTask, ...args]);

        const checkoutTask = await subject.checkoutTask(pkgPath);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask.apply(this, [checkoutTask, ...args]);
    }

    async function assertAllWorkspaceTasks(wsRoot: string) {
        const watchTask = await subject.watchTask(wsRoot);
        assert.notEqual(watchTask, undefined);
        assertWatchTask(watchTask, wsRoot);

        const buildTask = await subject.buildTask(wsRoot);
        assert.notEqual(buildTask, undefined);
        assertBuildTask(buildTask, wsRoot);

        const checkoutTask = await subject.checkoutTask(wsRoot);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask(checkoutTask, wsRoot);

        const osdepsTask = await subject.osdepsTask(wsRoot);
        assert.notEqual(osdepsTask, undefined);
        assertOsdepsTask(osdepsTask, wsRoot);

        const updateConfigTask = await subject.updateConfigTask(wsRoot);
        assert.notEqual(updateConfigTask, undefined);
        assertUpdateConfigTask(updateConfigTask, wsRoot);

        const updateTask = await subject.updateTask(wsRoot);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask(updateTask, wsRoot);
    }

    describe("in a non empty workspace", () => {
        let wsOneRoot: string;
        let wsTwoRoot: string;
        let a: string;
        let b: string;
        let c: string;
        let d: string;
        let e: string;
        beforeEach(() => {
            wsOneRoot = helpers.mkdir("one");
            wsTwoRoot = helpers.mkdir("two");
            helpers.mkdir("one", ".autoproj");
            helpers.mkdir("two", ".autoproj");
            d = helpers.mkdir("one", "autoproj");
            e = helpers.mkdir("two", "autoproj");

            helpers.createInstallationManifest([], "one");
            helpers.createInstallationManifest([], "two");
            helpers.mkdir("one", "drivers");
            helpers.mkdir("two", "firmware");
            a = helpers.mkdir("one", "drivers", "iodrivers_base");
            b = helpers.mkdir("one", "drivers", "auv_messaging");
            c = helpers.mkdir("two", "firmware", "chibios");

            addFolder(a);
            addFolder(b);
            addFolder(c);
            addFolder(d);
            addFolder(e);
            subject = new tasks.AutoprojProvider(workspaces, wrapper.object);
        });

        it("is initalized with all tasks", async () => {
            const providedTasks = await subject.provideTasks(null);
            assert.equal(providedTasks.length, 27);
        });
        it("is initalized with all workspace tasks", async () => {
            await subject.provideTasks(null);
            await assertAllWorkspaceTasks(wsOneRoot);
            await assertAllWorkspaceTasks(wsTwoRoot);
        });
        it("is initalized with all package tasks", async () => {
            await subject.provideTasks(null);
            await assertAllPackageTasks(a, wsOneRoot);
            await assertAllPackageTasks(b, wsOneRoot);
            await assertAllPackageTasks(c, wsTwoRoot);
        });
        it("gets the package names from installation manifest", async () => {
            const PKG_IODRIVERS_BASE: autoproj.IPackage = {
                builddir: "/path/to/drivers/iodrivers_base/build",
                dependencies: ["cmake"],
                logdir: "/path/to/install/log",
                name: "iodrivers_base",
                prefix: "/path/to/install",
                srcdir: pathJoin(wsOneRoot, "drivers", "iodrivers_base"),
                type: "Autobuild::CMake",
                vcs: {
                    repository_id: "github:/rock-core/drivers-iodrivers_base.git",
                    type: "git",
                    url: "https://github.com/rock-core/drivers-iodrivers_base.git",
                },
            };

            helpers.createInstallationManifest([PKG_IODRIVERS_BASE], "one");
            await subject.provideTasks(null);
            await assertAllPackageTasks(a, wsOneRoot, [PKG_IODRIVERS_BASE]);
            await assertAllPackageTasks(b, wsOneRoot, [PKG_IODRIVERS_BASE]);
            await assertAllPackageTasks(c, wsTwoRoot, [PKG_IODRIVERS_BASE]);
        });
    });

    describe("in an empty workspace", () => {
        beforeEach(() => {
            subject = new tasks.AutoprojProvider(workspaces, wrapper.object);
        });
        it("provides an empty array of tasks", async () => {
            const providedTasks = await subject.provideTasks(null);
            assert.equal(providedTasks.length, 0);
        });
        it("creates tasks when folders/workspaces are added", async () => {
            helpers.mkdir(".autoproj");
            helpers.createInstallationManifest([]);
            helpers.mkdir("drivers");

            const a = helpers.mkdir("drivers", "iodrivers_base");
            addFolder(a);
            subject.reloadTasks();

            const providedTasks = await subject.provideTasks(null);
            await assert.equal(providedTasks.length, 11);
            await assertAllWorkspaceTasks(helpers.fullPath());
            await assertAllPackageTasks(a, root);
        });
    });
});
