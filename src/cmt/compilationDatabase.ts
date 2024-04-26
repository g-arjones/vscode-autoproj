import * as shlex from './shlex';
import { fs } from './pr';
import * as util from './util';


export interface CompileCommand {
    directory: string;
    file: string;
    output?: string;
    command: string; // The command string includes both commands and arguments (if any).
    arguments?: string[];
}

export class CompilationDatabase {
    private readonly infoByFilePath: Map<string, CompileCommand>;
    constructor(infos: CompileCommand[]) {
        this.infoByFilePath = infos.reduce(
            (acc, cur) => acc.set(util.platformNormalizePath(cur.file), {
                directory: cur.directory,
                file: cur.file,
                output: cur.output,
                command: cur.command,
                arguments: cur.arguments ? cur.arguments : [...shlex.split(cur.command)]
            }),
            new Map<string, CompileCommand>()
        );
    }

    get(fsPath: string) {
        return this.infoByFilePath.get(util.platformNormalizePath(fsPath));
    }

    public static async fromFilePaths(databasePaths: string[]): Promise<CompilationDatabase | null> {
        const database: CompileCommand[] = [];

        for (const path of databasePaths) {
            if (!await fs.exists(path)) {
                continue;
            }

            const fileContent = await fs.readFile(path);
            try {
                const content = JSON.parse(fileContent.toString()) as CompileCommand[];
                database.push(...content);
            } catch (e) {
                console.warn('Error parsing compilation database {0}: {1}', `"${path}"`, util.errorToString(e));
                return null;
            }
        }

        if (database.length > 0) {
            return new CompilationDatabase(database);
        }

        return null;
    }

    public static toJson(database: CompilationDatabase | null): string {
        if (database === null) {
            return '[]';
        }

        return JSON.stringify([...database.infoByFilePath.values()].map(({ file, command, directory }) => ({ file, command, directory })));
    }
}