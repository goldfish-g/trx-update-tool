// Brings a game made for an older TRX up to date with the current one, as
// TRX's migration guide (docs/trx/MIGRATING.md) describes: its scripts reach
// the API of the release they were written for through a compatibility
// module (lua.ts), and the names its data files use are updated here.

import { CURRENT_RELEASE, detectRelease, migrateScripts } from './lua.ts';
import { OBJECT_KEYS, OBJECT_SYMBOLS } from './renames.generated.ts';
import type { MappedFile } from './types.ts';

export type MigrationResult = {
    files: MappedFile[];
    // What changed, for the person converting.
    notes: string[];
};

export type MigrationOptions = {
    modDir: string;
    gameVersion: number;
    // The archive as uploaded, whose engine says which TRX it ran on.
    upload: MappedFile[];
};

// The catalog names objects by key, and once by their C symbol.
const SYMBOL_KEYS: Record<string, string> = {};
for (const was in OBJECT_SYMBOLS) {
    SYMBOL_KEYS[was.replace(/^O_/, '').toLowerCase()] =
        OBJECT_SYMBOLS[was].replace(/^O_/, '').toLowerCase();
}

function currentKey(key: string): string {
    const lower = key.toLowerCase();
    const now = OBJECT_KEYS[lower] ?? SYMBOL_KEYS[lower];
    if (now === undefined) return key;
    return key === key.toUpperCase() ? now.toUpperCase() : now;
}

// Game flows and strings name objects by key.
function migrateJson5(text: string): string {
    return text
        .replace(/("object_id"\s*:\s*")(\w+)(")/g, (_m, a: string, key: string, b: string) => a + currentKey(key) + b)
        .replace(/("objects\/)(\w+)(\/)/g, (_m, a: string, key: string, b: string) => a + currentKey(key) + b);
}

// Catalogs list objects by their C symbol.
function migrateCatalog(text: string): string {
    return text.replace(/\bO_\w+\b/g, (symbol) => OBJECT_SYMBOLS[symbol] ?? symbol);
}

export function migrateToCurrentTRX(files: MappedFile[], options: MigrationOptions): MigrationResult {
    const notes: string[] = [];
    const guess = detectRelease(options.upload, files);
    if (guess.release !== null && guess.release < CURRENT_RELEASE) {
        notes.push(`Made for TRX 1.${guess.release} (from ${guess.from}).`);
    }

    const scripts = migrateScripts(files, options.modDir, options.gameVersion, guess.release);
    notes.push(...scripts.notes);

    // TRX 1.11 renamed objects; a file written since uses the new names.
    const renamesApply = guess.release !== null && guess.release <= 10;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let changed = 0;
    const out: MappedFile[] = [];
    for (const file of scripts.files) {
        const path = file.path.toLowerCase();
        // Working files of the converter's own.
        if (/^games\/[^/]+\/(_meta|_loose)\//.test(path)) continue;
        let migrate: ((text: string) => string) | null = null;
        if (renamesApply && path.endsWith('.json5')) migrate = migrateJson5;
        else if (renamesApply && /catalog_objects\.csv$/.test(path)) migrate = migrateCatalog;
        if (migrate === null) {
            out.push(file);
            continue;
        }
        const text = decoder.decode(file.data);
        const migrated = migrate(text);
        if (migrated === text) {
            out.push(file);
            continue;
        }
        changed++;
        out.push({ path: file.path, data: encoder.encode(migrated) });
    }
    if (changed > 0) {
        notes.push(`Renamed the objects TRX 1.11 renamed in ${changed} file${changed === 1 ? '' : 's'}.`);
    }
    return { files: out, notes };
}
