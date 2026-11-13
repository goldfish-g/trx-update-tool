// A game's weapons file, from the TRX it was made for to the current one.
//
// Up to TRX 1.9 a game's weapons.json5 was read over the engine's own
// numbers, so a field the file left out kept what the engine had: the
// game's entries laid over the current file keep that. From TRX 1.10 the
// engine clears every weapon before reading the file ("gun: clear the weapon
// table before loading it"), and the file is all there is: a field it leaves
// out is zero, a weapon it leaves out is not in the game. The pistols of a
// TRX 1.10 game that leaves out `infinite` run out of ammunition, as TRX's
// own file at the time had it and the builder took it out. So for those
// games what TRX's own file had at the builder's release and the game's file
// does not is left out of the current one too, and only what TRX added since
// comes from the current file (stockfields.generated.ts, written by
// scripts/extract-stock-fields.mjs).

import { currentObjectKey } from './objects.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

const isObject = (value: unknown): value is AnyObj => value !== null && typeof value === 'object' && !Array.isArray(value);

const GROUPS = /^(flash|glow|muzzle|smoke|shell|stow|save|cheat)_(.+)$/;
const AIM: Record<string, string> = {
    aim_speed: 'speed', shot_accuracy: 'accuracy', target_dist: 'target_dist',
    lock_angles: 'lock', left_angles: 'left', right_angles: 'right',
};
const ANIM: Record<string, string> = {
    draw_frame: 'draw_frame', undraw_frame: 'undraw_frame', recoil_frame: 'recoil_frame', equip_anim_idx: 'equip',
};
const OBJECTS: Record<string, string> = { gun_object: 'pickup', ammo_object: 'ammo', anim_object: 'anim' };
// TRX 1.10 renamed the ammunition keys and went on reading the old names.
const AMMO: Record<string, string> = { initial_qty: 'initial_shots', pickup_qty: 'box_shots', inventory_qty: 'box_label_qty' };

/** The weapons file of TRX 1.10 and before: a flat entry per weapon. */
export function isFlatWeapon(weapon: AnyObj): boolean {
    return Object.keys(weapon).some((k) =>
        k === 'type' || k === 'sample_num' || k in AIM || k in ANIM || k in OBJECTS || GROUPS.test(k));
}

/**
 * A position as every TRX reads one: a group of x, y and z, each 0 where it
 * is left out, or the list of the three.
 */
function position(value: unknown): unknown {
    if (!isObject(value)) return value;
    const keys = Object.keys(value);
    if (keys.length === 0 || !keys.every((k) => k === 'x' || k === 'y' || k === 'z')) return value;
    return { x: value.x ?? 0, y: value.y ?? 0, z: value.z ?? 0 };
}

/** One weapon's settings, from the flat layout before TRX 1.11 to the grouped one. */
export function currentWeapon(old: AnyObj, release: number, gameVersion: number): AnyObj {
    const out: AnyObj = {};
    const group = (name: string) => (out[name] ??= {});
    for (const [key, value] of Object.entries(old)) {
        // An empty position stood for the default, which the current layout
        // spells by leaving the field out.
        if (isObject(value) && Object.keys(value).length === 0) continue;
        const grouped = GROUPS.exec(key);
        if (key === 'type' && typeof value === 'string') {
            out.kind = value.replace(/^WEAPON_TYPE_/, '').toLowerCase();
        } else if (key === 'sample_num') {
            group('sound').fire = typeof value === 'string' ? value.replace(/^SFX_/, '').toLowerCase() : value;
        } else if (AIM[key]) {
            group('aim')[AIM[key]] = value;
        } else if (ANIM[key]) {
            group('anim')[ANIM[key]] = value;
        } else if (OBJECTS[key]) {
            group('objects')[OBJECTS[key]] = typeof value === 'string'
                ? currentObjectKey(value, release, gameVersion) ?? value
                : value;
        } else if (key === 'ammo' && isObject(value)) {
            const ammo = group('ammo');
            for (const [field, qty] of Object.entries(value)) {
                if (field === 'pickup_qty_alt') continue;
                // The current name wins where a file gives both, as TRX read them.
                const name = AMMO[field] ?? field;
                if (name !== field && name in value) continue;
                ammo[name] = qty;
            }
        } else if (key === 'pickup_qty') {
            // TRX 1.6 gave the ammunition an object of its own.
            group('ammo').initial_shots ??= value;
            group('ammo').box_shots ??= value;
        } else if (key === 'pickup_qty_alt') {
            continue;
        } else if (grouped) {
            group(grouped[1])[grouped[2]] = position(value);
        } else {
            out[key] = value;
        }
    }
    return out;
}

/**
 * Every field of a weapon in the grouped layout, by `group/field` or
 * `field`: a position, a colour and a list of angles are one field each.
 */
export function weaponFields(weapon: AnyObj): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const [key, value] of Object.entries(weapon)) {
        if (isObject(value) && position(value) === value) {
            for (const [field, inner] of Object.entries(value)) out.set(`${key}/${field}`, position(inner));
        } else {
            out.set(key, position(value));
        }
    }
    return out;
}

/** The fields TRX's own weapons files had, by game, release and weapon: `weapon` and `weapon/group/field`. */
export type StockWeaponFields = Record<string, Record<number, string[]>>;

/** The release whose own file a game's weapons file is read against. */
function fieldsRelease(release: number, flat: boolean, known: Record<number, string[]>): number | null {
    // A flat file is of TRX 1.10 at the latest, a grouped one of 1.11 at the earliest.
    const at = flat ? Math.min(release, 10) : Math.max(release, 11);
    const releases = Object.keys(known).map(Number).filter((r) => r <= at).sort((a, b) => b - a);
    return releases[0] ?? null;
}

/**
 * The current weapons file of a game whose own is `own`, made for TRX
 * 1.`release`: `base` is the file TRX ships for the game it extends now, and
 * `stock` what TRX's own files had (stockfields.generated.ts).
 */
export function mergeWeapons(own: AnyObj, base: AnyObj, release: number, gameVersion: number, stock: StockWeaponFields | null): AnyObj {
    const game = `tr${gameVersion}`;
    const out: AnyObj = { ...base };
    const entries = new Map<string, AnyObj>();
    for (const [rawKey, weapon] of Object.entries(own)) {
        if (!isObject(weapon)) continue;
        entries.set(rawKey.replace(/^LGT_/, '').toLowerCase(), weapon);
    }
    const anyFlat = [...entries.values()].some(isFlatWeapon);
    // Up to TRX 1.9 a file was read over the engine's own numbers.
    const alone = release >= 10 && stock?.[game] !== undefined;
    const at = alone ? fieldsRelease(release, anyFlat, stock![game]!) : null;
    const known = at !== null ? new Set(stock![game]![at]) : null;

    for (const key of Object.keys(base)) {
        const weapon = entries.get(key);
        if (weapon === undefined) {
            // A weapon TRX's file had and the game's leaves out was not in it.
            if (known?.has(key)) delete out[key];
            continue;
        }
        const current = release < 11 || isFlatWeapon(weapon) ? currentWeapon(weapon, release, gameVersion) : weapon;
        const fields = weaponFields(current);
        const merged: AnyObj = {};
        const put = (path: string, value: unknown) => {
            const [group, field] = path.split('/');
            if (field === undefined) merged[group!] = value;
            else (merged[group!] ??= {})[field] = value;
        };
        for (const [path, value] of weaponFields(base[key])) {
            if (fields.has(path)) continue;
            // What TRX's file had then and the game's does not, the builder
            // took out; the engine read it as zero.
            if (known?.has(`${key}/${path}`)) continue;
            put(path, value);
        }
        for (const [path, value] of fields) put(path, value);
        out[key] = merged;
    }
    return out;
}
