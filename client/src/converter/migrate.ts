// Brings a game made for an older TRX up to date with the current one, as
// TRX's migration guide (docs/trx/MIGRATING.md) describes: its scripts reach
// the API of the release they were written for through a compatibility
// module (lua.ts), Lara's outfits match the objects her levels carry
// (outfits.ts), its other data files take the current names and layout
// (datafiles.ts), and TRX's font is rebuilt with the lettering its levels
// bring (font.ts).

import { migrateDataFiles } from './datafiles.ts';
import { rebuildFonts } from './font.ts';
import { applyLevelRules } from './levelrules.ts';
import { baseGame } from './basegame.ts';
import { CURRENT_RELEASE, detectRelease, migrateScripts } from './lua.ts';
import { migrateOutfits } from './outfits.ts';
import { LEGACY_MARKER } from './legacy.ts';
import { checkPlayable, settleObjects, settleReferences, type BaseNeed } from './references.ts';
import type { MappedFile } from './types.ts';

export type MigrationResult = {
    files: MappedFile[];
    /** Files of the original game it needs and does not bring, for the caller to fetch (with fetchBase). */
    needs: BaseNeed[];
    // What changed, for the person converting.
    notes: string[];
};

export type MigrationOptions = {
    modDir: string;
    gameVersion: number;
    // The archive as uploaded, whose engine says which TRX it ran on.
    upload: MappedFile[];
    /**
     * Whether the files of the original game the game needs come from the
     * caller (returned as needs), rather than the game doing without them.
     */
    fetchBase?: boolean;
};

export async function migrateToCurrentTRX(files: MappedFile[], options: MigrationOptions): Promise<MigrationResult> {
    const notes: string[] = [];
    const legacy = files.find((f) => f.path === `games/${options.modDir}/${LEGACY_MARKER}`);
    if (legacy) {
        try {
            notes.push(...(JSON.parse(new TextDecoder().decode(legacy.data)).notes ?? []));
        } catch {
            // The notes are only for the person converting.
        }
    }
    const guess = detectRelease(options.upload, files);
    if (legacy) {
        // Its own note says what it was made for.
    } else if (guess.release !== null && guess.release < CURRENT_RELEASE) {
        notes.push(`Made for TRX 1.${guess.release} (from ${guess.from}).`);
    }

    const base = baseGame(files, options.modDir, options.gameVersion);
    if (base.lostArtifact) notes.push('Made for The Lost Artifact, which it keeps apart from Tomb Raider III.');
    const scripts = migrateScripts(files, options.modDir, options.gameVersion, guess.release, base.gameScript);
    notes.push(...scripts.notes);
    notes.push(...migrateOutfits(scripts.files, options.modDir, guess.release, options.gameVersion));
    const rules = applyLevelRules(scripts.files, options.modDir, options.gameVersion, guess.release, base);
    notes.push(...rules.notes);
    const data = await migrateDataFiles(rules.files, options.modDir, options.gameVersion, guess.release);
    notes.push(...data.notes);
    notes.push(...await rebuildFonts(data.files, options.modDir, options.gameVersion));
    const needs: BaseNeed[] = [];
    notes.push(...settleReferences(data.files, options.modDir, options.gameVersion, { fetchBase: options.fetchBase, needs }));
    notes.push(...settleObjects(data.files, options.modDir, options.gameVersion));
    checkPlayable(data.files, options.modDir, options.gameVersion);

    // Working files of the converter's own.
    const out = data.files.filter((file) => !/^games\/[^/]+\/(_meta|_loose)\//i.test(file.path));
    return { files: out, notes, needs };
}
