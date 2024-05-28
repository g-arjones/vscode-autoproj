import * as autoproj from "./autoproj";
import * as path from "path";
import * as vscode from "vscode";
import { dropNulls } from "./cmt/util";
import { isSubdirOf } from "./util";
import { BundleManager } from "./bundleWatcher";
import { ShimsWriter } from "./shimsWriter";
import { fs } from "./cmt/pr";

export class ConfigManager {
    private _shimsWriter: ShimsWriter;

    constructor(private _bundleManager: BundleManager, private _workspaces: autoproj.Workspaces) {
        this._shimsWriter = new ShimsWriter();
    }

    public onWorkspaceRemoved(workspace: autoproj.Workspace) {
        this._bundleManager.unwatch(workspace);
    }

    public async setupExtension() {
        if (this._workspaces.workspaces.size == 0) {
            return;
        }

        if (this._workspaces.workspaces.size > 1) {
            vscode.window.showErrorMessage("Working on multiple Autoproj workspaces is not supported");
            return;
        }

        if (!vscode.workspace.workspaceFile) {
            vscode.window.showWarningMessage(
                "You must save your workspace for the Autoproj extension to work properly");
            return;
        }

        await this.writeShims();

        this.setupTestMate();
        await this.setupPythonExtension();
        await this.setupRubyExtension();
    }

    public async setupPythonExtension() {
        const workspace = [...this._workspaces.workspaces.values()][0];
        if (!await fs.exists(path.join(workspace.root, ".autoproj", "bin", "python"))) {
            return;
        }

        const pythonShimPath = path.join(workspace.root, ShimsWriter.RELATIVE_SHIMS_PATH, "python");
        vscode.workspace.getConfiguration().update("python.defaultInterpreterPath", pythonShimPath);

        const experiments = vscode.workspace.getConfiguration("python.experiments");
        const optOutFrom = experiments.get<string[]>("optOutFrom") || [];

        experiments.update("optOutFrom", [...new Set([...optOutFrom, "pythonTestAdapter"])],
            vscode.ConfigurationTarget.Global);
    }

    public setupTestMate() {
        const testMateConfig = vscode.workspace.getConfiguration("testMate.cpp.test");
        testMateConfig.update("executables", "");
    }

    public async setupRubyExtension() {
        const workspace = [...this._workspaces.workspaces.values()][0];
        const bundle = this._bundleManager.getWatcher(workspace);

        if (await fs.exists(bundle.extensionGemfile)) {
            await bundle.check();
        } else if (await bundle.queueInstall() === 0) {
            const shimsPath = path.join(workspace.root, ShimsWriter.RELATIVE_SHIMS_PATH);

            vscode.workspace.getConfiguration("rubyLsp").update("rubyVersionManager.identifier", "custom");
            vscode.workspace.getConfiguration("rubyLsp").update("customRubyCommand", `PATH=${shimsPath}:$PATH`);
            vscode.workspace.getConfiguration("rubyLsp").update("bundleGemfile", bundle.extensionGemfile);
        }
    }

    public async writeShims() {
        const workspace = [...this._workspaces.workspaces.values()][0];

        try {
            await this._shimsWriter.writeOpts(workspace);
            await this._shimsWriter.writePython(workspace);
            await this._shimsWriter.writeGdb(workspace);
            await this._shimsWriter.writeRuby(workspace);
        } catch (err) {
            await vscode.window.showErrorMessage(`Could not create file: ${err.message}`);
        }
    }

    public async cleanupTestMate() {
        if (this._workspaces.workspaces.size == 0) {
            return;
        }

        let builddirs = dropNulls((await this._workspaces.getPackagesInCodeWorkspace()).map((i) => i.package.builddir));

        const testMateConfig = vscode.workspace.getConfiguration("testMate.cpp.test");
        let advancedExecutables = testMateConfig.get<any[]>("advancedExecutables") || [];

        advancedExecutables = advancedExecutables.filter((executable) => {
            return builddirs.some((builddir) => isSubdirOf(executable.pattern, builddir))
        })

        advancedExecutables.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        testMateConfig.update("advancedExecutables", advancedExecutables)
    }
}