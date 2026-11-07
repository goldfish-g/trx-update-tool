// Games made for the engines before TRX: Tomb1Main, TR1X and TR2X, and the
// names TR2X and a TR3 project went by before (Tomb2Main, Tomb3Main). Their
// game flow (cfg/TR1X_gameflow.json5 and the like) takes the shape TRX 1.0
// gave it, following the steps docs/trx/MIGRATING.md gives for each release
// (TR1X 4.7 to 4.8, 4.9 to 4.10, 4.13 to 4.14 and 4.15 to TRX 1.0; TR2X 1.5
// to TRX 1.0), with the strings it carries moved into a strings file and the
// injections of its own under injections/. From there the game takes the
// way every game made for TRX 1.0 takes to the current TRX (migrate.ts).
//
// Those engines had no outfits: Lara wore the meshes her levels carry, as
// the levels' author made them. So she keeps wearing them, as the
// converter's level_default outfit.

import { injectLevelDefaultOutfit, addOutfitLabel } from './gameflow.ts';
import { parseJSON5 } from './json5.ts';
import { LEGACY_STRING_IDS } from './legacy.generated.ts';
import type { MappedFile } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

/** How the notes name each engine, by its files' names. */
const ENGINE_NAMES: [RegExp, string][] = [
    [/\/tomb1main_/i, 'Tomb1Main'],
    [/\/tomb2main_/i, 'Tomb2Main'],
    [/\/tomb3main_/i, 'Tomb3Main'],
    [/\/tr2x_/i, 'TR2X'],
];

/** Where the file classifier keeps the legacy game flow and strings, inside the game's directory. */
export const LEGACY_DIR = '_meta/legacy/';
/** Left by the translation, so the migration knows the game now has TRX 1.0's shape. */
export const LEGACY_MARKER = '_meta/legacy.json';

const LEGACY_FILE = /^cfg\/((?:tomb[123]main|tr1x|tr2x)_(?:gameflow|strings)[^/]*\.json5)$/;

/** Where a legacy game flow or strings file goes, or null for any other file. */
export function legacyPath(lowerRelPath: string): string | null {
    const m = LEGACY_FILE.exec(lowerRelPath);
    return m ? LEGACY_DIR + m[1] : null;
}

/** The game flow of the game itself, not of the expansions or demos those engines shipped beside it. */
function findLegacy(files: MappedFile[], prefix: string, kind: 'gameflow' | 'strings', language = ''): MappedFile | undefined {
    const wanted = new RegExp(`^${prefix}${LEGACY_DIR}(?:tomb[123]main|tr1x|tr2x)_${kind}${language}\\.json5$`);
    return files.find((file) => wanted.test(file.path));
}

export function hasLegacyGameflow(files: MappedFile[], modDir: string): boolean {
    return findLegacy(files, `games/${modDir}/`, 'gameflow') !== undefined;
}

function isObject(value: unknown): value is AnyObj {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function baseName(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

/** The inventory names those engines kept with the game strings, by the TRX 1.0 object they name. */
const ITEM_OBJECTS: Record<string, string> = {
    MEDI: 'small_medipack',
    BIG_MEDI: 'large_medipack',
    PISTOLS: 'pistols',
    SHOTGUN: 'shotgun',
    MAGNUM: 'magnums',
    MAGNUMS: 'magnums',
    UZI: 'uzis',
    UZIS: 'uzis',
    PISTOL_AMMO: 'pistols_ammo',
    SHOTGUN_AMMO: 'shotgun_ammo',
    MAGNUM_AMMO: 'magnums_ammo',
    UZI_AMMO: 'uzis_ammo',
    GRENADE: 'grenade',
    LEADBAR: 'lead_bar',
    SCION: 'scion',
    COMPASS: 'compass',
    GAME: 'passport',
    LARAS_HOME: 'photo',
    DETAILS: 'graphics',
    CONTROLS: 'controls',
    SOUND: 'sound',
};

/**
 * The TRX 1.0 object an inventory name is for: INV_ITEM_KEY1 or
 * INV_ITEM_KEY_1 names key_1, INV_ITEM_MEDI the small medipack. Per-level
 * names used plain keys, as key1 or puzzle2.
 */
function itemObject(id: string): string | null {
    const name = id.replace(/^INV_ITEM_/i, '').toUpperCase();
    const numbered = /^(KEY|PUZZLE|PICKUP)_?(\d)$/.exec(name);
    if (numbered) return `${numbered[1].toLowerCase()}_${numbered[2]}`;
    return ITEM_OBJECTS[name] ?? null;
}

/**
 * A game string by its TRX 1.3 id. Statistics lines were formats once, such
 * as "SECRETS %d of %d", and are labels now; a renamed format keeps its words.
 */
function gameString(id: string, text: string): [string, string] | null {
    const mapped = LEGACY_STRING_IDS[id];
    if (mapped) return [mapped, text];
    const label = /^(STATS_[A-Z_]+?)(?:_(?:BASIC|DETAIL))?_FMT$/.exec(id);
    if (label && LEGACY_STRING_IDS[label[1]]) {
        const words = text.replace(/%[-+ #0]*\d*(?:\.\d+)?[dsfiu]/g, '').replace(/\s+(of|\/)\s*$/i, '').replace(/\s+/g, ' ').trim();
        if (words) return [LEGACY_STRING_IDS[label[1]], words];
    }
    return null;
}

type Strings = { levels: AnyObj[]; cutscenes: AnyObj[]; objects: AnyObj; game_strings: AnyObj };

function setObjectText(objects: AnyObj, key: string, field: 'name' | 'description', text: unknown): void {
    if (typeof text !== 'string') return;
    objects[key] = { ...(isObject(objects[key]) ? objects[key] : {}), [field]: text };
}

/** Game strings and inventory names, from a flat table of ids, into the strings file. */
function addFlatStrings(table: unknown, objects: AnyObj, gameStrings: AnyObj): void {
    if (!isObject(table)) return;
    for (const [id, text] of Object.entries(table)) {
        if (typeof text !== 'string') continue;
        const item = /^INV_ITEM_/i.test(id) ? itemObject(id) : null;
        if (item) {
            setObjectText(objects, item, 'name', text);
            continue;
        }
        const string = gameString(id, text);
        if (string) gameStrings[string[0]] = string[1];
    }
}

/** A level's own item names and descriptions: "strings" and "examine" by plain key, or game strings by id. */
function levelObjects(level: AnyObj): AnyObj {
    const objects: AnyObj = {};
    for (const [field, source] of [['name', level.strings], ['description', level.examine]] as const) {
        if (!isObject(source)) continue;
        for (const [key, text] of Object.entries(source)) {
            const item = itemObject(key);
            if (item) setObjectText(objects, item, field, text);
        }
    }
    if (isObject(level.game_strings)) {
        for (const [id, text] of Object.entries(level.game_strings)) {
            const item = itemObject(id);
            if (item) setObjectText(objects, item, 'name', text);
        }
    }
    if (isObject(level.objects)) Object.assign(objects, level.objects);
    return objects;
}

// ---------------------------------------------------------------------------
// The game flow
// ---------------------------------------------------------------------------

/** Settings that became the player's, which a game may still enforce (TR1X 4.15 and TR2X 1.5 to TRX 1.0). */
const TO_ENFORCED = ['demo_delay', 'enable_killer_pushblocks', 'lockout_option_ring', 'load_save_disabled', 'play_any_level', 'cheat_keys'];
/** Settings TRX 1.0 dropped. */
const DROPPED = ['savegame_fmt_legacy', 'single_level', 'is_demo_version', 'demo_version', 'secret_track', 'gym_enabled',
    'cmd_init', 'cmd_title', 'cmd_death_in_demo', 'cmd_death_in_game', 'cmd_demo_end', 'cmd_demo_interrupt'];
/** Sequence events that TRX 1.0 no longer has or needs. */
const DROPPED_EVENTS = new Set(['start_game', 'stop_game', 'start_cine', 'set_cam_x', 'set_cam_y', 'set_cam_z', 'set_cam_angle']);
/** Events TRX 1.0 has no counterpart for, which a level then plays without. */
const LOST_EVENTS = new Set(['flip_map', 'mesh_swap']);
/** Injections Lara needs since TRX 1.0, where her levels do not bring her shotgun and extra animations. */
const LARA_INJECTIONS: Record<number, string[]> = { 1: ['lara_guns.bin', 'lara_extra.bin'], 2: ['lara_extra.bin'] };
const RENAMED_INJECTIONS: Record<string, string> = { 'purple_crystal.bin': 'crystal.bin' };

export type LegacyResult = { files: MappedFile[]; notes: string[] };

/**
 * Gives a game made for one of the engines before TRX the game flow and strings
 * files of a TRX 1.0 game, in games/<mod>/. Returns null when it has no
 * legacy game flow, or one that cannot be read.
 */
export function translateLegacy(mapped: MappedFile[], modDir: string, gameVersion: number, modTitle: string): LegacyResult | null {
    const prefix = `games/${modDir}/`;
    const source = findLegacy(mapped, prefix, 'gameflow');
    if (!source) return null;
    let old: AnyObj;
    try {
        old = parseJSON5(new TextDecoder().decode(source.data)) as AnyObj;
    } catch {
        return null;
    }
    if (!isObject(old) || !Array.isArray(old.levels)) return null;

    const files = mapped.slice();
    const notes: string[] = [];
    const encoder = new TextEncoder();
    const byPath = new Map(files.map((file) => [file.path, file]));

    // The strings: TR1X 4.8 to 4.13 kept them in a file of their own, the
    // releases before in the game flow.
    const strings: Strings = { levels: [], cutscenes: [], objects: {}, game_strings: {} };
    const ownStrings = findLegacy(files, prefix, 'strings');
    let levelStrings: AnyObj[] = [];
    if (ownStrings) {
        try {
            const doc = parseJSON5(new TextDecoder().decode(ownStrings.data)) as AnyObj;
            if (Array.isArray(doc.levels)) levelStrings = doc.levels;
            if (isObject(doc.objects)) Object.assign(strings.objects, doc.objects);
            addFlatStrings(doc.game_strings, strings.objects, strings.game_strings);
        } catch {
            notes.push('Could not read the game’s strings file, so its levels keep their file names.');
        }
    }
    addFlatStrings(old.strings, strings.objects, strings.game_strings);
    addFlatStrings(old.game_strings, strings.objects, strings.game_strings);

    // Injections: no directory, TRX's current name, and the game's own
    // files under injections/, where TRX looks for them now.
    const injection = (path: unknown): string | null => {
        if (typeof path !== 'string' || !path) return null;
        const name = RENAMED_INJECTIONS[baseName(path)] ?? baseName(path);
        const loose = byPath.get(prefix + name);
        if (loose && !byPath.has(prefix + 'injections/' + name)) {
            byPath.delete(loose.path);
            loose.path = prefix + 'injections/' + name;
            byPath.set(loose.path, loose);
        }
        return name;
    };
    const injections = (list: unknown): string[] | undefined =>
        Array.isArray(list) ? list.map(injection).filter((name): name is string => name !== null) : undefined;

    const out: AnyObj = {};
    for (const [key, value] of Object.entries(old)) {
        if (['levels', 'strings', 'game_strings', 'injections', 'main_menu_picture', 'enforced_config'].includes(key)) continue;
        if (DROPPED.includes(key) || TO_ENFORCED.includes(key)) continue;
        out[key] = value;
    }
    if (typeof old.main_menu_picture === 'string') out.main_menu_picture = baseName(old.main_menu_picture);
    if (out.draw_distance_fade !== undefined) {
        out.fog_start ??= out.draw_distance_fade;
        delete out.draw_distance_fade;
    }
    if (out.draw_distance_max !== undefined) {
        out.fog_end ??= out.draw_distance_max;
        delete out.draw_distance_max;
    }
    const enforced: AnyObj = isObject(old.enforced_config) ? { ...old.enforced_config } : {};
    for (const key of TO_ENFORCED) {
        if (old[key] !== undefined) enforced[key] ??= old[key];
    }
    if (Object.keys(enforced).length > 0) out.enforced_config = enforced;

    const laraInjections = LARA_INJECTIONS[gameVersion] ?? [];
    const withLara = (list: string[]): string[] => [...list, ...laraInjections.filter((name) => !list.includes(name))];
    out.injections = withLara(injections(old.injections) ?? []);

    // Old level numbers, for the events that named levels by them.
    const cutsceneIds = new Map<number, number>();
    old.levels.forEach((level: AnyObj, index: number) => {
        if (isObject(level) && level.type === 'cutscene') cutsceneIds.set(index, cutsceneIds.size);
    });

    const fmvs: AnyObj[] = Array.isArray(old.fmvs) ? old.fmvs.map((fmv: AnyObj) => ({ ...fmv, path: baseName(String(fmv.path ?? '')) })) : [];
    const fmvId = (path: string): number => {
        const name = baseName(path);
        const known = fmvs.findIndex((fmv) => fmv.path === name);
        if (known >= 0) return known;
        fmvs.push({ path: name });
        return fmvs.length - 1;
    };

    let lost = 0;
    const sequence = (events: unknown): AnyObj[] => {
        if (!Array.isArray(events)) return [];
        const result: AnyObj[] = [];
        for (const original of events) {
            if (!isObject(original) || typeof original.type !== 'string') continue;
            const event: AnyObj = { ...original };
            if (DROPPED_EVENTS.has(event.type)) continue;
            if (LOST_EVENTS.has(event.type)) {
                lost++;
                continue;
            }
            switch (event.type) {
                case 'loop_cine':
                    event.type = 'loop_game';
                    break;
                case 'exit_to_cine': {
                    const id = cutsceneIds.get(Number(event.level_id));
                    if (id === undefined) continue;
                    result.push({ type: 'play_cutscene', cutscene_id: id });
                    continue;
                }
                case 'exit_to_level':
                    result.push({ type: 'level_complete' });
                    continue;
                case 'level_stats':
                    delete event.level_id;
                    break;
                case 'display_picture':
                case 'loading_screen':
                    if (event.picture_path !== undefined) {
                        event.path ??= baseName(String(event.picture_path));
                        delete event.picture_path;
                    } else if (typeof event.path === 'string') {
                        event.path = baseName(event.path);
                    }
                    break;
                case 'total_stats':
                    if (event.picture_path !== undefined) {
                        event.background_path ??= baseName(String(event.picture_path));
                        delete event.picture_path;
                    }
                    break;
                case 'play_fmv':
                    if (typeof event.fmv_path === 'string') {
                        event.fmv_id = fmvId(event.fmv_path);
                        delete event.fmv_path;
                    }
                    break;
                case 'play_synced_audio':
                    result.push({ type: 'play_music', music_track: event.audio_id ?? event.music_track });
                    continue;
                case 'remove_guns':
                    event.type = 'remove_weapons';
                    break;
            }
            result.push(event);
        }
        return result;
    };

    const levels: AnyObj[] = [];
    const cutscenes: AnyObj[] = [];
    let title: AnyObj | null = isObject(old.title) ? { ...old.title } : null;
    old.levels.forEach((original: AnyObj, index: number) => {
        if (!isObject(original)) return;
        const type = original.type === 'level_demo_pc' ? 'normal' : original.type === 'title_demo_pc' ? 'title' : (original.type ?? 'normal');
        const level: AnyObj = {};
        for (const [key, value] of Object.entries(original)) {
            if (['file', 'music', 'title', 'strings', 'examine', 'game_strings', 'objects', 'type', 'sequence', 'injections'].includes(key)) continue;
            level[key] = value;
        }
        const path = original.path ?? original.file;
        if (typeof path === 'string') level.path = baseName(path);
        level.music_track = original.music_track ?? original.music ?? -1;
        if (original.draw_distance_fade !== undefined) {
            level.fog_start ??= original.draw_distance_fade;
            delete level.draw_distance_fade;
        }
        if (original.draw_distance_max !== undefined) {
            level.fog_end ??= original.draw_distance_max;
            delete level.draw_distance_max;
        }
        level.sequence = sequence(original.sequence);
        const own = injections(original.injections);
        if (own !== undefined) level.injections = own;

        if (type === 'title') {
            title = level;
            return;
        }
        // Lara wears what her levels carry, as she did in the engine they were made for.
        if (type !== 'dummy' && type !== 'current') level.lara_outfit ??= 'level_default';
        if (original.inherit_injections === false && type !== 'dummy' && type !== 'current') level.injections = withLara(level.injections ?? []);
        const name = typeof original.title === 'string' ? original.title : levelStrings[index]?.title;
        if (type === 'cutscene') {
            cutscenes.push(level);
            strings.cutscenes.push({ title: name ?? `Cutscene ${cutscenes.length}` });
            return;
        }
        level.type = type === 'gym' && old.gym_enabled === false ? 'dummy' : type;
        if (level.type === 'normal') delete level.type;
        levels.push(level);
        const objects = { ...levelObjects(original), ...(isObject(levelStrings[index]) ? levelObjects(levelStrings[index]) : {}) };
        const entry: AnyObj = { title: name ?? (typeof level.path === 'string' ? level.path.replace(/\.[^.]+$/, '') : 'Level') };
        if (Object.keys(objects).length > 0) entry.objects = objects;
        strings.levels.push(entry);
    });

    if (title !== null) {
        const t = title as AnyObj;
        if (typeof t.path === 'string') t.path = baseName(t.path);
        if (Array.isArray(t.sequence)) t.sequence = sequence(t.sequence);
        out.title = t;
    }
    out.levels = levels;
    if (cutscenes.length > 0) out.cutscenes = cutscenes;
    if (fmvs.length > 0) out.fmvs = fmvs;
    out.engine = gameVersion;
    out.extends = `tr${gameVersion}`;
    if (modTitle) out.name = modTitle;

    const doc: AnyObj = { levels: strings.levels };
    if (strings.cutscenes.length > 0) doc.cutscenes = strings.cutscenes;
    if (Object.keys(strings.objects).length > 0) doc.objects = strings.objects;
    if (Object.keys(strings.game_strings).length > 0) doc.game_strings = strings.game_strings;

    const write = (path: string, value: unknown) => {
        const data = encoder.encode(JSON.stringify(value, null, 4));
        const existing = byPath.get(path);
        if (existing) existing.data = data;
        else {
            const file = { path, data };
            files.push(file);
            byPath.set(path, file);
        }
    };
    write(prefix + 'gameflow.json5', out);
    write(prefix + 'strings.json5', doc);
    // Lara's braid. TRX draws it from meshes of its own in lara_outfits.bin,
    // where those engines took the braid object of braid.bin. A game that
    // injected TR1X's own braid.bin gets TRX's braid, drawn on Lara's own head
    // and torso; one that brought a braid of its own, which TRX cannot draw,
    // or none, shows Lara as her levels have her.
    const lists = [out.injections, ...levels.map((level) => level.injections), ...cutscenes.map((cutscene) => cutscene.injections)];
    const stockBraid = lists.some((list) => Array.isArray(list) && list.includes('braid.bin'));
    if (stockBraid) {
        for (const list of [out.injections, ...levels.filter((level) => level.inherit_injections === false).map((level) => level.injections)]) {
            if (Array.isArray(list) && !list.includes('lara_outfits.bin')) list.push('lara_outfits.bin');
        }
    }
    for (const file of injectLevelDefaultOutfit(modDir, gameVersion)) {
        const outfits = JSON.parse(new TextDecoder().decode(file.data)) as AnyObj;
        const own = outfits.outfits?.level_default;
        if (isObject(own)) {
            if (stockBraid && Array.isArray(own.braid)) own.braid = own.braid.map((braid: AnyObj) => ({ ...braid, mode: 'none' }));
            else delete own.braid;
        }
        write(file.path, outfits);
    }
    addOutfitLabel(files, modDir);

    const engine = ENGINE_NAMES.find(([pattern]) => pattern.test(source.path))?.[1] ?? 'TR1X';
    notes.push(`Made for ${engine}: gave its game flow and strings the shape TRX 1.0 reads, and kept Lara in the outfit her levels carry.`);
    if (lost > 0) notes.push(`Left out ${lost} flip map or mesh swap event${lost === 1 ? '' : 's'}, which TRX no longer has.`);
    write(prefix + LEGACY_MARKER, { engine, notes });

    // What is left of the legacy files is the converter's working copy.
    return { files: files.filter((file) => !file.path.startsWith(prefix + LEGACY_DIR)), notes };
}
