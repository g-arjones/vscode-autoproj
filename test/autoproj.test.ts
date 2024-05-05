"use strict";
import * as assert from "assert";
import * as path from "path";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as autoproj from "../src/autoproj";
import * as helpers from "./helpers";

const MANIFEST_TEST_FILE = `
- package_set: orocos.toolchain
  vcs:
    type: git
    url: https://github.com/orocos-toolchain/autoproj.git
    repository_id: github:/orocos-toolchain/autoproj.git
  raw_local_dir: raw/pkg/set/dir
  user_local_dir: user/pkg/set/dir
- name: ros2.common
  vcs:
    type: git
    url: https://github.com/g-arjones/ros2.common-package_set.git
    repository_id: github:/g-arjones/ros2.common-package_set.git
  raw_local_dir: raw/ros2/pkg/set/dir
  user_local_dir: user/ros2/pkg/set/dir
  package_set: ros2.common
- name: tools/rest_api
  type: Autobuild::Ruby
  vcs:
    type: git
    url: https://github.com/rock-core/tools-rest_api.git
    repository_id: github:/rock-core/tools-rest_api.git
  srcdir: "/path/to/tools/rest_api"
  builddir:
  logdir: "/path/to/install/tools/rest_api/log"
  prefix: "/path/to/install/tools/rest_api"
  dependencies:
  - utilrb
  - tools/orocos.rb
- name: ctrl_toolbox
  type: Autobuild::ImporterPackage
  vcs:
    :type: git
    :url: git@github.com:/ethz-adrl/control-toolbox.git
    :push_to: git@github.com:/ethz-adrl/control-toolbox.git
    :interactive: false
    :retry_count: 10
    :repository_id: github:/ethz-adrl/control-toolbox.git
  srcdir: "/path/to/ctrl_toolbox"
  importdir: "/path/to/ctrl_toolbox"
  prefix: "/home/jammy/dev/tfxl/install/ctrl_toolbox"
  builddir:
  logdir: "/home/jammy/dev/tfxl/install/ctrl_toolbox/log"
  dependencies:
  - ct_core
- name: ct_core
  type: Autobuild::CMake
  vcs:
    :type: git
    :url: git@github.com:/ethz-adrl/control-toolbox.git
    :push_to: git@github.com:/ethz-adrl/control-toolbox.git
    :interactive: false
    :retry_count: 10
    :repository_id: github:/ethz-adrl/control-toolbox.git
  srcdir: "/path/to/ctrl_toolbox/ct_core"
  importdir: "/path/to/ctrl_toolbox"
  prefix: "/home/jammy/dev/tfxl/install/ct_core"
  builddir: "/home/jammy/dev/tfxl/build/ct_core"
  logdir: "/home/jammy/dev/tfxl/install/ct_core/log"
  dependencies: []
`;
const PKG_SET_OROCOS_TOOLCHAIN = {
    name: "orocos.toolchain",
    raw_local_dir: "raw/pkg/set/dir",
    user_local_dir: "user/pkg/set/dir",
    vcs: {
        repository_id: "github:/orocos-toolchain/autoproj.git",
        type: "git",
        url: "https://github.com/orocos-toolchain/autoproj.git",
    },
};

const PKG_SET_ROS2_COMMON = {
    name: "ros2.common",
    raw_local_dir: "raw/ros2/pkg/set/dir",
    user_local_dir: "user/ros2/pkg/set/dir",
    vcs: {
        repository_id: "github:/g-arjones/ros2.common-package_set.git",
        type: "git",
        url: "https://github.com/g-arjones/ros2.common-package_set.git",
    },
};

const PKG_TOOLS_REST_API = {
    builddir: null,
    dependencies: ["utilrb", "tools/orocos.rb"],
    logdir: "/path/to/install/tools/rest_api/log",
    name: "tools/rest_api",
    prefix: "/path/to/install/tools/rest_api",
    srcdir: "/path/to/tools/rest_api",
    type: "Autobuild::Ruby",
    vcs: {
        repository_id: "github:/rock-core/tools-rest_api.git",
        type: "git",
        url: "https://github.com/rock-core/tools-rest_api.git",
    },
};

describe("Autoproj helpers tests", () => {
    const originalSpawn = require("child_process").spawn;
    let root: string;
    beforeEach(() => {
        root = helpers.init();
    });
    afterEach(() => {
        helpers.clear();
        require("child_process").spawn = originalSpawn;
    });

    describe("findWorkspaceRoot", () => {
        it("finds the workspace when given the root", () => {
            helpers.mkdir(".autoproj");
            helpers.createInstallationManifest([]);
            assert.equal(root, autoproj.findWorkspaceRoot(root));
        });
        it("finds the workspace root if given a subdirectory within it", () => {
            helpers.mkdir(".autoproj");
            helpers.createInstallationManifest([]);
            helpers.mkdir("a");
            const dir = helpers.mkdir("a", "b");
            assert.equal(root, autoproj.findWorkspaceRoot(dir));
        });
        it("returns null if not in a workspace", () => {
            helpers.mkdir(".autoproj");
            assert.equal(null, autoproj.findWorkspaceRoot(root));
        });
    });
    describe("loadWorkspaceInfo", () => {
        it("parses the manifest and returns it", async () => {
            helpers.mkdir(".autoproj");
            helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
            const manifest = await autoproj.loadWorkspaceInfo(root);
            assert.deepStrictEqual(manifest.packageSets.get("user/pkg/set/dir"), PKG_SET_OROCOS_TOOLCHAIN);
            assert.deepStrictEqual(manifest.packageSets.get("user/ros2/pkg/set/dir"), PKG_SET_ROS2_COMMON);
            assert.deepStrictEqual(manifest.packages.get("/path/to/tools/rest_api"), PKG_TOOLS_REST_API);
        });
        it("parses an empty manifest", async () => {
            helpers.mkdir(".autoproj");
            helpers.mkfile("", ".autoproj", "installation-manifest");
            const manifest = await autoproj.loadWorkspaceInfo(root);
            assert.equal(manifest.path, root);
            assert.equal(0, manifest.packages.size);
            assert.equal(0, manifest.packages.size);
        });
        it("throws if manifest cannot be read", async () => {
            helpers.mkdir(".autoproj");
            await helpers.assertThrowsAsync(autoproj.loadWorkspaceInfo(root), /ENOENT/);
        });
    });
    describe("WorkspaceInfo", () => {
        let wsInfo: autoproj.WorkspaceInfo;
        beforeEach(async () => {
            helpers.mkdir(".autoproj");
            helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
            let ws = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
            wsInfo = await ws.info();
        });
        describe("findPackageByPath", () => {
            it("finds package that contain a given file", () => {
                assert.deepStrictEqual(
                    wsInfo.findPackageByPath("/path/to/tools/rest_api/src/api.cpp"),
                    PKG_TOOLS_REST_API
                );
            });
            it("supports nested packages", () => {
                let pkg = wsInfo.findPackageByPath("/path/to/ctrl_toolbox/ct_core/src/core.cpp")
                assert.equal(pkg!.name, "ct_core");
            });
            it("handles packages without srcdir", () => {
                const pkg: autoproj.IPackage = {
                    name: "foo",
                    type: "Autobuild::CMake",
                    vcs: {
                        type: "git",
                        url: "git@myserver.com:/foo.git",
                        repository_id: "myserver:/foo.git"
                    },
                    srcdir: undefined!,
                    builddir: "/path/to/ws/build/foo",
                    logdir: "/path/to/ws/install/foo/log",
                    prefix: "/path/to/ws/install/foo",
                    dependencies: []
                }
                wsInfo.packages.set("/path/to/ws/src/foo", pkg);
                assert.doesNotThrow(() => wsInfo.findPackageByPath("/path/to/ws/src/foo"));
            });
        });
    });
    describe("Workspace", () => {
        describe("constructor", () => {
            it("starts the info loading by default", async () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const ws = new autoproj.Workspace(root);
                assert(ws.loadingInfo());
                await ws.info();
            });
            it("does not start the info loading if the loadInfo flag is false", () => {
                const ws = new autoproj.Workspace("path", false);
                assert(!ws.loadingInfo());
            });
        });
        describe("fromDir", () => {
            it("returns null when called outside a workspace", () => {
                helpers.mkdir(".autoproj");
                assert.equal(null, autoproj.Workspace.fromDir(root));
            });
            it("returns a Workspace object when called within a workspace", () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                assert(autoproj.Workspace.fromDir(root) instanceof autoproj.Workspace);
            });
            it("sets the workspace name using the folder's basename", () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const ws = autoproj.Workspace.fromDir(root) as autoproj.Workspace;
                assert.equal(path.basename(root), ws.name);
            });
        });
        describe("info", () => {
            it("returns a promise that gives access to the info", () => {
                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                const ws = autoproj.Workspace.fromDir(root) as autoproj.Workspace;
                return ws.info().then((manifest) => {
                    assert.deepStrictEqual(manifest.packageSets.get("user/pkg/set/dir"), PKG_SET_OROCOS_TOOLCHAIN);
                    assert.deepStrictEqual(manifest.packages.get("/path/to/tools/rest_api"), PKG_TOOLS_REST_API);
                });
            });
            it("creates and returns the promise if the constructor was not instructed to load it", () => {
                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                const ws = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
                return ws.info().then((manifest) => {
                    assert.deepStrictEqual(manifest.packageSets.get("user/pkg/set/dir"), PKG_SET_OROCOS_TOOLCHAIN);
                    assert.deepStrictEqual(manifest.packages.get("/path/to/tools/rest_api"), PKG_TOOLS_REST_API);
                });
            });
            it("does not re-resolve the info on each call", async () => {
                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                const workspace = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
                const promise = await workspace.info();
                const promise2 = await workspace.info();
                assert.equal(promise, promise2);
            });
            it("reloads the information on reload()", async () => {
                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                const workspace = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;
                const initial = await workspace.info();
                const reloaded = await workspace.reload();
                assert.notEqual(reloaded, initial);
                assert.equal(reloaded, await workspace.info());
            });
            it("triggers onInfoUpdated the first time the info is resolved", async () => {
                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                const workspace = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;

                let called = false;
                workspace.onInfoUpdated((callback) => called = true);
                await workspace.info();
                assert(called);
            });
            it("does not re-trigger onInfoUpdated on multiple info() calls", async () => {
                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                const workspace = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;

                await workspace.info();
                let called = false;
                workspace.onInfoUpdated((callback) => called = true);
                await workspace.info();
                assert(!called);
            });
            it("re-triggers onInfoUpdated on reload", async () => {
                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                const workspace = autoproj.Workspace.fromDir(root, false) as autoproj.Workspace;

                await workspace.info();
                let called = false;
                workspace.onInfoUpdated((callback) => called = true);
                await workspace.reload();
                assert(called);
            });
        });
    });
    describe("Workspaces", () => {
        let workspaces: autoproj.Workspaces;

        beforeEach(() => {
            workspaces = new autoproj.Workspaces();
        });

        describe("add", () => {
            it ("leaves the workspace name alone if no devFolder has been given", () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const ws = autoproj.Workspace.fromDir(root) as autoproj.Workspace;
                ws.name = "test";
                workspaces.add(ws);
                assert.equal("test", ws.name);
            });
            it ("sets the workspace name if devFolder is set", () => {
                workspaces.devFolder = root;
                const dir = helpers.mkdir("a");
                helpers.createInstallationManifest([], "a");
                const ws = autoproj.Workspace.fromDir(dir) as autoproj.Workspace;
                ws.name = "test";
                workspaces.add(ws);
                assert.equal("a", ws.name);
            });
        });

        describe("dispose", () => {
            it("disposes of all internal resources", async () => {
                const mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
                const mockDisposable = TypeMoq.Mock.ofType<vscode.Disposable>();
                const mockEventEmitter = TypeMoq.Mock.ofType<vscode.EventEmitter<any>>();
                const folderInfoDisposables = new Map<string, vscode.Disposable>();

                folderInfoDisposables.set("/one", mockDisposable.object);
                folderInfoDisposables.set("/two", mockDisposable.object);

                workspaces.workspaces.set("/one", mockWs.object);
                workspaces.workspaces.set("/two", mockWs.object);
                workspaces["_workspaceInfoEvent"] = mockEventEmitter.object;
                workspaces["_folderInfoEvent"] = mockEventEmitter.object;
                workspaces["_folderInfoDisposables"] = folderInfoDisposables;

                workspaces.dispose();
                mockWs.verify((x) => x.dispose(), TypeMoq.Times.exactly(2));
                mockDisposable.verify((x) => x.dispose(), TypeMoq.Times.exactly(2));
                mockEventEmitter.verify((x) => x.dispose(), TypeMoq.Times.exactly(2));
            });
        });

        describe("useCount", () => {
            // useCount nominal behavior is tested in addFolder/deleteFolder
            it ("ignores folders that are not part of the given workspace", () => {
                const s = new helpers.TestSetup();
                const ws1 = s.createAndRegisterWorkspace("ws1");
                const ws2 = s.createAndRegisterWorkspace("ws2");

                const a = s.workspaces.addFolder(path.join(ws1.ws.root, "pkg"));
                const b = s.workspaces.addFolder(path.join(ws2.ws.root, "pkg"));
                assert.equal(s.workspaces.useCount(ws1.ws), 1);
            });
        });

        describe("delete", () => {
            // delete's nominal behavior is tested in deleteFolder
            it ("throws if the workspace is in use", () => {
                const s = new helpers.TestSetup();
                const ws1 = s.createAndRegisterWorkspace("ws1");
                s.workspaces.addFolder(path.join(ws1.ws.root, "pkg"));
                assert.throws(() => { s.workspaces.delete(ws1.ws); }, /cannot remove a workspace that is in-use/);
            });
        });

        describe("addFolder", () => {
            it("does not add a folder that is not within an Autoproj workspace", () => {
                const dir = helpers.mkdir("a", "b");
                const workspace = workspaces.addFolder(dir);
                assert(!workspace.added);
                assert(!workspace.workspace);
            });
            it("adds folders that are within a workspace", () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const dir = helpers.mkdir("a", "b");
                let { workspace } = workspaces.addFolder(dir);
                workspace = workspace as autoproj.Workspace;
                assert.equal(workspace.root, root);
                assert.equal(1, workspaces.useCount(workspace));
            });
            it("adds the same workspace only once", () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const a = helpers.mkdir("a");
                const wsA = workspaces.addFolder(a);
                const b = helpers.mkdir("a", "b");
                const wsB = workspaces.addFolder(b);
                assert(wsA.added);
                assert(!wsB.added);
                assert.equal(wsA.workspace, wsB.workspace);
                assert.equal(2, workspaces.useCount(wsB.workspace as autoproj.Workspace));
            });
            it("forwards the workspace info updated event", async () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const dir = helpers.mkdir("a", "b");
                let { workspace } = workspaces.addFolder(dir);
                let called = false;
                workspaces.onWorkspaceInfo((info) => called = true);
                workspace = workspace as autoproj.Workspace;
                await workspace.reload();
                assert(called);
            });
            it("does not fire the package info event if the manifest has no data for it", async () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const dir = helpers.mkdir("a", "b");
                let { workspace } = workspaces.addFolder(dir);
                let called = false;
                workspaces.onFolderInfo((info) => called = true);
                workspace = workspace as autoproj.Workspace;
                await workspace.info();
                assert(!called);
            });
            it("fires the package info event if the manifest has data for it", async () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const dir = helpers.mkdir("a", "b");
                let { workspace } = workspaces.addFolder(dir);
                helpers.addPackageToManifest(workspace, ["a", "b"]);
                let received;
                workspaces.onFolderInfo((info) => received = info);
                workspace = workspace as autoproj.Workspace;
                await workspace.reload();
                assert(received);
                assert.equal(dir, received.srcdir);
            });
        });

        describe("deleteFolder", () => {
            it("does nothing for a folder that is not registered", () => {
                const dir = helpers.mkdir("a", "b");
                assert(!workspaces.deleteFolder(dir));
            });
            it("removes a registered folder", () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const dir = helpers.mkdir("a", "b");
                const { added, workspace } = workspaces.addFolder(dir);
                assert(workspaces.deleteFolder(dir));
                assert.equal(0, workspaces.useCount(workspace as autoproj.Workspace));
            });
            it("keeps a workspace until all the corresponding folders have been removed", () => {
                helpers.mkdir(".autoproj");
                helpers.createInstallationManifest([]);
                const a = helpers.mkdir("a");
                const { added, workspace } = workspaces.addFolder(a);
                const b = helpers.mkdir("a", "b");
                workspaces.addFolder(b);
                workspaces.deleteFolder(b);
                assert.equal(1, workspaces.useCount(workspace as autoproj.Workspace));
                workspaces.deleteFolder(a);
                assert.equal(0, workspaces.useCount(workspace as autoproj.Workspace));
            });
        });
        describe("isConfig", () => {
            beforeEach(() => {
                helpers.mkdir("one");
                helpers.mkdir("two");
                helpers.mkdir("one", ".autoproj");
                helpers.mkdir("two", ".autoproj");
                helpers.createInstallationManifest([], "one");
                helpers.createInstallationManifest([], "two");
            });
            it("returns true if the folder is a child of the workspace configuration", () => {
                const a = helpers.mkdir("one", "autoproj");
                const b = helpers.mkdir("one", "autoproj", "overrides.d");
                const c = helpers.mkdir("two", ".autoproj", "remotes");
                const ws = workspaces.addFolder(a);
                workspaces.addFolder(b);
                workspaces.addFolder(c);
                assert.equal(workspaces.isConfig(a), true);
                assert.equal(workspaces.isConfig(b), true);
                assert.equal(workspaces.isConfig(c), true);
            });
            it("returns false if the folder is not part of the workspace configuration", () => {
                const a = helpers.mkdir("one", "a");
                const b = helpers.mkdir("one", "b");
                const c = helpers.mkdir("two", "c");
                const ws = workspaces.addFolder(a);
                workspaces.addFolder(b);
                workspaces.addFolder(c);
                assert.equal(workspaces.isConfig(a), false);
                assert.equal(workspaces.isConfig(b), false);
                assert.equal(workspaces.isConfig(c), false);
            });
        });
        describe("forEachFolder", () => {
            it ("invokes the callback for each folder in the workspace", () => {
                const mockCallback = TypeMoq.Mock.ofType<(ws: autoproj.Workspace, folder: string) => void>();
                const s = new helpers.TestSetup();
                const ws1 = s.createAndRegisterWorkspace("ws1");
                const ws2 = s.createAndRegisterWorkspace("ws2");
                s.workspaces.addFolder(path.join(ws1.ws.root, "pkg"));
                s.workspaces.addFolder(path.join(ws2.ws.root, "pkg"));

                s.workspaces.forEachFolder((ws, folder) => { mockCallback.object(ws, folder); });
                mockCallback.verify((x) => x(TypeMoq.It.is((ws) => ws.root === ws1.ws.root),
                    path.join(ws1.ws.root, "pkg")), TypeMoq.Times.once());
                mockCallback.verify((x) => x(TypeMoq.It.is((ws) => ws.root === ws2.ws.root),
                    path.join(ws2.ws.root, "pkg")), TypeMoq.Times.once());
            });
        });
        describe("forEachWorkspace", () => {
            it ("invokes the callback for each registered workspace", () => {
                const mockCallback = TypeMoq.Mock.ofType<(ws: autoproj.Workspace) => void>();
                const s = new helpers.TestSetup();
                const ws1 = s.createAndRegisterWorkspace("ws1");
                const ws2 = s.createAndRegisterWorkspace("ws2");

                s.workspaces.forEachWorkspace((ws) => { mockCallback.object(ws); });
                mockCallback.verify((x) => x(TypeMoq.It.is((ws) => ws.root === ws1.ws.root)), TypeMoq.Times.once());
                mockCallback.verify((x) => x(TypeMoq.It.is((ws) => ws.root === ws2.ws.root)), TypeMoq.Times.once());
            });
        });
        describe("getWorkspaceFromFolder", () => {
            it ("returns the workspace that owns the package", () => {
                const s = new helpers.TestSetup();
                const ws1 = s.createAndRegisterWorkspace("ws1");
                s.workspaces.addFolder(path.join(ws1.ws.root, "pkg"));

                const ws = s.workspaces.getWorkspaceFromFolder(path.join(ws1.ws.root, "pkg"));
                assert.deepEqual(ws, ws1.ws);
            });
        });
        describe("getWorkspaceAndPackage", () => {
            let pkg: autoproj.IPackage;
            beforeEach(() => {
                pkg = new helpers.WorkspaceBuilder(root).addPackage("foobar");
                workspaces.addFolder(root);
            });
            it("returns the workspace and package file belongs to", async () => {
                const r = await workspaces.getWorkspaceAndPackage(
                    vscode.Uri.file(path.join(pkg.srcdir, "CMakeLists.txt")));

                assert(r);
                assert.deepEqual(pkg, r.package);
                assert.deepEqual(workspaces.folderToWorkspace.get(root), r.workspace);
            });
            it("throws if manifest cannot be read", async () => {
                helpers.mkfile("- bla: [", ".autoproj", "installation-manifest");

                const ws = workspaces.folderToWorkspace.get(root)!;
                await assert.rejects(
                    workspaces.getWorkspaceAndPackage(vscode.Uri.file(path.join(pkg.srcdir, "CMakeLists.txt"))),
                    new RegExp(`Could not load '${ws.name}' installation manifest`));
            });
        });
    });
});
