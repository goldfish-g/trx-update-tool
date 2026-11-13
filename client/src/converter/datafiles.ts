// Brings the data files of a game made for an older TRX up to date: its game
// flow, strings, catalogs, weapons, inventory ring and injections, as
// docs/trx/MIGRATING.md describes each change.
//
// Level builders start from TRX's own files and copy them into their games.
// A copy left as it was is dropped, so the game gets what the current TRX
// ships; a file the builder changed is merged into the current one, so it
// keeps both the builder's changes and what TRX has added since.

import { BASE_FILES, BASE_INJECTIONS, OBJECT_NAMES } from '../templates/base/index.ts';
import { getTemplate } from '../templates/index.ts';
import { readLevelObjects, renumberObject } from './level.ts';
import { GAME_STRING_IDS } from './history.generated.ts';
import { parseJSON5 } from './json5.ts';
import { CURRENT_RELEASE, currentMarkup } from './lua.ts';
import { currentObjectKey, STATS_BACKGROUND } from './objects.ts';
import { currentInjectionName, isStock, stockInjections } from './stock.ts';
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

/** Maps the names every injection list of a game flow gives. */
function renameInjections(value: unknown, names: Map<string, string>): void {
    if (Array.isArray(value)) {
        for (const item of value) renameInjections(item, names);
        return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
        if (key === 'injections' && Array.isArray(child)) {
            const renamed = child.map((name) => (typeof name === 'string' ? names.get(baseName(name)) ?? name : name));
            value[key] = renamed.filter((name, i) => renamed.indexOf(name) === i);
        } else {
            renameInjections(child, names);
        }
    }
}

/**
 * Copies of TRX's injections that the game renamed take the names TRX
 * shipped them under, in its injections/ and its game flow, so that they go
 * as copies left under those names go.
 */
async function renameStockInjections(files: MappedFile[], prefix: string, gameVersion: number, gameflowFile: MappedFile | undefined): Promise<void> {
    const gameflow = gameflowFile && readJson(gameflowFile);
    if (!gameflowFile || !gameflow) return;
    const names = new Map<string, string>();
    for (const [file, stock] of await stockInjections(files, prefix + 'injections/', gameVersion)) {
        const own = baseName(file.path);
        const to = prefix + 'injections/' + stock;
        if (own === stock || files.some((other) => other.path === to)) continue;
        file.path = to;
        names.set(own, currentInjectionName(stock));
    }
    if (names.size === 0) return;
    renameInjections(gameflow, names);
    writeJson(gameflowFile, gameflow);
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

/** A setting's current name and value, for each one it became: none where the old value means the default. */
type SettingRename = (value: unknown) => [string, unknown][];

const onOff = (key: string, on: unknown, off: unknown): SettingRename =>
    (value) => (value === true ? [[key, on]] : value === false ? [[key, off]] : []);
const same = (...keys: string[]): SettingRename =>
    (value) => keys.map((key) => [key, value] as [string, unknown]);

/**
 * Settings by the names TR1X, TR2X and TRX before 1.12 gave them, and what
 * they became (TRX's config/legacy.c, and the readers of older names that
 * TRX 1.10 removed in "config: drop the migrations for 1.4 and older").
 */
const RENAMED_SETTINGS: Record<string, SettingRename> = {
    enable_game_modes: onOff('game_modes_policy', 'always', 'never'),
    enable_loading_screens: onOff('loading_screens', 'always', 'disabled'),
    load_current_music: onOff('music_load_condition', 'non-ambient', 'never'),
    enable_cine: same('enable_cutscenes'),
    enable_eidos_logo: same('enable_legal'),
    walk_to_items: same('enable_walk_to_items'),
    enabled_inverted_look: same('enable_inverted_look'),
    fix_wall_jump_glitch: (value) => (value === true ? [['wall_glitch_mode', 'fixed']] : []),
    enable_enhanced_look: onOff('look_mode', 'unrestricted', 'restricted'),
    enable_barefoot_sfx: same('enable_ps1_sfx'),
    enable_ps_uzi_sfx: same('enable_ps1_sfx'),
    fix_tihocan_secret_sound: same('fix_chainblock_secret_sound'),
    enable_buffering: same('enable_buffering_inventory', 'enable_buffering_func_keys'),
    revert_to_pistols: onOff('remember_gun_status', false, true),
    fix_pickup_drift_glitch: (value) => (value === false ? [['fix_lara_pickup_embed', false]] : []),
    brightness: same('game_brightness', 'ui_brightness'),
    enable_round_shadow: onOff('shadow_type', 'circle', 'octagon'),
    fix_glide_cameras: same('enable_glide_cameras'),
    enable_sunglasses: onOff('sunglasses_mode', 'opaque', 'off'),
    enable_target_change: onOff('target_change_mode', 'enhanced', 'off'),
    enable_breeze: (value) => (value === false ? [['breeze_mode', 'off']] : []),
    enable_save_crystals: (value) => (value === true ? [['save_crystal_mode', 'save']] : []),
    enable_neutral_twists: same('enable_alternative_turns'),
    enable_dithering: onOff('dither_mode', 'software-renderer', 'disabled'),
    enable_vertex_snap: onOff('vertex_snap_mode', '320x240', 'disabled'),
    enable_responsive_mesh_tint: onOff('water_tint_mode', 'responsive', 'whole'),
    enable_braid: onOff('braid_status', 'on', 'off'),
};

/**
 * Gives settings their current names, in place, keeping any they already
 * give by those. Returns how many it renamed.
 */
export function renameSettingKeys(settings: AnyObj): number {
    let renamed = 0;
    for (const [key, value] of Object.entries(settings)) {
        const rename = RENAMED_SETTINGS[key];
        if (!rename) continue;
        for (const [now, to] of rename(value)) {
            if (!(now in settings)) settings[now] = to;
        }
        delete settings[key];
        renamed++;
    }
    return renamed;
}

/**
 * Gives the settings a game flow enforces and hides their current names,
 * keeping any it already gives by those. Returns how many it renamed.
 */
function renameSettings(gameflow: AnyObj): number {
    let renamed = 0;
    if (isObject(gameflow.enforced_config)) renamed += renameSettingKeys(gameflow.enforced_config);
    if (Array.isArray(gameflow.hidden_config)) {
        const names: unknown[] = gameflow.hidden_config.flatMap((name: unknown) => {
            if (typeof name !== 'string' || !RENAMED_SETTINGS[name]) return [name];
            const now = RENAMED_SETTINGS[name](true).map(([key]) => key);
            return now.length > 0 ? now : RENAMED_SETTINGS[name](false).map(([key]) => key);
        });
        gameflow.hidden_config = names.filter((name, i) => names.indexOf(name) === i);
    }
    return renamed;
}

function migrateGameflow(
    gameflow: AnyObj,
    release: number,
    gameVersion: number,
    scripts: LevelScripts,
    notes: string[],
): void {
    // Paths: TRX 1.0 named files from its own directory. The file classifier
    // gave every file a lower-case name, and the engine's file system tells
    // the cases apart.
    let paths = 0;
    const walkPaths = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walkPaths);
        } else if (isObject(node)) {
            for (const key of Object.keys(node)) {
                const value = node[key];
                if (typeof value === 'string' && /^data[/\\]/i.test(value)) {
                    node[key] = value.split(/[/\\]/).pop()!.toLowerCase();
                    paths++;
                } else {
                    walkPaths(value);
                }
            }
        }
    };
    walkPaths(gameflow);
    if (paths > 0) notes.push(`Named ${paths} file${paths === 1 ? '' : 's'} the way TRX looks them up now.`);

    // Colours: the engine reads hex text, such as #72FFFF, where older
    // releases also took an array of channels from 0 to 1.
    let colors = 0;
    const walkColors = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walkColors);
        } else if (isObject(node)) {
            for (const key of Object.keys(node)) {
                const value = node[key];
                if (key === 'water_color' && Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number')) {
                    node[key] = '#' + value.map((v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
                    colors++;
                } else {
                    walkColors(value);
                }
            }
        }
    };
    walkColors(gameflow);
    if (colors > 0) notes.push(`Wrote ${colors} water color${colors === 1 ? '' : 's'} as hex text, which TRX reads now.`);

    // The places of the bars and counters, which the HUD's Lua declares now,
    // take underscores, as top_left. The HUD respells a dashed value as it
    // starts, which fails while the game flow enforces the setting.
    if (isObject(gameflow.enforced_config)) {
        for (const [key, value] of Object.entries(gameflow.enforced_config)) {
            if (typeof value === 'string' && /(_location|enemy_healthbar_show_mode)$/.test(key) && value.includes('-')) {
                gameflow.enforced_config[key] = value.replace(/-/g, '_');
            }
        }
    }

    // TRX 1.2: the savegame pattern.
    if (gameflow.savegame_fmt_bson !== undefined) {
        gameflow.savegame_file_fmt ??= gameflow.savegame_fmt_bson;
        delete gameflow.savegame_fmt_bson;
    }
    delete gameflow.savegame_fmt_legacy;
    // Tomb1Main named its ATI-format saves; TRX reads no game flow without
    // a pattern of its own ("key does not exist: savegame_file_fmt"), so one
    // that has none takes the one the converter gives a game of its kind.
    delete gameflow.savegame_fmt;
    if (typeof gameflow.savegame_file_fmt !== 'string') {
        const template = parseJSON5(getTemplate(`tr${gameVersion}-level`, 'gameflow.json5')) as AnyObj;
        if (typeof template.savegame_file_fmt === 'string') gameflow.savegame_file_fmt = template.savegame_file_fmt;
    }

    // TRX 1.9: game modes became a policy, which older game flows also gave
    // outside the enforced settings.
    if (typeof gameflow.enable_game_modes === 'boolean') {
        gameflow.game_modes_policy = gameflow.enable_game_modes ? 'always' : 'never';
        delete gameflow.enable_game_modes;
    }

    // Settings a game enforces by the names they had before. TRX reads the
    // old names only from the player's own settings, and from those of TRX
    // 1.4 and older not at all, so an enforced one is lost unless it takes
    // its current name.
    const renamed = renameSettings(gameflow);
    if (renamed > 0) notes.push(`Gave ${renamed} enforced setting${renamed === 1 ? '' : 's'} the name${renamed === 1 ? '' : 's'} TRX knows ${renamed === 1 ? 'it' : 'them'} by now.`);

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
            if (now === null) continue;
            // TRX 1.11: an object's names are one string, the name the game
            // shows first and the ones the console takes after it, split by |.
            if (isObject(value) && Array.isArray(value.names)) {
                const names = value.names.filter((name: unknown): name is string => typeof name === 'string');
                const { names: _names, ...rest } = value;
                out[now] = names.length > 0 ? { ...rest, name: rest.name ?? names.join('|') } : rest;
            } else {
                out[now] = value;
            }
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
    // Any object the engine knows may be in a game's object catalog.
    if (file === 'catalog_objects.csv') for (const name of OBJECT_NAMES) names.add(name);
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
    const unreadable: string[] = [];
    const gameflowFile = files.find((f) => f.path === prefix + 'gameflow.json5');
    await renameStockInjections(files, prefix, gameVersion, gameflowFile);
    const moved = relocateCatalogClashes(files, prefix, game, effective, gameVersion);
    if (moved > 0) notes.push(`Moved ${moved} of the game's own object${moved === 1 ? '' : 's'} out of catalog slots TRX has since given objects of its own.`);
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
        // TRX reads injections of its own format only (TRXJ, or TRXI); one
        // made for TR1X or Tomb1Main (T1MJ) it refuses, and the game's own
        // copy would hide the one TRX ships under that name.
        if (kind === 'injection' && !readableInjection(file.data)) {
            unreadable.push(name);
            continue;
        }
        if (kind !== null && (animCatalog || await isStock(file))) {
            // Kept where the TRX it now runs on no longer ships one.
            if (kind !== 'injection' || (BASE_INJECTIONS[game] ?? []).includes(currentInjectionName(name))) {
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
    if (unreadable.length > 0) {
        notes.push(`Left out ${unreadable.length} injection${unreadable.length === 1 ? '' : 's'} in a format TRX does not read, made for TR1X or Tomb1Main (${unreadable.join(', ')}); TRX's own apply where it ships them.`);
    }
    if (merged > 0) {
        notes.push(`Merged ${merged} of the game's own data file${merged === 1 ? '' : 's'} into TRX's current ones.`);
    }
    return { files: out, notes };
}

/** Whether TRX reads an injection: its own format starts TRXJ, or TRXI. */
function readableInjection(data: Uint8Array): boolean {
    const magic = String.fromCharCode(...data.subarray(0, 4));
    return magic === 'TRXJ' || magic === 'TRXI';
}

/**
 * A game's own object catalog may give a slot an object TRX has since given
 * that slot one of its own: TR1 games made for TRX 1.10 put objects of
 * other games in 330 to 332, where TRX now keeps the controls models its
 * inventory script names, and a game whose catalog takes them away stops at
 * startup ("unknown object 'controls_option_saturn'"). So the game's object
 * moves to a slot nothing uses, in its levels (the object and every item that
 * is one) and in its catalog, and TRX keeps its own. Returns how many moved.
 */
function relocateCatalogClashes(files: MappedFile[], prefix: string, game: string, release: number, gameVersion: number): number {
    const catalogFile = files.find((f) => f.path === prefix + 'catalog_objects.csv');
    if (!catalogFile) return 0;
    const text = decoder.decode(catalogFile.data);
    const base = new Map(parseCatalog(BASE_FILES[`${game}/catalog_objects.csv`] ?? '').map((row) => [row.num, row.name]));
    const known = knownNames('catalog_objects.csv');
    const clashes = parseCatalog(text).filter((row) => {
        const name = currentObjectKey(row.name, release, gameVersion);
        const theirs = base.get(row.num);
        return name !== null && known.has(name) && theirs !== undefined && theirs !== name;
    });
    if (clashes.length === 0) return 0;

    const levels = files.filter((f) => /^(levels|cuts)\/[^/]+$/.test(f.path.slice(prefix.length)));
    const used = new Set<number>([...base.keys(), ...parseCatalog(text).map((row) => row.num)]);
    for (const level of levels) for (const object of readLevelObjects(level.data)?.objects ?? []) used.add(object.id);
    let next = Math.max(...used) + 1;
    const renumbered = new Map<number, number>();
    for (const clash of clashes) {
        const to = next;
        // Only a model moves: a slot a level has as no model of its own (a
        // sprite, say) stays as it was.
        const moved = levels.map((level) => (readLevelObjects(level.data)?.objects.some((o) => o.id === clash.num) ? renumberObject(level.data, clash.num, to) : level.data));
        if (moved.some((data) => data === null)) continue;
        levels.forEach((level, i) => { level.data = moved[i]!; });
        renumbered.set(clash.num, to);
        next++;
    }
    if (renumbered.size === 0) return 0;
    catalogFile.data = encoder.encode(text.split(/\r?\n/).map((line) => {
        const m = /^(\s*)(\d+)(\s*,.*)$/.exec(line);
        const to = m ? renumbered.get(Number(m[2])) : undefined;
        return to === undefined ? line : `${m![1]}${to}${m![3]}`;
    }).join('\n'));
    return renumbered.size;
}
