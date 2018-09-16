import { EventEmitter } from "events";

export interface IProcess extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill(signal: string): void;
}

export interface IOutputChannel {
    appendLine(text: string): void;
}

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
}
