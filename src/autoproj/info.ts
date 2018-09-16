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

    public findPackageSet(path: string): IPackageSet | undefined {
        return this.packageSets.get(path);
    }

    public find(path: string): IPackage | IPackageSet | undefined {
        return this.findPackage(path) || this.findPackageSet(path);
    }
}
