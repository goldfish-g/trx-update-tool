// The engine a game shipped with, by the version its executable states. The
// file classifier keeps what it found in the game's directory, so that the
// steps after it know which engine the game was made for without the
// archive itself.

import type { MappedFile } from './types.ts';

/** Where the file classifier keeps the version, inside the game's directory. */
export const ENGINE_FILE = '_meta/engine.json';

function findBytes(data: Uint8Array, needle: Uint8Array, from = 0): number {
    const first = needle[0];
    outer: for (let i = data.indexOf(first, from); i >= 0 && i <= data.length - needle.length; i = data.indexOf(first, i + 1)) {
        for (let j = 1; j < needle.length; j++) {
            if (data[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

function utf16(text: string): Uint8Array {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) out[i * 2] = text.charCodeAt(i);
    return out;
}

/**
 * The version a Windows executable states in its version resource, such as
 * "TRX 1.11.1" or "TR1X 4.15.1", or null.
 */
export function executableVersion(data: Uint8Array): string | null {
    for (const field of ['ProductVersion', 'FileVersion']) {
        const at = findBytes(data, utf16(field + '\0'));
        if (at < 0) continue;
        // The value follows, aligned to four bytes.
        let i = at + (field.length + 1) * 2;
        while (i < data.length - 1 && data[i] === 0 && data[i + 1] === 0) i += 2;
        let value = '';
        while (i < data.length - 1 && (data[i] !== 0 || data[i + 1] !== 0) && value.length < 64) {
            value += String.fromCharCode(data[i] | (data[i + 1] << 8));
            i += 2;
        }
        if (/\d+\.\d+/.test(value)) return value.trim();
    }
    return null;
}

/**
 * The TRX 1.x release a version names, or null for another engine. A build
 * from before TRX 1.0, such as "TRX 0.0-18-g3cde9d3", reads the files a TRX
 * 1.0 game has, so it counts as 1.0; one past the last release this
 * converter knows counts as that last one.
 */
export function trxRelease(version: string, current: number): number | null {
    const trx = /^TRX\s+v?(\d+)\.(\d+)/i.exec(version);
    if (!trx) return null;
    const major = +trx[1];
    const minor = +trx[2];
    if (major === 0) return 0;
    return major === 1 ? Math.min(minor, current) : current;
}

/** The engines' own executables, which a launcher such as PLAY.exe may sit beside. */
const ENGINE_EXE = /(?:^|\/)(?:trx|tr[123]x|tomb[123]main)\.exe$/i;

/**
 * The version of the engine's executable, or else of the first executable
 * among the files that states one.
 */
export function archiveEngine(entries: readonly MappedFile[]): string | null {
    const exes = entries.filter((entry) => entry.path.toLowerCase().endsWith('.exe'));
    for (const entry of [...exes.filter((e) => ENGINE_EXE.test(e.path)), ...exes.filter((e) => !ENGINE_EXE.test(e.path))]) {
        const version = executableVersion(entry.data);
        if (version !== null) return version;
    }
    return null;
}

/** The version the file classifier found, from the game's directory. */
export function recordedEngine(files: readonly MappedFile[], prefix: string): string | null {
    const file = files.find((f) => f.path === prefix + ENGINE_FILE);
    if (!file) return null;
    try {
        const doc = JSON.parse(new TextDecoder().decode(file.data)) as { version?: unknown };
        return typeof doc.version === 'string' ? doc.version : null;
    } catch {
        return null;
    }
}
