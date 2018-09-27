"use strict";
import * as assert from "assert";
import { basename as pathBasename, join as pathJoin, relative as pathRelative } from "path";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as tasks from "../src/tasks";
import * as wrappers from "../src/wrappers";
import * as helpers from "./helpers";

describe("definitionsEqual()", () => {
    it("returns false if first definition is not autoproj", () => {
        const first: vscode.TaskDefinition = { type: "foo" };
        const second: tasks.ITaskDefinition = { type: tasks.TaskType.Package, workspace: "" };
        assert.equal(tasks.definitionsEqual(first as tasks.ITaskDefinition, second), false);
    });
    it("returns false if second definition is not autoproj", () => {
        const first: tasks.ITaskDefinition = { type: tasks.TaskType.Package, workspace: "" };
        const second: vscode.TaskDefinition = { type: "foo" };
        assert.equal(tasks.definitionsEqual(first, second as tasks.ITaskDefinition), false);
    });
    it("returns false if both definitions are not autoproj", () => {
        const first: vscode.TaskDefinition = { type: "bar" };
        const second: vscode.TaskDefinition = { type: "foo" };
        assert.equal(tasks.definitionsEqual(first as tasks.ITaskDefinition, second as tasks.ITaskDefinition), false);
    });
    it("returns false if definitions are of different types", () => {
        const first: tasks.IPackageTaskDefinition = { mode: tasks.PackageTaskMode.Build, path: "",
                                                      type: tasks.TaskType.Package, workspace: "" };
        const second: tasks.IWorkspaceTaskDefinition = { mode: tasks.WorkspaceTaskMode.Watch,
                                                         type: tasks.TaskType.Workspace, workspace: "" };
        assert.equal(tasks.definitionsEqual(first, second), false);
    });
    it("returns false if definitions have different workspaces", () => {
        const first: tasks.IPackageTaskDefinition = { mode: tasks.PackageTaskMode.Build, path: "/foo",
                                                      type: tasks.TaskType.Package, workspace: "/bar" };
        const second: tasks.IPackageTaskDefinition = { mode: tasks.PackageTaskMode.Build, path: "/foo",
                                                       type: tasks.TaskType.Package, workspace: "" };
        assert.equal(tasks.definitionsEqual(first, second), false);
    });
    it("returns false if definitions have different packages", () => {
        const first: tasks.IPackageTaskDefinition = { mode: tasks.PackageTaskMode.Build, path: "/foo",
                                                      type: tasks.TaskType.Package, workspace: "/bar" };
        const second: tasks.IPackageTaskDefinition = { mode: tasks.PackageTaskMode.Build, path: "/dummy",
                                                       type: tasks.TaskType.Package, workspace: "/bar" };
        assert.equal(tasks.definitionsEqual(first, second), false);
    });
    it("returns true if autoproj-package definitions are equal", () => {
        const first: tasks.IPackageTaskDefinition = { mode: tasks.PackageTaskMode.Build, path: "/foo",
                                                      type: tasks.TaskType.Package, workspace: "/bar" };
        const second: tasks.IPackageTaskDefinition = { mode: tasks.PackageTaskMode.Build, path: "/foo",
                                                       type: tasks.TaskType.Package, workspace: "/bar" };
        assert.equal(tasks.definitionsEqual(first, second), true);
    });
    it("returns true if autoproj-workspace definitions are equal", () => {
        const first: tasks.IWorkspaceTaskDefinition = { mode: tasks.WorkspaceTaskMode.Watch,
                                                        type: tasks.TaskType.Workspace, workspace: "/bar" };
        const second: tasks.IWorkspaceTaskDefinition = { mode: tasks.WorkspaceTaskMode.Watch,
                                                         type: tasks.TaskType.Workspace, workspace: "/bar" };
        assert.equal(tasks.definitionsEqual(first, second), true);
    });
});

describe("Task provider", () => {
    let root: string;
    let workspaces: autoproj.Workspaces;
    let subject: tasks.AutoprojProvider;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockConfiguration: TypeMoq.IMock<vscode.WorkspaceConfiguration>;
    let workspaceFolders: vscode.WorkspaceFolder[];
    let packageTasks: {
        buildNoDeps: boolean,
        checkout: boolean,
        forceBuild: boolean,
        update: boolean,
    };
    let workspaceTasks: {
        build: boolean,
        checkout: boolean,
        installOsdeps: boolean,
        update: boolean,
        updateConfig: boolean,
    };
    beforeEach(() => {
        packageTasks = {
            buildNoDeps: true,
            checkout: true,
            forceBuild: true,
            update: true,
        };

        workspaceTasks = {
            build: true,
            checkout: true,
            installOsdeps: true,
            update: true,
            updateConfig: true,
        };

        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockConfiguration = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
        mockConfiguration.setup((x) => x.get("package")).returns(() => packageTasks);
        mockConfiguration.setup((x) => x.get("workspace")).returns(() => workspaceTasks);
        mockWrapper.setup((x) => x.getConfiguration("autoproj.optionalTasks")).
            returns(() => mockConfiguration.object);

        root = helpers.init();
        workspaces = new autoproj.Workspaces();
        workspaceFolders = [];
        mockWrapper.setup((x) => x.workspaceFolders).returns(() => workspaceFolders);
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
        mockWrapper.setup((x) => x.getWorkspaceFolder(folderPath)).returns(() => folder);
    }
    function assertTask(task: vscode.Task, process: string, args: string[],
                        name: string, scope: vscode.TaskScope | vscode.WorkspaceFolder, defs: tasks.ITaskDefinition) {
        const actualProcess = (task.execution as vscode.ProcessExecution).process;
        const actualArgs = (task.execution as vscode.ProcessExecution).args;
        assert.deepEqual(scope, task.scope);
        assert.equal(name, task.name);
        assert.equal(actualProcess, process);
        assert.deepEqual(actualArgs, args);
        assert.equal(tasks.definitionsEqual(task.definition as tasks.ITaskDefinition, defs), true);

        if (defs.type !== tasks.TaskType.Workspace && defs.mode !== tasks.WorkspaceTaskMode.Watch) {
            assert.deepEqual(task.presentationOptions, { reveal: vscode.TaskRevealKind.Silent });
        }
    }
    function autoprojExePath(basePath) {
        const wsRoot = autoproj.findWorkspaceRoot(basePath) as string;
        return autoproj.autoprojExePath(wsRoot);
    }
    function assertWatchTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["watch", "--show-events"];
        const name = `${pathBasename(wsRoot)}: Watch`;
        const defs: tasks.IWorkspaceTaskDefinition = {
            mode: tasks.WorkspaceTaskMode.Watch,
            type: tasks.TaskType.Workspace,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, workspaceFolders[0], defs);
        assert.equal(task.isBackground, true);
        assert.deepEqual(task.presentationOptions, { reveal: vscode.TaskRevealKind.Never });
    }
    function assertBuildTask(task: vscode.Task, wsRoot: string, pkgPath?: string, pkgName?: string) {
        const process = autoprojExePath(pkgPath ? pkgPath : wsRoot);
        const args = ["build", "--tool"];
        let scope = workspaceFolders[0];
        let name = `${pathBasename(wsRoot)}: Build`;
        let defs: tasks.ITaskDefinition = { type: "", workspace: wsRoot };

        if (pkgPath) {
            args.push(pkgPath);
            name += ` ${pkgName}`;
            scope = mockWrapper.object.getWorkspaceFolder(pkgPath)!;
            defs = { ...defs, mode: tasks.PackageTaskMode.Build,
                     path: pkgPath,
                     type: tasks.TaskType.Package,
            };
        } else {
            defs = { ...defs, mode: tasks.WorkspaceTaskMode.Build,
                     type: tasks.TaskType.Workspace,
            };
        }

        assertTask(task, process, args, name, scope, defs);
    }
    function assertForceBuildTask(task: vscode.Task, wsRoot: string, pkgPath: string, pkgName: string) {
        const process = autoprojExePath(pkgPath);
        const args = ["build", "--tool", "--force", "--deps=f", "--no-confirm", pkgPath];
        const name = `${pathBasename(wsRoot)}: Force Build ${pkgName} (nodeps)`;
        const scope = mockWrapper.object.getWorkspaceFolder(pkgPath)!;
        const defs: tasks.IPackageTaskDefinition = {
            mode: tasks.PackageTaskMode.ForceBuild,
            path: pkgPath,
            type: tasks.TaskType.Package,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, scope, defs);
    }
    function assertNodepsBuildTask(task: vscode.Task, wsRoot: string, pkgPath: string, pkgName: string) {
        const process = autoprojExePath(pkgPath);
        const args = ["build", "--tool", "--deps=f", pkgPath];
        const name = `${pathBasename(wsRoot)}: Build ${pkgName} (nodeps)`;
        const scope = mockWrapper.object.getWorkspaceFolder(pkgPath)!;
        const defs: tasks.IPackageTaskDefinition = {
            mode: tasks.PackageTaskMode.BuildNoDeps,
            path: pkgPath,
            type: tasks.TaskType.Package,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, scope, defs);
    }
    function assertUpdateTask(task: vscode.Task, wsRoot: string, pkgPath?: string, pkgName?: string) {
        const process = autoprojExePath(pkgPath ? pkgPath : wsRoot);
        const args = ["update", "--progress=f", "-k", "--color"];
        let scope = workspaceFolders[0];
        let name = `${pathBasename(wsRoot)}: Update`;
        let defs: tasks.ITaskDefinition = { type: "", workspace: wsRoot };

        if (pkgPath) {
            args.push(pkgPath);
            name += ` ${pkgName}`;
            scope = mockWrapper.object.getWorkspaceFolder(pkgPath)!;
            defs = { ...defs, mode: tasks.PackageTaskMode.Update,
                     path: pkgPath,
                     type: tasks.TaskType.Package,
            };
        } else {
            defs = { ...defs, mode: tasks.WorkspaceTaskMode.Update,
                     type: tasks.TaskType.Workspace,
            };
        }
        assertTask(task, process, args, name, scope, defs);
    }
    function assertCheckoutTask(task: vscode.Task, wsRoot: string, pkgPath?: string, pkgName?: string) {
        const process = autoprojExePath(pkgPath ? pkgPath : wsRoot);
        const args = ["update", "--progress=f", "-k", "--color", "--checkout-only"];
        let name = `${pathBasename(wsRoot)}: Checkout`;
        let scope = workspaceFolders[0];
        let defs: tasks.ITaskDefinition = { type: "", workspace: wsRoot };

        if (pkgPath) {
            args.push(pkgPath);
            name += ` ${pkgName}`;
            scope = mockWrapper.object.getWorkspaceFolder(pkgPath)!;
            defs = { ...defs, mode: tasks.PackageTaskMode.Checkout,
                     path: pkgPath,
                     type: tasks.TaskType.Package,
            };
        } else {
            defs = { ...defs, mode: tasks.WorkspaceTaskMode.Checkout,
                     type: tasks.TaskType.Workspace,
            };
        }

        assertTask(task, process, args, name, scope, defs);
    }
    function assertOsdepsTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["osdeps", "--color"];
        const name = `${pathBasename(wsRoot)}: Install OS Dependencies`;
        const scope = workspaceFolders[0];
        const defs: tasks.IWorkspaceTaskDefinition = {
            mode: tasks.WorkspaceTaskMode.Osdeps,
            type: tasks.TaskType.Workspace,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, scope, defs);
    }
    function assertUpdateConfigTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["update", "--progress=f", "-k", "--color", "--config"];
        const name = `${pathBasename(wsRoot)}: Update Configuration`;
        const scope = workspaceFolders[0];
        const defs: tasks.IWorkspaceTaskDefinition = {
            mode: tasks.WorkspaceTaskMode.UpdateCofig,
            type: tasks.TaskType.Workspace,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, scope, defs);
    }
    function assertUpdateEnvironmentTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["envsh", "--progress=f", "--color"];
        const name = `${pathBasename(wsRoot)}: Update Environment`;
        const scope = workspaceFolders[0];
        const defs: tasks.IWorkspaceTaskDefinition = {
            mode: tasks.WorkspaceTaskMode.UpdateEnvironment,
            type: tasks.TaskType.Workspace,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, scope, defs);
        assert.equal(task.presentationOptions.reveal, vscode.TaskRevealKind.Silent);
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

        const updateEnvironmentTask = await subject.updateEnvironmentTask(wsRoot);
        assert.notEqual(updateEnvironmentTask, undefined);
        assertUpdateEnvironmentTask(updateEnvironmentTask, wsRoot);

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
            addFolder(wsOneRoot);
            addFolder(wsTwoRoot);
            subject = new tasks.AutoprojProvider(workspaces, mockWrapper.object);
        });

        it("is initalized with all tasks", async () => {
            const providedTasks = await subject.provideTasks(null);
            assert.equal(providedTasks.length, 29);
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
        it("does not create disabled tasks", async () => {
            packageTasks = {
                buildNoDeps: false,
                checkout: false,
                forceBuild: false,
                update: false,
            };

            workspaceTasks = {
                build: false,
                checkout: false,
                installOsdeps: false,
                update: false,
                updateConfig: false,
            };
            await subject.provideTasks(null);
            subject.reloadTasks();

            const providedTasks = await subject.provideTasks(null);
            // 2 mandatory tasks per workspace + 1 mandatory task per package
            await assert.equal(providedTasks.length, 2 * 2 + 1 * 3);
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
            subject = new tasks.AutoprojProvider(workspaces, mockWrapper.object);
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
            await assert.equal(providedTasks.length, 12);
            await assertAllWorkspaceTasks(helpers.fullPath());
            await assertAllPackageTasks(a, root);
        });
    });
    describe("in any case", () => {
        beforeEach(() => {
            subject = new tasks.AutoprojProvider(workspaces, mockWrapper.object);
        });
        it("resolveTask() always returns null", async () => {
            assert.equal(await subject.resolveTask(undefined, undefined), null);
        });
        it("task getters throws if there are no tasks", async () => {
            await helpers.assertThrowsAsync(subject.buildTask("/not/found"), /no entry/);
            await helpers.assertThrowsAsync(subject.watchTask("/not/found"), /no entry/);
            await helpers.assertThrowsAsync(subject.forceBuildTask("/not/found"), /no entry/);
            await helpers.assertThrowsAsync(subject.nodepsBuildTask("/not/found"), /no entry/);
            await helpers.assertThrowsAsync(subject.updateConfigTask("/not/found"), /no entry/);
            await helpers.assertThrowsAsync(subject.updateEnvironmentTask("/not/found"), /no entry/);
            await helpers.assertThrowsAsync(subject.updateTask("/not/found"), /no entry/);
            await helpers.assertThrowsAsync(subject.checkoutTask("/not/found"), /no entry/);
            await helpers.assertThrowsAsync(subject.osdepsTask("/not/found"), /no entry/);
        });
    });
});
