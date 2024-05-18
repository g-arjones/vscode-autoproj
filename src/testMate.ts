import * as vscode from "vscode";
import * as autoproj from "./autoproj";
import { dropNulls } from "./cmt/util";
import { isSubdirOf } from "./util";

export async function cleanupExecutables(workspaces: autoproj.Workspaces) {
    if (workspaces.workspaces.size == 0) {
        return;
    }

    let builddirs = dropNulls((await workspaces.getPackagesInCodeWorkspace()).map((i) => i.package.builddir));

    const testMateConfig = vscode.workspace.getConfiguration("testMate.cpp.test");
    let advancedExecutables = testMateConfig.get<any[]>("advancedExecutables") || [];

    advancedExecutables = advancedExecutables.filter((executable) => {
        return builddirs.some((builddir) => isSubdirOf(executable.pattern, builddir))
    })

    testMateConfig.update("advancedExecutables", advancedExecutables)
}