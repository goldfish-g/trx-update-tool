// Object names as TRX has renamed them, release by release.
//
// The tables of TRX 1.11 come from docs/trx/MIGRATING.md through
// renames.generated.ts; the guide gives the earlier ones, and two of 1.11's,
// in its text, so they are written out here.

import { OBJECT_KEYS, OBJECT_SYMBOLS } from './renames.generated.ts';

/** [the release that renamed it, the games it applies to, old key, new key or null if removed]. */
export const OLDER_OBJECT_RENAMES: [number, number[], string, string | null][] = [
    // TRX 1.3
    [3, [1], 'missile_1', 'natla_gun'],
    [3, [1], 'missile_2', 'missile_atlantean_shard'],
    [3, [1], 'missile_3', 'missile_atlantean_bomb'],
    [3, [1], 'missile_4', null],
    [3, [1], 'missile_5', null],
    [3, [2], 'window_1', 'smash_object_1'],
    [3, [2], 'window_2', 'smash_object_2'],
    // TRX 1.6
    [6, [1, 2], 'blood_1', 'blood'],
    [6, [1], 'warrior_1', 'atlantean_winged'],
    [6, [1], 'warrior_2', 'atlantean_shooter'],
    [6, [1], 'warrior_3', 'atlantean_ground'],
    // TRX 1.8
    [8, [3], 'explosion_1', 'sparks_gfx'],
    ...Array.from({ length: 10 }, (_, i): [number, number[], string, string] =>
        [8, [1, 2, 3], `disposable_animating_${i + 1}`, `animating_ext_${i + 1}`]),
    // TRX 1.11
    [11, [1, 2, 3], 'waterfall', 'waterfall_mist'],
    [11, [1], 'boat', 'moored_boat'],
    [11, [1], 'motor_boat', 'moored_boat'],
    [11, [1], 'explosive_item', null],
    [11, [1], 'explosive_option', null],
];

const SYMBOL_KEYS: Record<string, string> = {};
for (const was in OBJECT_SYMBOLS) {
    SYMBOL_KEYS[was.replace(/^O_/, '').toLowerCase()] = OBJECT_SYMBOLS[was].replace(/^O_/, '').toLowerCase();
}

/**
 * An object's key now, from the key or C symbol a file made for TRX
 * 1.<release> of a game used; null for an object TRX has removed.
 */
export function currentObjectKey(name: string, release: number, gameVersion: number): string | null {
    let key = name.trim().replace(/^O_/i, '').toLowerCase();
    for (const [at, games, was, now] of OLDER_OBJECT_RENAMES) {
        if (release < at && games.includes(gameVersion) && key === was) {
            if (now === null) return null;
            key = now;
        }
    }
    if (release < 11) key = OBJECT_KEYS[key] ?? SYMBOL_KEYS[key] ?? key;
    return key;
}

/** The renames as a Lua table body for trx_compat.lua. */
export function luaObjectRenames(gameVersion: number): string {
    const renames: Record<string, string> = {};
    for (const was in OBJECT_KEYS) renames[was] = OBJECT_KEYS[was];
    for (const was in SYMBOL_KEYS) renames[was] = SYMBOL_KEYS[was];
    const older = OLDER_OBJECT_RENAMES
        .filter(([, games, , now]) => games.includes(gameVersion) && now !== null)
        .map(([at, , was, now]) => `{ ${at}, ${JSON.stringify(was)}, ${JSON.stringify(now)} },`);
    return Object.keys(renames).sort()
        .map((k) => `[${JSON.stringify(k)}] = ${JSON.stringify(renames[k])},`)
        .join(' ') + ` older = { ${older.join(' ')} },`;
}
