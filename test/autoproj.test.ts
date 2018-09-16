"use strict";
import * as assert from "assert";
import * as path from "path";
import * as TypeMoq from "typemoq";
import * as autoproj from "../src/autoproj";
import * as helpers from "./helpers";

async function assertProcessIsShown(shortname, cmd, promise, subprocess, channel) {
    subprocess.stdout.emit("data", "STDOUT");
    subprocess.stderr.emit("data", "STDERR");
    subprocess.emit("exit", 0, undefined);
    try {
        await promise;
    } catch (e) {
        // no-op
    }
    const expected = [
        `${shortname}: starting ${cmd}`,
        `${shortname}: STDOUT`,
        `${shortname}: STDERR`,
        `${shortname}: ${cmd} quit`,
    ];
    assert.deepStrictEqual(channel.receivedLines, expected);
}

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

    const MANIFEST_TEST_FILE = `
- package_set: orocos.toolchain
  vcs:
    type: git
    url: https://github.com/orocos-toolchain/autoproj.git
    repository_id: github:/orocos-toolchain/autoproj.git
  raw_local_dir: raw/pkg/set/dir
  user_local_dir: user/pkg/set/dir
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

    describe("loadWorkspaceInfo", () => {
        it("parses the manifest and returns it", async () => {
            helpers.mkdir(".autoproj");
            helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
            const manifest = await autoproj.loadWorkspaceInfo(root);
            assert.deepStrictEqual(manifest.packageSets.get("user/pkg/set/dir"), PKG_SET_OROCOS_TOOLCHAIN);
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
                const initial  = await workspace.info();
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

        describe("envsh", () => {
            const processMock   = helpers.createProcessMock();
            let outputChannel: helpers.OutputChannel;
            let subjectMock;
            let subject;
            let originalInfo;

            beforeEach(async () => {
                require("child_process").spawn = (...args) => processMock;

                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                outputChannel = new helpers.OutputChannel();
                subjectMock = TypeMoq.Mock.ofType2(autoproj.Workspace, [root, false, outputChannel]);
                subject = subjectMock.target;
                originalInfo = await subject.info();
            });

            afterEach(async () => {
                await subject.info();
            });

            it("reloads the information on success", async () => {
                const p = subject.envsh();
                processMock.emit("exit", 0, null);
                assert.notEqual(await p, originalInfo);
            });

            it("returns the known information on failure", async () => {
                const p = subject.envsh();
                processMock.emit("exit", 1, null);
                assert.equal(await p, originalInfo);
            });

            it("returns the known information on signal", async () => {
                const p = subject.envsh();
                processMock.emit("exit", null, 5);
                assert.equal(await p, originalInfo);
            });

            it("redirects its output to the rock channel", async () => {
                const p = subject.envsh();
                await assertProcessIsShown("envsh", "autoproj envsh", p, processMock, outputChannel);
            });
        });

        describe("which", () => {
            const processMock = helpers.createProcessMock();
            let outputChannel: helpers.OutputChannel;
            let subject;

            beforeEach(async () => {
                const spawn = (...args) => processMock;
                require("child_process").spawn = spawn;

                helpers.mkdir(".autoproj");
                helpers.mkfile(MANIFEST_TEST_FILE, ".autoproj", "installation-manifest");
                outputChannel = new helpers.OutputChannel();
                subject = autoproj.Workspace.fromDir(root, false, outputChannel) as autoproj.Workspace;
            });

            it("returns the path displayed by autoproj on success", async () => {
                const p = subject.which("cmd");
                processMock.stdout.emit("data", "/test/cmd\n");
                processMock.emit("exit", 0, null);
                assert.equal("/test/cmd", await p);
            });

            it("concatenates the data if received in chunks", async () => {
                const p = subject.which("cmd");
                processMock.stdout.emit("data", "/te");
                processMock.stdout.emit("data", "st/cmd\n");
                processMock.emit("exit", 0, null);
                assert.equal("/test/cmd", await p);
            });

            it("rejects the promise on failure", async () => {
                const p = subject.which("cmd");
                processMock.emit("exit", 1, null);
                await helpers.assertThrowsAsync(p,
                    /cannot find cmd in the workspace/);
            });

            it("redirects its output to the rock channel", async () => {
                const p = subject.which("cmd");
                await assertProcessIsShown("which cmd", "autoproj which cmd", p, processMock, outputChannel);
            });
        });

        describe("readWatchPID", () => {
            let workspace: autoproj.Workspace;

            beforeEach(async () => {
                const setup = new helpers.TestSetup();
                const { mock, ws } = setup.createAndRegisterWorkspace("ws");
                workspace = ws;
            });
            it ("errors if the watch file does not exist", async () => {
                await helpers.assertThrowsAsync(workspace.readWatchPID(),
                    new RegExp("^ENOENT: no such file or directory"));
            });
            it ("errors if the watch file is empty", async () => {
                helpers.mkfile("", "ws", ".autoproj", "watch");
                await helpers.assertThrowsAsync(workspace.readWatchPID(),
                    new RegExp(`^invalid watch PID file$`));
            });
            it ("returns the PID if the file contains a number", async () => {
                helpers.mkfile("1234", "ws", ".autoproj", "watch");
                assert.strictEqual(1234, await workspace.readWatchPID());
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
    });
});
