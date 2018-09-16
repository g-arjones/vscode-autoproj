import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { WorkspaceInfo } from "./info";

export function findWorkspaceRoot(rootPath: string): string | null {
    let lastPath = "";
    while (rootPath !== lastPath) {
        if (fs.existsSync(path.join(rootPath, ".autoproj", "installation-manifest"))) {
            return rootPath;
        }
        lastPath = rootPath;
        rootPath = path.dirname(rootPath);
    }
    return null;
}

export function autoprojExePath(workspacePath: string): string {
    return path.join(workspacePath, ".autoproj", "bin", "autoproj");
}
export function installationManifestPath(workspacePath: string): string {
    return path.join(workspacePath, ".autoproj", "installation-manifest");
}

export function loadWorkspaceInfo(workspacePath: string): Promise<WorkspaceInfo> {
    return new Promise<Buffer>((resolve, reject) => {
        fs.readFile(installationManifestPath(workspacePath), (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    }).then((data) => {
        let manifest = yaml.safeLoad(data.toString()) as any[];
        if (manifest === undefined) {
            manifest = [];
        }
        const packageSets = new Map();
        const packages = new Map();
        manifest.forEach((entry) => {
            if (entry.name) {
                packages.set(entry.srcdir, entry);
            } else {
                entry.name = entry.package_set;
                delete entry.package_set;
                packageSets.set(entry.user_local_dir, entry);
            }
        });
        return new WorkspaceInfo(workspacePath, packages, packageSets);
    });
}
