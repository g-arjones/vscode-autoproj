export interface IVCS {
    type: string;
    url: string;
    repository_id: string;
}

export interface IPackage {
    name: string;
    type: string;
    vcs: IVCS;
    srcdir: string;
    builddir: string;
    logdir: string;
    prefix: string;
    dependencies: string[];
}

export interface IPackageSet {
    name: string;
    vcs: IVCS;
    raw_local_dir: string;
    user_local_dir: string;
    package_set: string;
}
