"use strict";
import * as assert from "assert";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as tasks from "../src/tasks";
import * as helpers from "./helpers";

describe("Task provider", () => {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let subject: tasks.AutoprojProvider;

    beforeEach(() => {
        root = helpers.init();
        workspaces = new autoproj.Workspaces();
    });
    afterEach(() => {
        helpers.clear();
    });

    function assertTask(task: vscode.Task, process: string, args: string[]) {
        const actualProcess = (task.execution as vscode.ProcessExecution).process;
        const actualArgs = (task.execution as vscode.ProcessExecution).args;
        assert.equal(actualProcess, process);
        assert.deepEqual(actualArgs, args);
    }
    function autoprojExePath(basePath) {
        const wsRoot = autoproj.findWorkspaceRoot(basePath) as string;
        return autoproj.autoprojExePath(wsRoot);
    }
    function assertWatchTask(task: vscode.Task, path: string) {
        const process = autoprojExePath(path);
        const args = ["watch", "--show-events"];
        assertTask(task, process, args);
    }
    function assertBuildTask(task: vscode.Task, path: string, isPackage = true) {
        const process = autoprojExePath(path);
        const args = ["build", "--tool"]; if (isPackage) { args.push(path); }
        assertTask(task, process, args);
    }
    function assertForceBuildTask(task: vscode.Task, path: string) {
        const process = autoprojExePath(path);
        const args = ["build", "--tool", "--force", "--deps=f", "--no-confirm", path];
        assertTask(task, process, args);
    }
    function assertNodepsBuildTask(task: vscode.Task, path: string) {
        const process = autoprojExePath(path);
        const args = ["build", "--tool", "--deps=f", path];
        assertTask(task, process, args);
    }
    function assertUpdateTask(task: vscode.Task, path: string, isPackage = true) {
        const process = autoprojExePath(path);
        const args = ["update", "--progress=f", "-k", "--color"];
        if (isPackage) { args.push(path); }
        assertTask(task, process, args);
    }
    function assertCheckoutTask(task: vscode.Task, path: string, isPackage = true) {
        const process = autoprojExePath(path);
        const args = ["update", "--progress=f", "-k", "--color", "--checkout-only"];
        if (isPackage) { args.push(path); }
        assertTask(task, process, args);
    }
    function assertOsdepsTask(task: vscode.Task, path: string) {
        const process = autoprojExePath(path);
        const args = ["osdeps", "--color"];
        assertTask(task, process, args);
    }
    function assertUpdateConfigTask(task: vscode.Task, path: string) {
        const process = autoprojExePath(path);
        const args = ["update", "--progress=f", "-k", "--color", "--config"];
        assertTask(task, process, args);
    }
    function assertAllPackageTasks(path: string) {
        const buildTask = subject.buildTask(path);
        assert.notEqual(buildTask, undefined);
        assertBuildTask(buildTask, path);

        const nodepsBuildTask = subject.nodepsBuildTask(path);
        assert.notEqual(nodepsBuildTask, undefined);
        assertNodepsBuildTask(nodepsBuildTask, path);

        const forceBuildTask = subject.forceBuildTask(path);
        assert.notEqual(forceBuildTask, undefined);
        assertForceBuildTask(forceBuildTask, path);

        const updateTask = subject.updateTask(path);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask(updateTask, path);

        const checkoutTask = subject.checkoutTask(path);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask(checkoutTask, path);
    }

    function assertAllWorkspaceTasks(wsRoot: string) {
        const watchTask = subject.watchTask(wsRoot);
        assert.notEqual(watchTask, undefined);
        assertWatchTask(watchTask, wsRoot);

        const buildTask = subject.buildTask(wsRoot);
        assert.notEqual(buildTask, undefined);
        assertBuildTask(buildTask, wsRoot, false);

        const checkoutTask = subject.checkoutTask(wsRoot);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask(checkoutTask, wsRoot, false);

        const osdepsTask = subject.osdepsTask(wsRoot);
        assert.notEqual(osdepsTask, undefined);
        assertOsdepsTask(osdepsTask, wsRoot);

        const updateConfigTask = subject.updateConfigTask(wsRoot);
        assert.notEqual(updateConfigTask, undefined);
        assertUpdateConfigTask(updateConfigTask, wsRoot);

        const updateTask = subject.updateTask(wsRoot);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask(updateTask, wsRoot, false);
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

            workspaces.addFolder(a);
            workspaces.addFolder(b);
            workspaces.addFolder(c);
            workspaces.addFolder(d);
            workspaces.addFolder(e);
            subject = new tasks.AutoprojProvider(workspaces);
        });

        it("is initalized with all tasks", () => {
            const providedTasks = subject.provideTasks(null);
            assert.equal(providedTasks.length, 27);
        });
        it("is initalized with all workspace tasks", () => {
            subject.provideTasks(null);
            assertAllWorkspaceTasks(wsOneRoot);
            assertAllWorkspaceTasks(wsTwoRoot);
        });
        it("is initalized with all package tasks", () => {
            subject.provideTasks(null);
            assertAllPackageTasks(a);
            assertAllPackageTasks(b);
            assertAllPackageTasks(c);
        });
    });

    describe("in an empty workspace", () => {
        beforeEach(() => {
            subject = new tasks.AutoprojProvider(workspaces);
        });
        it("provides an empty array of tasks", () => {
            const providedTasks = subject.provideTasks(null);
            assert.equal(providedTasks.length, 0);
        });
        it("creates tasks when folders/workspaces are added", () => {
            helpers.mkdir(".autoproj");
            helpers.createInstallationManifest([]);
            helpers.mkdir("drivers");

            const a = helpers.mkdir("drivers", "iodrivers_base");
            workspaces.addFolder(a);
            subject.reloadTasks();

            const providedTasks = subject.provideTasks(null);
            assert.equal(providedTasks.length, 11);
            assertAllWorkspaceTasks(helpers.fullPath());
            assertAllPackageTasks(a);
        });
    });
});
