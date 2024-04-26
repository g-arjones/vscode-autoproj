import * as path from 'path';


/**
 * Escape a string so it can be used as a regular expression
 */
export function escapeStringForRegex(str: string): string {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}

/**
 * Replace all occurrences of `needle` in `str` with `what`
 * @param str The input string
 * @param needle The search string
 * @param what The value to insert in place of `needle`
 * @returns The modified string
 */
export function replaceAll(str: string, needle: string, what: string) {
    const pattern = escapeStringForRegex(needle);
    const re = new RegExp(pattern, 'g');
    return str.replace(re, what);
}

type NormalizationSetting = 'always' | 'never' | 'platform';
interface PathNormalizationOptions {
    normCase?: NormalizationSetting;
    normUnicode?: NormalizationSetting;
}

/**
 * Completely normalize/canonicalize a path.
 * Using `path.normalize` isn't sufficient. We want convert all paths to use
 * POSIX separators, remove redundant separators, and sometimes normalize the
 * case of the path.
 *
 * @param p The input path
 * @param opt Options to control the normalization
 * @returns The normalized path
 */
export function normalizePath(p: string, opt: PathNormalizationOptions): string {
    const normCase: NormalizationSetting = opt ? opt.normCase ? opt.normCase : 'never' : 'never';
    const normUnicode: NormalizationSetting = opt ? opt.normUnicode ? opt.normUnicode : 'never' : 'never';
    let norm = path.normalize(p);
    while (path.sep !== path.posix.sep && norm.includes(path.sep)) {
        norm = norm.replace(path.sep, path.posix.sep);
    }
    // Normalize for case an unicode
    switch (normCase) {
        case 'always':
            norm = norm.toLocaleLowerCase();
            break;
        case 'platform':
            if (process.platform === 'win32' || process.platform === 'darwin') {
                norm = norm.toLocaleLowerCase();
            }
            break;
        case 'never':
            break;
    }
    switch (normUnicode) {
        case 'always':
            norm = norm.normalize();
            break;
        case 'platform':
            if (process.platform === 'darwin') {
                norm = norm.normalize();
            }
            break;
        case 'never':
            break;
    }
    // Remove trailing slashes
    norm = norm.replace(/\/$/g, '');
    // Remove duplicate slashes
    while (norm.includes('//')) {
        norm = replaceAll(norm, '//', '/');
    }
    return norm;
}

export function platformNormalizePath(p: string): string {
    return normalizePath(p, { normCase: 'platform', normUnicode: 'platform' });
}

export function* flatMap<In, Out>(rng: Iterable<In>, fn: (item: In) => Iterable<Out>): Iterable<Out> {
    for (const elem of rng) {
        const mapped = fn(elem);
        for (const other_elem of mapped) {
            yield other_elem;
        }
    }
}

/**
 * Get the first non-empty item from an object that produces arrays of objects.
 */
export function first<In, Out>(array: Iterable<In>, fn: (item: In) => Out[]): Out[] {
    for (const item of array) {
        const result = fn(item);
        if (result?.length > 0) {
            return result;
        }
    }
    return [];
}

export function dropNulls<T>(items: (T | null | undefined)[]): T[] {
    return items.filter(item => (item !== null && item !== undefined)) as T[];
}

export enum Ordering {
    Greater,
    Equivalent,
    Less,
}

export function errorToString(e: any): string {
    if (e.stack) {
        // e.stack has both the message and the stack in it.
        return `\n\t${e.stack}`;
    }
    return `\n\t${e.toString()}`;
}
