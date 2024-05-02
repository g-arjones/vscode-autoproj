/**
 * Module for vscode-cpptools integration.
 *
 * This module uses the [vscode-cpptools API](https://www.npmjs.com/package/vscode-cpptools)
 * to provide that extension with per-file configuration information.
 */ /** */

import * as autoproj from "./autoproj";
import * as shlex from './cmt/shlex';
import * as util from './cmt/util';
import * as compilationDb from "./compilationDatabase";
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import { Version, getCppToolsApi, SourceFileConfigurationItem, SourceFileConfiguration } from 'vscode-cpptools';

type Architecture = 'x86' | 'x64' | 'arm' | 'arm64' | undefined;
type StandardVersion = "c89" | "c99" | "c11" | "c17" | "c++98" | "c++03" | "c++11" | "c++14" | "c++17" | "c++20" | "c++23" | "gnu89" | "gnu99" | "gnu11" | "gnu17" | "gnu++98" | "gnu++03" | "gnu++11" | "gnu++14" | "gnu++17" | "gnu++20" | "gnu++23" | undefined;
type IntelliSenseMode = "linux-clang-x86" | "linux-clang-x64" | "linux-clang-arm" | "linux-clang-arm64" | "linux-gcc-x86" | "linux-gcc-x64" | "linux-gcc-arm" | "linux-gcc-arm64" | "macos-clang-x86" | "macos-clang-x64" | "macos-clang-arm" | "macos-clang-arm64" | "macos-gcc-x86" | "macos-gcc-x64" | "macos-gcc-arm" | "macos-gcc-arm64" | "windows-clang-x86" | "windows-clang-x64" | "windows-clang-arm" | "windows-clang-arm64" | "windows-gcc-x86" | "windows-gcc-x64" | "windows-gcc-arm" | "windows-gcc-arm64" | "windows-msvc-x86" | "windows-msvc-x64" | "windows-msvc-arm" | "windows-msvc-arm64" | "msvc-x86" | "msvc-x64" | "msvc-arm" | "msvc-arm64" | "gcc-x86" | "gcc-x64" | "gcc-arm" | "gcc-arm64" | "clang-x86" | "clang-x64" | "clang-arm" | "clang-arm64" | undefined;

interface CompileFlagInformation {
    extraDefinitions: string[];
    standard?: StandardVersion;
    targetArch: Architecture;
}

function parseCppStandard(std: string, canUseGnu: boolean, canUseCxx23: boolean): StandardVersion {
    const isGnu = canUseGnu && std.startsWith('gnu');
    if (std.endsWith('++23') || std.endsWith('++2b') || std.endsWith('++latest')) {
        if (canUseCxx23) {
            return isGnu ? 'gnu++23' : 'c++23';
        } else {
            return isGnu ? 'gnu++20' : 'c++20';
        }
    } else if (std.endsWith('++20') || std.endsWith('++2a')) {
        return isGnu ? 'gnu++20' : 'c++20';
    } else if (std.endsWith('++17') || std.endsWith('++1z')) {
        return isGnu ? 'gnu++17' : 'c++17';
    } else if (std.endsWith('++14') || std.endsWith('++1y')) {
        return isGnu ? 'gnu++14' : 'c++14';
    } else if (std.endsWith('++11') || std.endsWith('++0x')) {
        return isGnu ? 'gnu++11' : 'c++11';
    } else if (std.endsWith('++03')) {
        return isGnu ? 'gnu++03' : 'c++03';
    } else if (std.endsWith('++98')) {
        return isGnu ? 'gnu++98' : 'c++98';
    } else {
        return undefined;
    }
}

function parseCStandard(std: string, canUseGnu: boolean): StandardVersion {
    // GNU options from: https://gcc.gnu.org/onlinedocs/gcc/C-Dialect-Options.html#C-Dialect-Options
    const isGnu = canUseGnu && std.startsWith('gnu');
    if (/(c|gnu)(90|89|iso9899:(1990|199409))/.test(std)) {
        return isGnu ? 'gnu89' : 'c89';
    } else if (/(c|gnu)(99|9x|iso9899:(1999|199x))/.test(std)) {
        return isGnu ? 'gnu99' : 'c99';
    } else if (/(c|gnu)(11|1x|iso9899:2011)/.test(std)) {
        return isGnu ? 'gnu11' : 'c11';
    } else if (/(c|gnu)(17|18|2x|iso9899:(2017|2018))/.test(std)) {
        if (canUseGnu) {
            // cpptools supports 'c17' in same version it supports GNU std.
            return isGnu ? 'gnu17' : 'c17';
        } else {
            return 'c11';
        }
    } else {
        return undefined;
    }
}

function parseTargetArch(target: string): Architecture {
    // Value of target param is lowercased.
    const isArm32: (value: string) => boolean = value => {
        // ARM verions from https://en.wikipedia.org/wiki/ARM_architecture#Cores
        if (value.indexOf('armv8-r') >= 0 || value.indexOf('armv8-m') >= 0) {
            return true;
        } else {
            // Check if ARM version is 7 or earlier.
            const verStr = value.substr(5, 1);
            const verNum = +verStr;
            return verNum <= 7;
        }
    };
    switch (target) {
        case '-m32':
        case 'i686':
            return 'x86';
        case '-m64':
        case 'amd64':
        case 'x86_64':
            return 'x64';
        case 'aarch64':
        case 'arm64':
            return 'arm64';
        case 'arm':
            return 'arm';
    }
    // Check triple target value
    if (target.indexOf('aarch64') >= 0 || target.indexOf('arm64') >= 0
        || target.indexOf('armv8-a') >= 0 || target.indexOf('armv8.') >= 0) {
        return 'arm64';
    } else if (target.indexOf('arm') >= 0 || isArm32(target)) {
        return 'arm';
    } else if (target.indexOf('i686') >= 0) {
        return 'x86';
    } else if (target.indexOf('amd64') >= 0 || target.indexOf('x86_64') >= 0) {
        return 'x64';
    }
    // TODO: add an allow list of architecture values and add telemetry
    return undefined;
}

function parseCompileFlags(cptVersion: cpptools.Version, args: string[], lang?: string): CompileFlagInformation {
    const requireStandardTarget = (cptVersion < cpptools.Version.v5);
    const canUseGnuStd = (cptVersion >= cpptools.Version.v4);
    const canUseCxx23 = (cptVersion >= cpptools.Version.v6);
    // No need to parse language standard for CppTools API v6 and above
    const extractStdFlag = (cptVersion < cpptools.Version.v6);
    const iter = args[Symbol.iterator]();
    const extraDefinitions: string[] = [];
    let standard: StandardVersion;
    let targetArch: Architecture;
    while (1) {
        const { done, value } = iter.next();
        if (done) {
            break;
        }
        const lower = value.toLowerCase();
        if (requireStandardTarget && (lower === '-m32' || lower === '-m64')) {
            targetArch = parseTargetArch(lower);
        } else if (requireStandardTarget && (lower.startsWith('-arch=') || lower.startsWith('/arch:'))) {
            const target = lower.substring(6);
            targetArch = parseTargetArch(target);
        } else if (requireStandardTarget && lower === '-arch') {
            const { done, value } = iter.next();
            if (done) {
                // TODO: add an allow list of architecture values and add telemetry
                continue;
            }
            targetArch = parseTargetArch(value.toLowerCase());
        } else if (requireStandardTarget && lower.startsWith('-march=')) {
            const target = lower.substring(7);
            targetArch = parseTargetArch(target);
        } else if (requireStandardTarget && lower.startsWith('--target=')) {
            const target = lower.substring(9);
            targetArch = parseTargetArch(target);
        } else if (requireStandardTarget && lower === '-target') {
            const { done, value } = iter.next();
            if (done) {
                // TODO: add an allow list of architecture values and add telemetry
                continue;
            }
            targetArch = parseTargetArch(value.toLowerCase());
        } else if (value === '-D' || value === '/D') {
            const { done, value } = iter.next();
            if (done) {
                console.error('Unexpected end of parsing command line arguments');
                continue;
            }
            extraDefinitions.push(value);
        } else if (value.startsWith('-D') || value.startsWith('/D')) {
            const def = value.substring(2);
            extraDefinitions.push(def);
        } else if (extractStdFlag && (value.startsWith('-std=') || lower.startsWith('-std:') || lower.startsWith('/std:'))) {
            const std = value.substring(5);
            if (lang === 'CXX' || lang === 'OBJCXX' || lang === 'CUDA') {
                const s = parseCppStandard(std, canUseGnuStd, canUseCxx23);
                if (!s) {
                    console.warn(`Unknown C++ standard control flag: ${value}`);
                } else {
                    standard = s;
                }
            } else if (lang === 'C' || lang === 'OBJC') {
                const s = parseCStandard(std, canUseGnuStd);
                if (!s) {
                    console.warn('unknown.control.gflag.c', 'Unknown C standard control flag: {0}', value);
                } else {
                    standard = s;
                }
            } else if (lang === undefined) {
                let s = parseCppStandard(std, canUseGnuStd, canUseCxx23);
                if (!s) {
                    s = parseCStandard(std, canUseGnuStd);
                }
                if (!s) {
                    console.warn(`Unknown standard control flag: ${value}`);
                } else {
                    standard = s;
                }
            } else {
                console.warn(`Unknown language: ${lang}`);
            }
        }
    }
    if (!standard && requireStandardTarget && extractStdFlag) {
        standard = (lang === 'C') ? 'c11' : 'c++17';
    }
    return { extraDefinitions, standard, targetArch };
}

/**
 * Determine the IntelliSenseMode based on hints from compiler path
 * and target architecture parsed from compiler flags.
 */
function getIntelliSenseMode(cptVersion: cpptools.Version, compilerPath: string, targetArch: Architecture) {
    if (cptVersion >= cpptools.Version.v5 && targetArch === undefined) {
        // IntelliSenseMode is optional for CppTools v5+ and is determined by CppTools.
        return undefined;
    }
    const canUseArm = (cptVersion >= cpptools.Version.v4);
    const compilerName = path.basename(compilerPath || "").toLocaleLowerCase();
    if (compilerName === 'cl.exe') {
        const clArch = path.basename(path.dirname(compilerPath)).toLocaleLowerCase();
        switch (clArch) {
            case 'arm64':
                return canUseArm ? 'msvc-arm64' : 'msvc-x64';
            case 'arm':
                return canUseArm ? 'msvc-arm' : 'msvc-x86';
            case 'x86':
                return 'msvc-x86';
            case 'x64':
            default:
                return 'msvc-x64';
        }
    } else if (compilerName.indexOf('armclang') >= 0) {
        switch (targetArch) {
            case 'arm64':
                return canUseArm ? 'clang-arm64' : 'clang-x64';
            case 'arm':
            default:
                return canUseArm ? 'clang-arm' : 'clang-x86';
        }
    } else if (compilerName.indexOf('clang') >= 0) {
        switch (targetArch) {
            case 'arm64':
                return canUseArm ? 'clang-arm64' : 'clang-x64';
            case 'arm':
                return canUseArm ? 'clang-arm' : 'clang-x86';
            case 'x86':
                return 'clang-x86';
            case 'x64':
            default:
                return 'clang-x64';
        }
    } else if (compilerName.indexOf('aarch64') >= 0) {
        // Compiler with 'aarch64' in its name may also have 'arm', so check for
        // aarch64 compilers before checking for ARM specific compilers.
        return canUseArm ? 'gcc-arm64' : 'gcc-x64';
    } else if (compilerName.indexOf('arm') >= 0) {
        return canUseArm ? 'gcc-arm' : 'gcc-x86';
    } else if (compilerName.indexOf('gcc') >= 0 || compilerName.indexOf('g++') >= 0) {
        switch (targetArch) {
            case 'x86':
                return 'gcc-x86';
            case 'x64':
                return 'gcc-x64';
            case 'arm64':
                return canUseArm ? 'gcc-arm64' : 'gcc-x64';
            case 'arm':
                return canUseArm ? 'gcc-arm' : 'gcc-x86';
            default:
                return 'gcc-x64';
        }
    } else {
        // unknown compiler; pick platform defaults.
        if (process.platform === 'win32') {
            return 'msvc-x64';
        } else if (process.platform === 'darwin') {
            return 'clang-x64';
        } else {
            return 'gcc-x64';
        }
    }
}

/**
 * The actual class that provides information to the cpptools extension. See
 * the `CustomConfigurationProvider` interface for information on how this class
 * should be used.
 */
export class CppConfigurationProvider implements cpptools.CustomConfigurationProvider {
    readonly name = "Autoproj";
    readonly extensionId = "arjones.autoproj"

    private _pathToCompilationDb: Map<string, compilationDb.CompilationDatabase>;
    private _workspaces: autoproj.Workspaces;
    private _cppToolsApi: cpptools.CppToolsApi | undefined;

    constructor(workspaces: autoproj.Workspaces) {
        this._workspaces = workspaces;
        this._pathToCompilationDb = new Map<string, compilationDb.CompilationDatabase>();
    }

    async register(): Promise<boolean> {
        this._cppToolsApi = await getCppToolsApi(Version.v6);
        if (this._cppToolsApi) {
            if (this._cppToolsApi.notifyReady) {
                this._cppToolsApi.registerCustomConfigurationProvider(this);
                this._cppToolsApi.notifyReady(this);
            } else {
                this._cppToolsApi.registerCustomConfigurationProvider(this);
                this._cppToolsApi.didChangeCustomConfiguration(this);
            }
            return true;
        }
        return false;
    }

    notifyChanges() {
        this._removeOrphanedDbs();

        if (this._cppToolsApi) {
            this._cppToolsApi.didChangeCustomBrowseConfiguration(this);
            this._cppToolsApi.didChangeCustomConfiguration(this);
        }
    }

    async canProvideConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken) {
        return true;
    }

    async provideConfigurations(uris: vscode.Uri[], token?: vscode.CancellationToken) {
        this._removeOrphanedDbs();
        if (this._workspaces.workspaces.size == 0) {
            return [];
        }

        const itemPromises = new Array<Promise<SourceFileConfigurationItem | undefined>>();
        for (const uri of uris) {
            itemPromises.push(this.getSourceFileConfigurationItem(uri));
        }

        // Process all promises concurrently
        return util.dropNulls(await Promise.all(itemPromises));
    }

    async canProvideBrowseConfiguration(token?: vscode.CancellationToken) {
        return false;
    }

    async provideBrowseConfiguration(token?: vscode.CancellationToken) {
        return null;
    }

    async canProvideBrowseConfigurationsPerFolder(token?: vscode.CancellationToken) {
        return false;
    }

    async provideFolderBrowseConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken) {
        return null;
    }

    clearDbs() {
        for (const db of this._pathToCompilationDb.values()) {
            db.dispose();
        }

        this._pathToCompilationDb.clear();
    }

    private _removeOrphanedDbs() {
        // TODO: Remove dbs that don't belong to any package currently
        // in any of the workspace (sub-)folders
    }

    async getCompilationDb(path: string): Promise<compilationDb.CompilationDatabase> {
        let db = this._pathToCompilationDb.get(path);
        if (db) {
            if (!db.loaded && (await db.exists())) {
                await db.load();
            }
            return db;
        } else {
            db = new compilationDb.CompilationDatabase(path);
            db.onChange((db) => this.notifyChanges());

            if (await db.exists()) {
                await db.load();
            }
            this._pathToCompilationDb.set(path, db);
        }
        return db;
    }

    async getSourceFileConfigurationItem(uri: vscode.Uri): Promise<SourceFileConfigurationItem | undefined> {
        let db: compilationDb.CompilationDatabase | undefined;
        for (const ws of this._workspaces.workspaces.values()) {
            let wsInfo = await ws.info();
            let pkg = wsInfo.findPackageByPath(uri.fsPath);
            if (pkg && pkg.builddir) {
                let db_path = path.join(pkg.builddir, "compile_commands.json");
                db = await this.getCompilationDb(db_path);

                let info = db.get(uri.fsPath);
                if (!info) {
                    break;
                }

                let args = info.arguments;
                if (args && args.length > 0) {
                    return {
                        uri: uri,
                        configuration: this.getSourceFileConfiguration(args)
                    };
                }
            }
        }
    }

    getSourceFileConfiguration(command: string[]): SourceFileConfiguration {
        const getAsFlags = (fragments?: string[]) => {
            if (!fragments) {
                return [];
            }
            return [...util.flatMap(fragments, fragment => shlex.split(fragment))];
        };

        command = new Array<string>(...command);  // copy to avoid changing the compilation db
        const compilerPath = util.platformNormalizePath(command.shift()!);
        const compilerFragments = getAsFlags(command);
        const compilerFlags = parseCompileFlags(this._cppToolsApi!.getVersion(), compilerFragments);
        const intelliSenseMode = getIntelliSenseMode(this._cppToolsApi!.getVersion(), compilerPath, compilerFlags.targetArch);
        const configuration: SourceFileConfiguration = {
            compilerPath: compilerPath,
            standard: compilerFlags.standard,
            intelliSenseMode: intelliSenseMode as IntelliSenseMode || undefined,
            includePath: [],
            defines: [],
            compilerFragments: compilerFragments
        }
        return configuration;
    }

    dispose() {
        if (this._cppToolsApi) {
            this._cppToolsApi.dispose();
        }
        this.clearDbs();
    }
}