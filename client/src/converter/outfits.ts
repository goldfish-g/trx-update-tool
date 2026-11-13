// Lara's outfits for a game made for an older TRX.
//
// An outfits file names meshes by their place in the objects that carry them:
// the outfits, the extra meshes and the guns. TRX ships those objects in
// lara_outfits.bin, and moves meshes around inside it between releases, so
// the file has to match whichever objects the game really uses:
//
// - A game that injects lara_outfits.bin uses TRX's current objects, so it
//   takes TRX's current outfits, plus any outfit of its own. A copy of the
//   file from any TRX build, a development one included, gives way to the
//   current one (datafiles.ts, stock.ts).
// - A game that brings a lara_outfits.bin of its own uses its objects, so
//   it keeps its own outfits file.
// - A game that does not carries the objects in its levels, laid out as its
//   own release had them, so it keeps the outfits file of that release.
//
// Either way the file is brought to the current format (docs/trx/MIGRATING.md
// and docs/trx/OUTFITS.md).

import { getCfgFile } from '../templates/index.ts';
import { BASE_FILES } from '../templates/base/index.ts';
import { moveObject, readLevelObjects } from './level.ts';
import { parseJSON5 } from './json5.ts';
import { isStock } from './stock.ts';
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
export async function migrateOutfits(files: MappedFile[], modDir: string, release: number | null, gameVersion: number): Promise<string[]> {
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

    // A lara_outfits.bin of the game's own, rather than a copy of one TRX
    // shipped, answers before TRX's (the game's directory comes first), and
    // its objects are laid out as the game's own outfits file says.
    const objects = files.find((f) => f.path.toLowerCase() === prefix + 'injections/lara_outfits.bin');
    const ownObjects = objects !== undefined && !(await isStock(objects));

    let result: AnyObj;
    let note: string;
    if (ownObjects) {
        result = currentOutfitFormat(own);
        note = 'Kept the outfit file the game was made with, as it brings outfit objects of its own.';
    } else if (injectsOutfits(decoder.decode(gameflow.data))) {
        // A copy of the file of some TRX build, development ones included,
        // in cfg/ has no outfit of the game's own, whatever that build had.
        if (!modFile && await isStock(source)) return [];
        // TRX's objects, so TRX's outfits; the game's own ones go on top.
        const shipped = parseJSON5(getCfgFile('outfits.json5')) as AnyObj;
        const mine = currentOutfitFormat(own);
        const added = Object.keys(mine.outfits ?? {}).filter((k) => !(k in shipped.outfits));
        // A copy of TRX's own file in cfg/ says nothing TRX's current one does not.
        if (!modFile && added.length === 0) return [];
        const moved = new Map<string, string>();
        for (const key of added) {
            shipped.outfits[key] = rebaseOutfit(mine.outfits[key], shipped, gameVersion);
            const object = shipped.outfits[key].mesh_object;
            if (typeof object !== 'string') continue;
            const to = moved.get(object) ?? moveOwnSkin(files, prefix, gameVersion, object, [...moved.values()]);
            if (to !== null) {
                moved.set(object, to);
                shipped.outfits[key].mesh_object = to;
            }
        }
        result = shipped;
        note = added.length > 0
            ? `Kept the game's own outfits (${added.join(', ')}) beside TRX's current ones${moved.size > 0 ? `, with ${moved.size} of the models its levels bring for them moved to where TRX's own outfits do not overwrite them` : ''}.`
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

// A game's own outfit names its meshes by their places in the objects of
// the lara_outfits.bin of its release: the braid and combat face in the
// extra object, the holsters in the legs object, its guns by a gun map.
// TRX has moved those places since, so an outfit modelled on one of TRX's
// own (its name, LARA_OUTFIT_TR2_CLASSIC, says which) takes that outfit's
// current places and keeps only its own model and what it says of itself.

/** The keys an outfit keeps of its own over the one it is modelled on. */
const OWN_KEYS = ['mesh_object', 'is_barefoot', 'is_selectable', 'supports_sunglasses'];

/** An outfit of the game's own, laid over the TRX outfit it is modelled on. */
function rebaseOutfit(own: AnyObj, shipped: AnyObj, gameVersion: number): AnyObj {
    const named = typeof own.name_gs === 'string'
        ? (/^LARA_OUTFIT_(\w+)$/.exec(own.name_gs)?.[1]?.toLowerCase() ?? /^dynamic\/enums\/lara_outfit\/(\w+)$/.exec(own.name_gs)?.[1])
        : undefined;
    const base = shipped.outfits[named ?? ''] ?? (named === undefined ? undefined : shipped.outfits[`tr${gameVersion}_classic`]);
    if (base === undefined) return own;
    const out: AnyObj = JSON.parse(JSON.stringify(base));
    for (const key of OWN_KEYS) if (own[key] !== undefined) out[key] = own[key];
    return out;
}

/** The slots of the outfit objects lara_outfits.bin fills, which overwrite a level's own there. */
const FILLED_SKINS = 24;
/** The free ones a level's own outfit can move to; 32 holds the converter's guns object. */
const FREE_SKINS = [25, 26, 27, 28, 29, 30, 31];

/** The level slot of each object, by its name in TRX's catalog for the game. */
function objectSlots(gameVersion: number): Map<string, number> {
    const slots = new Map<string, number>();
    for (const line of (BASE_FILES[`tr${gameVersion}/catalog_objects.csv`] ?? '').split('\n')) {
        const match = /^\s*(\d+)\s*,\s*(\w+)/.exec(line);
        if (match) slots.set(match[2], Number(match[1]));
    }
    return slots;
}

/**
 * Moves the model the game's levels bring for an outfit out of a slot
 * lara_outfits.bin fills, into a free one, in every level that brings it.
 * Returns the outfit object's new name, or null when it stays (no level
 * brings it, it is in a free slot already, or no free slot fits).
 */
function moveOwnSkin(files: MappedFile[], prefix: string, gameVersion: number, object: string, taken: string[]): string | null {
    const number = Number(/^lara_skin_swap_(\d+)$/.exec(object)?.[1] ?? NaN);
    if (!(number >= 1 && number <= FILLED_SKINS)) return null;
    const slots = objectSlots(gameVersion);
    const from = slots.get(object);
    if (from === undefined) return null;
    const levels = files.filter((f) => f.path.startsWith(prefix + 'levels/'));
    const bringing = levels.filter((f) => readLevelObjects(f.data)?.objects.some((o) => o.id === from));
    if (bringing.length === 0) return null;
    for (const free of FREE_SKINS) {
        const name = `lara_skin_swap_${free}`;
        const to = slots.get(name);
        if (to === undefined || taken.includes(name)) continue;
        const moved = bringing.map((f) => moveObject(f.data, from, to));
        if (moved.some((data) => data === null)) continue;
        bringing.forEach((f, i) => { f.data = moved[i]!; });
        return name;
    }
    return null;
}
