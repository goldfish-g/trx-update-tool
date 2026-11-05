// Lara's outfits for a game made for an older TRX.
//
// An outfits file names meshes by their place in the objects that carry them:
// the outfits, the extra meshes and the guns. TRX ships those objects in
// lara_outfits.bin, and moves meshes around inside it between releases, so
// the file has to match whichever objects the game really uses:
//
// - A game that injects lara_outfits.bin uses TRX's current objects, so it
//   takes TRX's current outfits, plus any outfit of its own.
// - A game that does not carries the objects in its levels, laid out as its
//   own release had them, so it keeps the outfits file of that release.
//
// Either way the file is brought to the current format (docs/trx/MIGRATING.md
// and docs/trx/OUTFITS.md).

import { getCfgFile } from '../templates/index.ts';
import { parseJSON5 } from './json5.ts';
import type { MappedFile } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

/** A C spelling such as `O_LARA_SKIN_SWAP_2` as TRX 1.11 names it. */
function keyOf(name: string, prefix: RegExp): string {
    return name.replace(prefix, '').toLowerCase();
}

function renameKeys(obj: AnyObj, prefix: RegExp): AnyObj {
    const out: AnyObj = {};
    for (const key of Object.keys(obj)) out[keyOf(key, prefix)] = obj[key];
    return out;
}

/** An outfits file in the format the current TRX reads. */
export function currentOutfitFormat(outfits: AnyObj): AnyObj {
    const out: AnyObj = JSON.parse(JSON.stringify(outfits));
    const defs: AnyObj = out.outfits ?? {};

    // TRX 1.11 dropped the golden outfits: Lara turns gold in whatever she wears.
    const dropped = new Set<string>();
    for (const name of Object.keys(defs)) {
        if (defs[name].is_reflective === true || /golden/i.test(name)) {
            dropped.add(name);
            delete defs[name];
        }
    }

    for (const name of Object.keys(defs)) {
        const def = defs[name];
        for (const field of ['mesh_object', 'joints_object']) {
            if (typeof def[field] === 'string') def[field] = keyOf(def[field], /^O_/);
        }
        // TRX 1.9 replaced the footstep sample with a flag.
        if (def.footstep_sample_id !== undefined) {
            if (/barefoot/i.test(String(def.footstep_sample_id))) def.is_barefoot = true;
            delete def.footstep_sample_id;
        }
        delete def.is_reflective;
        if (def.extra_mesh_positions) {
            def.extra_mesh_positions = renameKeys(def.extra_mesh_positions, /^EXTRA_MESH_/);
        }
        // TRX 1.10 made the braid a list, to allow two.
        if (def.braid && !Array.isArray(def.braid)) def.braid = [def.braid];
        if (Array.isArray(def.braid)) {
            def.braid = def.braid
                .map((braid: AnyObj) => {
                    if (braid.hair_pos && !braid.position) braid.position = braid.hair_pos;
                    delete braid.hair_pos;
                    delete braid.gold_offset;
                    if (typeof braid.mode === 'string') braid.mode = keyOf(braid.mode, /^BRAID_MODE_/);
                    return braid;
                })
                .filter((braid: AnyObj) => braid.mode !== 'tr1_gold');
        }
        if (def.extra_outfits) {
            const extra = renameKeys(def.extra_outfits, /^LS_EXTRA_/);
            delete extra.midas_kill;
            for (const state of Object.keys(extra)) {
                if (dropped.has(extra[state])) delete extra[state];
            }
            def.extra_outfits = extra;
        }
    }

    if (out.extra_meshes) {
        const meshes = renameKeys(out.extra_meshes, /^EXTRA_MESH_/);
        for (const key of Object.keys(meshes)) {
            if (/gold/.test(key)) delete meshes[key];
        }
        out.extra_meshes = meshes;
    }
    if (Array.isArray(out.gun_maps)) {
        out.gun_maps = out.gun_maps.map((map: AnyObj) => renameKeys(map, /^LGT_/));
    }
    return out;
}

function injectsOutfits(gameflowText: string): boolean {
    return /["/]lara_outfits\.bin"/.test(gameflowText);
}

/**
 * Writes games/<mod>/outfits.json5 for a game made for TRX 1.<release>,
 * from its own (games/<mod>/outfits.json5, or the cfg/outfits.json5 the
 * archive carried, kept at _meta/outfits.json5).
 */
export function migrateOutfits(files: MappedFile[], modDir: string, release: number | null): string[] {
    const prefix = `games/${modDir}/`;
    const decoder = new TextDecoder();
    const gameflow = files.find((f) => f.path === prefix + 'gameflow.json5');
    const modFile = files.find((f) => f.path === prefix + 'outfits.json5');
    const cfgFile = files.find((f) => f.path === prefix + '_meta/outfits.json5');
    const source = modFile ?? cfgFile;
    if (!gameflow || !source || release === null) return [];

    let own: AnyObj;
    try {
        own = parseJSON5(decoder.decode(source.data)) as AnyObj;
    } catch {
        return [];
    }
    // The converter's own outfit of the level's meshes is already current.
    if (own.outfits && own.outfits.level_default) return [];

    let result: AnyObj;
    let note: string;
    if (injectsOutfits(decoder.decode(gameflow.data))) {
        // TRX's objects, so TRX's outfits; the game's own ones go on top.
        if (!modFile) return [];
        const shipped = parseJSON5(getCfgFile('outfits.json5')) as AnyObj;
        const mine = currentOutfitFormat(own);
        const added = Object.keys(mine.outfits ?? {}).filter((k) => !(k in shipped.outfits));
        for (const key of added) shipped.outfits[key] = mine.outfits[key];
        result = shipped;
        note = added.length > 0
            ? `Kept the game's own outfits (${added.join(', ')}) beside TRX's current ones.`
            : "Replaced the game's outfit file with TRX's current one, which matches the outfits TRX injects.";
    } else {
        result = currentOutfitFormat(own);
        note = 'Kept the outfit file the game was made with, as its levels carry their own outfits.';
    }

    const text = JSON.stringify(result, null, 4);
    const encoded = new TextEncoder().encode(text);
    if (modFile) {
        modFile.data = encoded;
    } else {
        files.push({ path: prefix + 'outfits.json5', data: encoded });
    }
    return [note];
}
