// Brings the data files of a game made for an older TRX up to date: its game
// flow, strings, catalogs, weapons, inventory ring and injections, as
// docs/trx/MIGRATING.md describes each change.
//
// Level builders start from TRX's own files and copy them into their games.
// A copy left as it was is dropped, so the game gets what the current TRX
// ships; a file the builder changed is merged into the current one, so it
// keeps both the builder's changes and what TRX has added since.

import { BASE_FILES, BASE_INJECTIONS } from '../templates/base/index.ts';
import { GAME_STRING_IDS, STOCK_BLOBS } from './history.generated.ts';
import { parseJSON5 } from './json5.ts';
import { CURRENT_RELEASE, currentMarkup } from './lua.ts';
import { currentObjectKey, STATS_BACKGROUND } from './objects.ts';
import type { MappedFile } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function readJson(file: MappedFile): AnyObj | null {
    try {
        return parseJSON5(decoder.decode(file.data)) as AnyObj;
    } catch {
        return null;
    }
}

function writeJson(file: MappedFile, value: unknown): void {
    file.data = encoder.encode(JSON.stringify(value, null, 4));
}

function isObject(value: unknown): value is AnyObj {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** b laid over a: objects merge, anything else from b replaces a's. */
function deepMerge(a: unknown, b: unknown): unknown {
    if (!isObject(a) || !isObject(b)) return b;
    const out: AnyObj = { ...a };
    for (const key of Object.keys(b)) out[key] = key in a ? deepMerge(a[key], b[key]) : b[key];
    return out;
}

function baseName(path: string): string {
    return path.split('/').pop()!.toLowerCase();
}

// ---------------------------------------------------------------------------
// Copies of TRX's own files
// ---------------------------------------------------------------------------

async function gitBlobId(data: Uint8Array): Promise<string> {
    const head = encoder.encode(`blob ${data.length}\0`);
    const all = new Uint8Array(head.length + data.length);
    all.set(head);
    all.set(data, head.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether a file is one TRX shipped, unchanged. */
async function isStock(file: MappedFile): Promise<boolean> {
    const known = STOCK_BLOBS[baseName(file.path)];
    if (!known) return false;
    return known.includes((await gitBlobId(file.data)).slice(0, 16));
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

// The outfits TRX 1.11 dropped: Lara turns gold in any outfit now.
const GOLDEN_OUTFIT = /golden/i;

// Seconds TRX takes for a picture's fades when the game flow states none.
const FADE_IN = 1.0;
const FADE_OUT = 0.33;

type LevelScripts = Map<string, string[]>;

function levelKey(path: unknown): string {
    return typeof path === 'string' ? baseName(path).replace(/\.[^.]+$/, '') : '';
}

function migrateGameflow(
    gameflow: AnyObj,
    release: number,
    gameVersion: number,
    scripts: LevelScripts,
    notes: string[],
): void {
    // Paths: TRX 1.0 named files from its own directory.
    let paths = 0;
    const walkPaths = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walkPaths);
        } else if (isObject(node)) {
            for (const key of Object.keys(node)) {
                const value = node[key];
                if (typeof value === 'string' && /^data[/\\]/i.test(value)) {
                    node[key] = value.split(/[/\\]/).pop();
                    paths++;
                } else {
                    walkPaths(value);
                }
            }
        }
    };
    walkPaths(gameflow);
    if (paths > 0) notes.push(`Named ${paths} file${paths === 1 ? '' : 's'} the way TRX looks them up now.`);

    // TRX 1.2: the savegame pattern.
    if (gameflow.savegame_fmt_bson !== undefined) {
        gameflow.savegame_file_fmt ??= gameflow.savegame_fmt_bson;
        delete gameflow.savegame_fmt_bson;
    }
    delete gameflow.savegame_fmt_legacy;

    // TRX 1.9: game modes became a policy.
    for (const section of [gameflow, gameflow.enforced_config]) {
        if (isObject(section) && typeof section.enable_game_modes === 'boolean') {
            section.game_modes_policy = section.enable_game_modes ? 'always' : 'never';
            delete section.enable_game_modes;
        }
    }

    // Objects named in sequences and item drops.
    const walkObjects = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walkObjects);
        } else if (isObject(node)) {
            if (typeof node.object_id === 'string') {
                node.object_id = currentObjectKey(node.object_id, release, gameVersion) ?? node.object_id;
            }
            if (Array.isArray(node.object_ids)) {
                node.object_ids = node.object_ids
                    .map((id: unknown) => typeof id === 'string' ? currentObjectKey(id, release, gameVersion) : id)
                    .filter((id: unknown) => id !== null);
            }
            Object.values(node).forEach(walkObjects);
        }
    };
    walkObjects(gameflow);

    // The final statistics stand on the picture of the game this one extends,
    // as in TRX's own games.
    const walkStats = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walkStats);
        } else if (isObject(node)) {
            if (node.type === 'total_stats' && !node.background_path && STATS_BACKGROUND[gameVersion]) {
                node.background_path = STATS_BACKGROUND[gameVersion];
            }
            Object.values(node).forEach(walkStats);
        }
    };
    walkStats(gameflow);

    const entries: AnyObj[] = [
        ...(Array.isArray(gameflow.levels) ? gameflow.levels : []),
        ...(Array.isArray(gameflow.cutscenes) ? gameflow.cutscenes : []),
        ...(Array.isArray(gameflow.demos) ? gameflow.demos : []),
        ...(isObject(gameflow.title) ? [gameflow.title] : []),
    ];

    const classic = `tr${gameVersion}_classic`;
    const globalCold = gameflow.cold_water === true;
    delete gameflow.cold_water;
    let timed = 0;
    for (const entry of entries) {
        if (release < 11 && typeof entry.lara_outfit === 'string' && GOLDEN_OUTFIT.test(entry.lara_outfit)) {
            entry.lara_outfit = classic;
        }
        const key = levelKey(entry.path);
        const lua = scripts.get(key) ?? [];

        // TRX 1.10: Bacon Lara's anchor is an object property.
        if (Array.isArray(entry.sequence)) {
            entry.sequence = entry.sequence.filter((event: AnyObj) => {
                if (event.type !== 'setup_bacon_lara') return true;
                if (typeof event.anchor_room === 'number') {
                    lua.push(`trx.objects.bacon_lara.properties.anchor_room = ${event.anchor_room}`);
                }
                return false;
            });
        }

        // TRX 1.8: cold water is a room flag. The water of the level is
        // what drained Lara's warmth.
        const cold = entry.cold_water === true || (globalCold && entry.cold_water !== false);
        delete entry.cold_water;
        if (cold && key) {
            lua.push(
                'for num = 0, trx.rooms.count() - 1 do',
                '  local room = trx.rooms[num]',
                '  if room ~= nil and room.underwater then',
                '    room.damaging = true',
                '  end',
                'end',
            );
        }

        // TRX 1.12: a picture's time no longer takes in its fades, which TR2
        // and TR3 used to take out of it.
        if (release < 12 && gameVersion >= 2 && Array.isArray(entry.sequence)) {
            for (const event of entry.sequence) {
                if (event.type !== 'display_picture' && event.type !== 'loading_screen') continue;
                const fades = (event.fade_in_time ?? FADE_IN) + (event.fade_out_time ?? FADE_OUT);
                const shown = event.display_time ?? 5;
                event.display_time = Math.max(0, Math.round((shown - fades) * 100) / 100);
                timed++;
            }
        }
        if (lua.length > 0 && key) scripts.set(key, lua);
    }
    if (timed > 0) notes.push(`Shortened ${timed} picture time${timed === 1 ? '' : 's'}, which TRX no longer counts the fades in.`);
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

// Strings TRX 1.12 dropped, as the common.ui.accent module styles text now.
const DROPPED_STRINGS = [
    'general/inventory_ring/heading_fmt',
    'general/inventory_ring/object_name_fmt',
    'general/inventory_ring/item_count_fmt',
    'general/overlay/item_count_fmt_pc',
    'general/overlay/item_count_fmt_ps1',
    'general/stats/assault_best_time_fmt',
    'general/stats/assault_other_times_fmt',
];

function setPath(doc: AnyObj, path: string, value: unknown): void {
    const parts = path.split('/');
    let node = doc;
    for (const part of parts.slice(0, -1)) {
        if (!isObject(node[part])) node[part] = {};
        node = node[part];
    }
    node[parts[parts.length - 1]] ??= value;
}

function deletePath(doc: AnyObj, path: string): void {
    const parts = path.split('/');
    let node: unknown = doc;
    for (const part of parts.slice(0, -1)) {
        if (!isObject(node)) return;
        node = node[part];
    }
    if (isObject(node)) delete node[parts[parts.length - 1]];
}

function migrateStrings(doc: AnyObj, release: number, gameVersion: number): void {
    // TRX 1.4: the flat string ids became nested sections.
    if (isObject(doc.game_strings)) {
        for (const [id, text] of Object.entries(doc.game_strings)) {
            const path = GAME_STRING_IDS[id];
            if (path) setPath(doc, path, text);
        }
        delete doc.game_strings;
    }

    const renameObjects = (objects: unknown): unknown => {
        if (!isObject(objects)) return objects;
        const out: AnyObj = {};
        for (const [key, value] of Object.entries(objects)) {
            const now = currentObjectKey(key, release, gameVersion);
            if (now !== null) out[now] = value;
        }
        return out;
    };
    doc.objects = renameObjects(doc.objects);
    for (const list of ['levels', 'cutscenes', 'demos']) {
        if (!Array.isArray(doc[list])) continue;
        for (const entry of doc[list]) {
            if (isObject(entry) && entry.objects) entry.objects = renameObjects(entry.objects);
        }
    }
    if (doc.objects === undefined) delete doc.objects;

    if (release < 12) {
        DROPPED_STRINGS.forEach((path) => deletePath(doc, path));
        const recolor = (node: unknown): unknown => {
            if (typeof node === 'string') return currentMarkup(node, gameVersion, false);
            if (Array.isArray(node)) return node.map(recolor);
            if (isObject(node)) {
                for (const key of Object.keys(node)) node[key] = recolor(node[key]);
            }
            return node;
        };
        recolor(doc);
    }
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

const CATALOG_PREFIX: Record<string, RegExp> = {
    'catalog_objects.csv': /^O_/i,
    'catalog_samples.csv': /^SFX_/i,
    'catalog_music.csv': /^MX_/i,
    'catalog_item_actions.csv': /^ITEM_ACTION_/i,
    'catalog_lara_anims.csv': /^LA_/i,
    'catalog_lara_states.csv': /^LS_/i,
};
// These name Lara's animations and states by their numbers, so they have to
// match whichever animations she has: TRX's, where the game injects
// lara_animations.bin, or else the ones its levels carry.
const ANIM_CATALOGS = new Set(['catalog_lara_states.csv', 'catalog_lara_anims.csv']);

/** A catalog kept as the game has it, in the current spelling. */
function respellCatalog(file: string, own: string): string {
    const known = knownNames(file);
    return own.split(/\r?\n/).map((line) => {
        const m = /^(\s*\d+\s*,\s*)([A-Za-z0-9_:]+)(.*)$/.exec(line);
        if (!m) return line;
        const name = m[2].replace(CATALOG_PREFIX[file], '').toLowerCase();
        // A name the engine does not know would stop the catalog loading.
        return known.has(name) ? m[1] + name + m[3] : '# ' + line;
    }).join('\n');
}

type Row = { num: number; name: string };

function parseCatalog(text: string): Row[] {
    const rows: Row[] = [];
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*(\d+)\s*,\s*([A-Za-z0-9_:]+)\s*,?\s*(#.*)?$/.exec(line);
        if (m) rows.push({ num: +m[1], name: m[2] });
    }
    return rows;
}

function knownNames(file: string): Set<string> {
    const names = new Set<string>();
    for (const game of ['tr1', 'tr2', 'tr3']) {
        for (const row of parseCatalog(BASE_FILES[`${game}/${file}`] ?? '')) names.add(row.name);
    }
    return names;
}

function mergeCatalog(file: string, own: string, game: string, release: number, gameVersion: number): string {
    const base = BASE_FILES[`${game}/${file}`] ?? '';
    const lines = base.split('\n');
    const byNum = new Map<number, number>();
    const pairs = new Set<string>();
    lines.forEach((line, i) => {
        const [row] = parseCatalog(line);
        if (row) {
            byNum.set(row.num, i);
            pairs.add(`${row.num},${row.name}`);
        }
    });
    const known = knownNames(file);
    const aliases = file === 'catalog_samples.csv';
    const added: string[] = [];
    for (const row of parseCatalog(own)) {
        const name = file === 'catalog_objects.csv'
            ? currentObjectKey(row.name, release, gameVersion)
            : row.name.replace(CATALOG_PREFIX[file], '').toLowerCase();
        // A name the engine does not know would stop the catalog loading.
        if (name === null || !known.has(name) || pairs.has(`${row.num},${name}`)) continue;
        const line = `${row.num}, ${name}`;
        const at = byNum.get(row.num);
        if (at !== undefined && !aliases) {
            lines[at] = line;
        } else {
            added.push(line);
        }
        pairs.add(`${row.num},${name}`);
    }
    if (added.length === 0) return lines.join('\n');
    return lines.join('\n').replace(/\n*$/, '\n') + '# The game\'s own\n' + added.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

const GROUPS = /^(flash|glow|muzzle|smoke|shell|stow|save|cheat)_(.+)$/;
const AIM: Record<string, string> = {
    aim_speed: 'speed', shot_accuracy: 'accuracy', target_dist: 'target_dist',
    lock_angles: 'lock', left_angles: 'left', right_angles: 'right',
};
const ANIM: Record<string, string> = {
    draw_frame: 'draw_frame', undraw_frame: 'undraw_frame', recoil_frame: 'recoil_frame', equip_anim_idx: 'equip',
};
const OBJECTS: Record<string, string> = { gun_object: 'pickup', ammo_object: 'ammo', anim_object: 'anim' };
const AMMO: Record<string, string> = { initial_qty: 'initial_shots', pickup_qty: 'box_shots', inventory_qty: 'box_label_qty' };

/** One weapon's settings, from the flat layout before TRX 1.11 to the grouped one. */
function currentWeapon(old: AnyObj, release: number, gameVersion: number): AnyObj {
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
                ammo[AMMO[field] ?? field] = qty;
            }
        } else if (key === 'pickup_qty') {
            // TRX 1.6 gave the ammunition an object of its own.
            group('ammo').initial_shots ??= value;
            group('ammo').box_shots ??= value;
        } else if (key === 'pickup_qty_alt') {
            continue;
        } else if (grouped) {
            group(grouped[1])[grouped[2]] = value;
        } else {
            out[key] = value;
        }
    }
    return out;
}

export function mergeWeapons(own: AnyObj, game: string, release: number, gameVersion: number): AnyObj | null {
    const base = parseJSON5(BASE_FILES[`${game}/weapons.json5`] ?? '{}') as AnyObj;
    for (const [rawKey, weapon] of Object.entries(own)) {
        if (!isObject(weapon)) continue;
        const key = rawKey.replace(/^LGT_/, '').toLowerCase();
        // A weapon the game does not list is not in it, and TRX lists the
        // ones its routines can handle.
        if (!(key in base)) continue;
        // The layout before TRX 1.11, which a file may keep whatever it says.
        const flat = Object.keys(weapon).some((k) =>
            k === 'type' || k === 'sample_num' || k in AIM || k in ANIM || k in OBJECTS || GROUPS.test(k));
        const current = release < 11 || flat ? currentWeapon(weapon, release, gameVersion) : weapon;
        base[key] = deepMerge(base[key], current);
    }
    return base;
}

// ---------------------------------------------------------------------------
// Inventory ring
// ---------------------------------------------------------------------------

function mergeRing(own: unknown, game: string, release: number, gameVersion: number): unknown[] | null {
    if (!Array.isArray(own)) return null;
    const base = parseJSON5(BASE_FILES[`${game}/inv_ring.json5`] ?? '[]') as AnyObj[];
    const at = new Map<string, number>();
    base.forEach((entry, i) => at.set(entry.object_id, i));
    for (const entry of own) {
        if (!isObject(entry) || typeof entry.object_id !== 'string') continue;
        const id = currentObjectKey(entry.object_id, release, gameVersion);
        if (id === null) continue;
        const now = { ...entry, object_id: id };
        const i = at.get(id);
        if (i !== undefined) base[i] = deepMerge(base[i], now) as AnyObj;
        else base.push(now);
    }
    return base;
}

// ---------------------------------------------------------------------------

export type DataMigration = { files: MappedFile[]; notes: string[] };

export async function migrateDataFiles(
    files: MappedFile[],
    modDir: string,
    gameVersion: number,
    release: number | null,
): Promise<DataMigration> {
    const prefix = `games/${modDir}/`;
    const game = `tr${gameVersion}`;
    const effective = release ?? CURRENT_RELEASE;
    const notes: string[] = [];
    const out: MappedFile[] = [];
    let stock = 0;
    let merged = 0;
    const scripts: LevelScripts = new Map();
    const gameflowFile = files.find((f) => f.path === prefix + 'gameflow.json5');
    const ownAnims = !gameflowFile || !/lara_animations\.bin/.test(decoder.decode(gameflowFile.data));

    for (const file of files) {
        if (!file.path.startsWith(prefix)) {
            out.push(file);
            continue;
        }
        const rel = file.path.slice(prefix.length);
        const name = baseName(rel);

        // Injections, catalogs, weapons and the ring as TRX shipped them.
        const kind = /^injections\/[^/]+\.bin$/.test(rel) ? 'injection'
            : /^catalog_[a-z_]+\.csv$/.test(rel) ? 'catalog'
            : rel === 'weapons.json5' || rel === 'inv_ring.json5' ? 'data'
            : null;
        const animCatalog = kind === 'catalog' && ANIM_CATALOGS.has(name);
        if (animCatalog && ownAnims) {
            file.data = encoder.encode(respellCatalog(name, decoder.decode(file.data)));
            out.push(file);
            continue;
        }
        if (kind !== null && (animCatalog || await isStock(file))) {
            // Kept where the TRX it now runs on no longer ships one.
            if (kind !== 'injection' || (BASE_INJECTIONS[game] ?? []).includes(name)) {
                stock++;
                continue;
            }
        }

        if (kind === 'catalog') {
            if (BASE_FILES[`${game}/${name}`] !== undefined) {
                file.data = encoder.encode(mergeCatalog(name, decoder.decode(file.data), game, effective, gameVersion));
                merged++;
            }
        } else if (rel === 'weapons.json5' && BASE_FILES[`${game}/weapons.json5`]) {
            const own = readJson(file);
            const weapons = own && mergeWeapons(own, game, effective, gameVersion);
            if (weapons) {
                writeJson(file, weapons);
                merged++;
            }
        } else if (rel === 'inv_ring.json5' && BASE_FILES[`${game}/inv_ring.json5`]) {
            const ring = mergeRing(readJson(file), game, effective, gameVersion);
            if (ring) {
                writeJson(file, ring);
                merged++;
            }
        } else if (rel === 'gameflow.json5') {
            const gameflow = readJson(file);
            if (gameflow) {
                migrateGameflow(gameflow, effective, gameVersion, scripts, notes);
                writeJson(file, gameflow);
            }
        } else if (/^strings(-[\w-]+)?\.json5$/.test(rel)) {
            const doc = readJson(file);
            if (doc) {
                migrateStrings(doc, effective, gameVersion);
                writeJson(file, doc);
            }
        }
        out.push(file);
    }

    // What the game flow did that a level script does now.
    for (const [key, lines] of scripts) {
        const path = `${prefix}scripts/${key}.lua`;
        const existing = out.find((f) => f.path === path);
        const block = 'do\n  -- Set up by the game flow before TRX 1.10.\n  local trx = _G.trx\n'
            + '  trx.events.on_game_start(function()\n'
            + lines.map((l) => '    ' + l).join('\n') + '\n  end)\nend\n';
        if (existing) {
            existing.data = encoder.encode(decoder.decode(existing.data).replace(/\n*$/, '\n') + block);
        } else {
            out.push({ path, data: encoder.encode(block) });
        }
    }
    if (scripts.size > 0) {
        notes.push(`Moved what the game flow set up for ${scripts.size} level${scripts.size === 1 ? '' : 's'} into the level scripts.`);
    }
    if (stock > 0) {
        notes.push(`Left out ${stock} unchanged cop${stock === 1 ? 'y' : 'ies'} of TRX's own files, so the current ones are used.`);
    }
    if (merged > 0) {
        notes.push(`Merged ${merged} of the game's own data file${merged === 1 ? '' : 's'} into TRX's current ones.`);
    }
    return { files: out, notes };
}
