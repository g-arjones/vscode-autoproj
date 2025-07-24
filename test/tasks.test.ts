"use strict";
import * as assert from "assert";
import { basename as pathBasename, relative as pathRelative, join as pathJoin } from "path";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as tasks from "../src/tasks";
import { host, Mocks, WorkspaceBuilder } from "./helpers";
import * as yaml from "js-yaml";
import { fs } from "../src/cmt/pr";
import { It, Times } from "typemoq";
import { using } from "./using";

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
        const second: tasks.IWorkspaceTaskDefinition = { mode: tasks.WorkspaceTaskMode.Checkout,
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
        const first: tasks.IWorkspaceTaskDefinition = { mode: tasks.WorkspaceTaskMode.Osdeps,
            type: tasks.TaskType.Workspace, workspace: "/bar" };
        const second: tasks.IWorkspaceTaskDefinition = { mode: tasks.WorkspaceTaskMode.Osdeps,
            type: tasks.TaskType.Workspace, workspace: "/bar" };
        assert.equal(tasks.definitionsEqual(first, second), true);
    });
});

describe("Task provider", () => {
    let builder1: WorkspaceBuilder;
    let builder2: WorkspaceBuilder;
    let workspaces: autoproj.Workspaces;
    let subject: tasks.AutoprojProvider;
    let mocks: Mocks;
    let packageTasks: {
        build: boolean,
        buildNoDeps: boolean,
        checkout: boolean,
        forceBuild: boolean,
        rebuild: boolean,
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
            build: true,
            buildNoDeps: true,
            checkout: true,
            forceBuild: true,
            rebuild: true,
            update: true,
        };

        workspaceTasks = {
            build: true,
            checkout: true,
            installOsdeps: true,
            update: true,
            updateConfig: true,
        };

        builder1 = new WorkspaceBuilder();
        builder2 = new WorkspaceBuilder();

        mocks = new Mocks();
        mocks.getConfiguration.setup((x) => x("autoproj.tasks")).returns(() => mocks.workspaceConfiguration.object);
        mocks.workspaceConfiguration.setup((x) => x.get("package")).returns(() => packageTasks);
        mocks.workspaceConfiguration.setup((x) => x.get("workspace")).returns(() => workspaceTasks);

        workspaces = new autoproj.Workspaces();
        using(mocks.getConfiguration, mocks.showErrorMessage);
    });

    function assertTask(task: vscode.Task, process: string, args: string[],
                        name: string, scope: vscode.TaskScope | vscode.WorkspaceFolder, defs: tasks.ITaskDefinition) {
        const actualProcess = (task.execution as vscode.ProcessExecution).process;
        const actualArgs = (task.execution as vscode.ProcessExecution).args;
        assert.deepEqual(scope, task.scope);
        assert.equal(name, task.name);
        assert.equal(actualProcess, process);
        assert.deepEqual(actualArgs, args);
        assert.equal(tasks.definitionsEqual(task.definition as tasks.ITaskDefinition, defs), true);

        if (defs.type !== tasks.TaskType.Workspace) {
            assert.deepEqual(task.presentationOptions, { reveal: vscode.TaskRevealKind.Silent });
        }
    }
    function autoprojExePath(basePath) {
        const wsRoot = autoproj.findWorkspaceRoot(basePath) as string;
        return autoproj.autoprojExePath(wsRoot);
    }
    function assertBuildTask(task: vscode.Task, wsRoot: string, pkgPath?: string, pkgName?: string) {
        const process = autoprojExePath(pkgPath ? pkgPath : wsRoot);
        const args = ["build", "--tool"];
        let scope = vscode.workspace.workspaceFolders![0];
        let name = `${pathBasename(wsRoot)}: Build all packages`;
        let defs: tasks.ITaskDefinition = { type: "", workspace: wsRoot };

        if (pkgPath) {
            args.push(pkgPath);
            name = `${pathBasename(wsRoot)}: Build ${pkgName}`;
            scope = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pkgPath))!;
            defs = {
                ...defs, mode: tasks.PackageTaskMode.Build,
                path: pkgPath,
                type: tasks.TaskType.Package,
            };
        } else {
            defs = {
                ...defs, mode: tasks.WorkspaceTaskMode.Build,
                type: tasks.TaskType.Workspace,
            };
        }

        assertTask(task, process, args, name, scope, defs);
    }
    function assertForceBuildTask(task: vscode.Task, wsRoot: string, pkgPath: string, pkgName: string) {
        const process = autoprojExePath(pkgPath);
        const args = ["build", "--tool", "--force", "--deps=f", "--no-confirm", pkgPath];
        const name = `${pathBasename(wsRoot)}: Force Build ${pkgName} (nodeps)`;
        const scope = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pkgPath))!;
        const defs: tasks.IPackageTaskDefinition = {
            mode: tasks.PackageTaskMode.ForceBuild,
            path: pkgPath,
            type: tasks.TaskType.Package,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, scope, defs);
    }
    function assertRebuildTask(task: vscode.Task, wsRoot: string, pkgPath: string, pkgName: string) {
        const process = autoprojExePath(pkgPath);
        const args = ["build", "--tool", "--rebuild", "--deps=f", "--no-confirm", pkgPath];
        const name = `${pathBasename(wsRoot)}: Rebuild ${pkgName} (nodeps)`;
        const scope = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pkgPath))!;
        const defs: tasks.IPackageTaskDefinition = {
            mode: tasks.PackageTaskMode.Rebuild,
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
        const scope = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pkgPath))!;
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
        const args = ["update", "-k", "--color"];
        let scope = vscode.workspace.workspaceFolders![0];
        let name = `${pathBasename(wsRoot)}: Update all packages`;
        let defs: tasks.ITaskDefinition = { type: "", workspace: wsRoot };

        if (pkgPath) {
            args.push(pkgPath);
            name = `${pathBasename(wsRoot)}: Update ${pkgName}`;
            scope = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pkgPath))!;
            defs = {
                ...defs, mode: tasks.PackageTaskMode.Update,
                path: pkgPath,
                type: tasks.TaskType.Package,
            };
        } else {
            defs = {
                ...defs, mode: tasks.WorkspaceTaskMode.Update,
                type: tasks.TaskType.Workspace,
            };
        }
        assertTask(task, process, args, name, scope, defs);
    }
    function assertCheckoutTask(task: vscode.Task, wsRoot: string, pkgPath?: string, pkgName?: string) {
        const process = autoprojExePath(pkgPath ? pkgPath : wsRoot);
        const args = ["update", "-k", "--color", "--checkout-only"];
        let name = `${pathBasename(wsRoot)}: Checkout missing packages`;
        let scope = vscode.workspace.workspaceFolders![0];
        let defs: tasks.ITaskDefinition = { type: "", workspace: wsRoot };

        if (pkgPath) {
            args.push(pkgPath);
            name = `${pathBasename(wsRoot)}: Checkout ${pkgName}`;
            scope = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pkgPath))!;
            defs = {
                ...defs, mode: tasks.PackageTaskMode.Checkout,
                path: pkgPath,
                type: tasks.TaskType.Package,
            };
        } else {
            defs = {
                ...defs, mode: tasks.WorkspaceTaskMode.Checkout,
                type: tasks.TaskType.Workspace,
            };
        }

        assertTask(task, process, args, name, scope, defs);
    }
    function assertOsdepsTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["osdeps", "--color"];
        const name = `${pathBasename(wsRoot)}: Install OS Dependencies`;
        const scope = vscode.workspace.workspaceFolders![0];
        const defs: tasks.IWorkspaceTaskDefinition = {
            mode: tasks.WorkspaceTaskMode.Osdeps,
            type: tasks.TaskType.Workspace,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, scope, defs);
    }
    function assertUpdateConfigTask(task: vscode.Task, wsRoot: string) {
        const process = autoprojExePath(wsRoot);
        const args = ["update", "-k", "--color", "--config"];
        const name = `${pathBasename(wsRoot)}: Update Configuration`;
        const scope = vscode.workspace.workspaceFolders![0];
        const defs: tasks.IWorkspaceTaskDefinition = {
            mode: tasks.WorkspaceTaskMode.UpdateConfig,
            type: tasks.TaskType.Workspace,
            workspace: wsRoot,
        };

        assertTask(task, process, args, name, scope, defs);
    }
    function packageName(pkgPath: string, wsRoot: string, installManifest: autoproj.IPackage[]): string {
        const pkgInfo = installManifest.find((pkg) => pkg.srcdir === pkgPath);
        if (pkgInfo) {
            return pkgInfo.name;
        }
        return pathRelative(wsRoot, pkgPath);
    }
    async function assertAllPackageTasks(pkgPath: string, wsRoot: string) {
        const installManifest: autoproj.IPackage[] =
            yaml.load(await fs.readFile(pathJoin(wsRoot, ".autoproj", "installation-manifest"))) as autoproj.IPackage[];

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

        const rebuildTask = await subject.rebuildTask(pkgPath);
        assert.notEqual(rebuildTask, undefined);
        assertRebuildTask.apply(this, [rebuildTask, ...args]);

        const updateTask = await subject.updateTask(pkgPath);
        assert.notEqual(updateTask, undefined);
        assertUpdateTask.apply(this, [updateTask, ...args]);

        const checkoutTask = await subject.checkoutTask(pkgPath);
        assert.notEqual(checkoutTask, undefined);
        assertCheckoutTask.apply(this, [checkoutTask, ...args]);
    }

    async function assertAllWorkspaceTasks(wsRoot: string) {
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

        beforeEach(async () => {
            wsOneRoot = builder1.root;
            wsTwoRoot = builder2.root;
            d = pathJoin(wsOneRoot, "autoproj")
            e = pathJoin(wsTwoRoot, "autoproj");

            a = builder1.addPackage("drivers/iodrivers_base").srcdir;
            b = builder1.addPackage("drivers/auv_messaging").srcdir;
            c = builder2.addPackage("firmware/chibios").srcdir;

            workspaces.addFolder(a);
            workspaces.addFolder(b);
            workspaces.addFolder(c);
            workspaces.addFolder(d);
            workspaces.addFolder(e);

            await host.addFolders(a, b, c, d, e);
            subject = new tasks.AutoprojProvider(workspaces);
        });
        it("is initalized with all tasks", async () => {
            const providedTasks = await subject.provideTasks(null);
            assert.equal(providedTasks.length, 28);
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
                build: false,
                buildNoDeps: false,
                checkout: false,
                forceBuild: false,
                rebuild: false,
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
            assert.equal(providedTasks.length, 0);
        });
        it("handles exception if installation manifest is invalid", async () => {
            builder1.fs.mkfile("- bla: [", ".autoproj", "installation-manifest");
            builder2.fs.mkfile("- bla: [", ".autoproj", "installation-manifest");

            for (const ws of workspaces.workspaces.values()) {
                await ws.reload().catch(() => {});
            }

            subject.reloadTasks();
            const providedTasks = await subject.provideTasks(null);
            await assertAllWorkspaceTasks(wsOneRoot);
            await assertAllWorkspaceTasks(wsTwoRoot);
            assert.equal(providedTasks.length, 10);

            const msg = (message: string) => new RegExp("Could not generate package tasks").test(message);
            mocks.showErrorMessage.verify((x) => x(It.is(msg)), Times.atLeast(1)); // TODO: why somestimes twice?
        });
        it("gets the package names from installation manifest", async () => {
            await subject.provideTasks(null);
            await assertAllPackageTasks(a, wsOneRoot);
            await assertAllPackageTasks(b, wsOneRoot);
            await assertAllPackageTasks(c, wsTwoRoot);
        });
        describe("AutoprojWorkspaceTaskProvider", () => {
            it("returns workspace tasks only", async () => {
                const workspaceProvider = new tasks.AutoprojWorkspaceTaskProvider(subject);
                const providedTasks = await workspaceProvider.provideTasks(null as any);
                const filteredTasks = providedTasks.filter((task) => task.definition.type === "autoproj-workspace");
                assert.equal(providedTasks.length, filteredTasks.length);
            });
            it("resolveTask() always returns null", async () => {
                const workspaceProvider = new tasks.AutoprojWorkspaceTaskProvider(subject);
                assert.equal(workspaceProvider.resolveTask(null as any, null as any), null);
            })
        })
        describe("AutoprojPackageTaskProvider", () => {
            it("returns package tasks only", async () => {
                const packageProvider = new tasks.AutoprojPackageTaskProvider(subject);
                const providedTasks = await packageProvider.provideTasks(null as any);
                const filteredTasks = providedTasks.filter((task) => task.definition.type === "autoproj-package");
                assert.equal(providedTasks.length, filteredTasks.length);
            });
            it("resolveTask() always returns null", async () => {
                const packageProvider = new tasks.AutoprojPackageTaskProvider(subject);
                assert.equal(packageProvider.resolveTask(null as any, null as any), null);
            })
        })
    });

    describe("in an empty workspace", () => {
        beforeEach(() => {
            subject = new tasks.AutoprojProvider(workspaces);
        });
        it("provides an empty array of tasks", async () => {
            const providedTasks = await subject.provideTasks(null);
            assert.equal(providedTasks.length, 0);
        });
        it("creates tasks when folders/workspaces are added", async () => {
            const a = builder1.addPackage("drivers/iodrivers_base").srcdir;

            workspaces.addFolder(a);
            await host.addFolders(a);

            subject.reloadTasks();

            const providedTasks = await subject.provideTasks(null);
            assert.equal(providedTasks.length, 11);
            await assertAllWorkspaceTasks(builder1.root);
            await assertAllPackageTasks(a, builder1.root);
        });
    });
    describe("in any case", () => {
        beforeEach(() => {
            subject = new tasks.AutoprojProvider(workspaces);
        });
        it("resolveTask() always returns null", async () => {
            assert.equal(await subject.resolveTask(undefined, undefined), null);
        });
        it("task getters throws if there are no tasks", async () => {
            await assert.rejects(subject.buildTask("/not/found"), /no entry/);
            await assert.rejects(subject.forceBuildTask("/not/found"), /no entry/);
            await assert.rejects(subject.rebuildTask("/not/found"), /no entry/);
            await assert.rejects(subject.nodepsBuildTask("/not/found"), /no entry/);
            await assert.rejects(subject.updateConfigTask("/not/found"), /no entry/);
            await assert.rejects(subject.updateTask("/not/found"), /no entry/);
            await assert.rejects(subject.checkoutTask("/not/found"), /no entry/);
            await assert.rejects(subject.osdepsTask("/not/found"), /no entry/);
        });
        describe("isTaskEnabled()", () => {
            it("returns true for enabled tasks", () => {
                let type = tasks.TaskType.Package;
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.BuildNoDeps), true);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.ForceBuild), true);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.Rebuild), true);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.Update), true);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.Checkout), true);

                type = tasks.TaskType.Workspace;
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.Build), true);
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.Checkout), true);
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.Osdeps), true);
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.Update), true);
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.UpdateConfig), true);
            });
            it("returns false for disabled tasks", () => {
                packageTasks = {
                    build: false,
                    buildNoDeps: false,
                    checkout: false,
                    forceBuild: false,
                    rebuild: false,
                    update: false,
                };

                workspaceTasks = {
                    build: false,
                    checkout: false,
                    installOsdeps: false,
                    update: false,
                    updateConfig: false,
                };

                let type = tasks.TaskType.Package;
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.Build), false);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.BuildNoDeps), false);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.ForceBuild), false);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.Rebuild), false);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.Update), false);
                assert.equal(subject.isTaskEnabled(type, tasks.PackageTaskMode.Checkout), false);

                type = tasks.TaskType.Workspace;
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.Build), false);
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.Checkout), false);
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.Osdeps), false);
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.Update), false);
                assert.equal(subject.isTaskEnabled(type, tasks.WorkspaceTaskMode.UpdateConfig), false);
            });
            it("throws if task type is invalid", () => {
                assert.throws(() => subject.isTaskEnabled("foo" as tasks.TaskType,
                    "invalid" as tasks.PackageTaskMode), /Invalid/);
            });
        });
    });
});
