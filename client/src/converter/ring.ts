// A game's inventory ring file, from the TRX it was made for to the current
// one.
//
// Every TRX reads a game's inv_ring.json5 on its own: the ring holds the
// entries the file lists and no others. Up to TRX 1.11 an entry started from
// nothing, so a field the file leaves out was 0 (inventory_ring/vars.c,
// lua/capi/inventory.c); since 1.12 the shipped interface gives it a default
// of its own (modules/ui/ring/entries.lua), which for some fields is not 0.
// So the game's entries are kept as the engine read them, with the zeros
// spelled out; an entry TRX's own file had at the game's release and the
// game's leaves out is not on its ring; and what TRX has added since, entries
// and fields alike, comes from the current file (stockfields.generated.ts,
// written by scripts/extract-stock-fields.mjs).

import { currentObjectKey } from './objects.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

const isObject = (value: unknown): value is AnyObj => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The fields TRX 1.0 to 1.11 read of an entry, which the current one reads too. */
const READ_BEFORE_1_12 = [
    'frames_total', 'open_frame', 'anim_direction', 'anim_speed',
    'x_rot_pt_sel', 'x_rot_sel', 'x_rot_nosel', 'y_rot_sel', 'y_trans_sel', 'z_trans_sel',
    'meshes_sel', 'meshes_drawn', 'inv_pos',
];

/** The objects TRX's own ring files had, by game and release. */
export type StockRingObjects = Record<string, Record<number, string[]>>;

function stockAt(stock: StockRingObjects | null, game: string, release: number): Set<string> | null {
    const known = stock?.[game];
    if (!known) return null;
    const releases = Object.keys(known).map(Number).filter((r) => r <= release).sort((a, b) => b - a);
    return releases.length > 0 ? new Set(known[releases[0]!]) : null;
}

/**
 * The current ring file of a game whose own is `own`, made for TRX
 * 1.`release`: `base` is the ring TRX ships for the game it extends now.
 */
export function mergeRing(own: unknown, base: AnyObj[], release: number, gameVersion: number, stock: StockRingObjects | null): AnyObj[] | null {
    if (!Array.isArray(own)) return null;
    const game = `tr${gameVersion}`;
    const baseById = new Map<string, AnyObj>();
    for (const entry of base) if (typeof entry.object_id === 'string') baseById.set(entry.object_id, entry);

    const out: AnyObj[] = [];
    const listed = new Set<string>();
    for (const entry of own) {
        if (!isObject(entry) || typeof entry.object_id !== 'string') continue;
        const id = currentObjectKey(entry.object_id, release, gameVersion);
        if (id === null || listed.has(id)) continue;
        listed.add(id);
        const now: AnyObj = { object_id: id };
        // What the current TRX has added to an entry, which the game's TRX did not read.
        for (const [key, value] of Object.entries(baseById.get(id) ?? {})) {
            if (key !== 'object_id' && !READ_BEFORE_1_12.includes(key)) now[key] = value;
        }
        for (const [key, value] of Object.entries(entry)) if (key !== 'object_id') now[key] = value;
        if (release < 12) for (const key of READ_BEFORE_1_12) if (typeof now[key] !== 'number') now[key] = 0;
        out.push(now);
    }

    // An entry TRX's ring had when the game was made, and the game's left
    // out, was taken off; one TRX has put on since was not there to take.
    const then = stockAt(stock, game, release);
    for (const [id, entry] of baseById) {
        if (listed.has(id) || (then !== null && then.has(id))) continue;
        out.push(entry);
    }
    return out;
}
