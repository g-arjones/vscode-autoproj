import * as util from '../cmt/util';
import { IPackage, IPackageSet } from "./interface";

export class WorkspaceInfo {
    public path: string;
    public packages: Map<string, IPackage>;
    public packageSets: Map<string, IPackageSet>;

    constructor(
            path: string,
            packages: Map<string, IPackage> = new Map<string, IPackage>(),
            packageSets: Map<string, IPackageSet> = new Map<string, IPackageSet>()) {
        this.path = path;
        this.packages = packages;
        this.packageSets = packageSets;
    }

    public findPackage(path: string): IPackage | undefined {
        return this.packages.get(path);
    }

    public findPackageByPath(filePath: string): IPackage | undefined {
        filePath = util.platformNormalizePath(filePath);
        const parentPkgs = (pkg: IPackage) => {
            if (pkg.srcdir) {
                return filePath.startsWith(util.platformNormalizePath(pkg.srcdir));
            } else {
                return false;
            }
        }

        // autoproj does not support nested packages
        // natively but users may hack it
        let packages = [...this.packages.values()].filter(parentPkgs);
        packages.sort((a, b) => b.srcdir.length - a.srcdir.length);
        return packages[0];
    }

    public findPackageSet(path: string): IPackageSet | undefined {
        return this.packageSets.get(path);
    }

    public find(path: string): IPackage | IPackageSet | undefined {
        return this.findPackage(path) || this.findPackageSet(path);
    }
}
