// Brings a game made for an older TRX up to date with the current one, as
// TRX's migration guide (docs/trx/MIGRATING.md) describes: its scripts reach
// the API of the release they were written for through a compatibility
// module (lua.ts), Lara's outfits match the objects her levels carry
// (outfits.ts), and its other data files take the current names and layout
// (datafiles.ts).

import { migrateDataFiles } from './datafiles.ts';
import { applyLevelRules } from './levelrules.ts';
import { BASE_GAME_SCRIPTS, CURRENT_RELEASE, detectRelease, migrateScripts } from './lua.ts';
import { migrateOutfits } from './outfits.ts';
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

export async function migrateToCurrentTRX(files: MappedFile[], options: MigrationOptions): Promise<MigrationResult> {
    const notes: string[] = [];
    const guess = detectRelease(options.upload, files);
    if (guess.release !== null && guess.release < CURRENT_RELEASE) {
        notes.push(`Made for TRX 1.${guess.release} (from ${guess.from}).`);
    }

    const scripts = migrateScripts(files, options.modDir, options.gameVersion, guess.release);
    notes.push(...scripts.notes);
    notes.push(...migrateOutfits(scripts.files, options.modDir, guess.release));
    const rules = applyLevelRules(
        scripts.files, options.modDir, options.gameVersion, guess.release,
        BASE_GAME_SCRIPTS[options.gameVersion] ?? '',
    );
    notes.push(...rules.notes);
    const data = await migrateDataFiles(rules.files, options.modDir, options.gameVersion, guess.release);
    notes.push(...data.notes);

    // Working files of the converter's own.
    const out = data.files.filter((file) => !/^games\/[^/]+\/(_meta|_loose)\//i.test(file.path));
    return { files: out, notes };
}
