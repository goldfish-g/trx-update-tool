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

import { recordedEngine, trxRelease } from './engine.ts';
import { injectLevelDefaultOutfit, addOutfitLabel } from './gameflow.ts';
import { parseJSON5 } from './json5.ts';
import { LEGACY_STRING_IDS } from './legacy.generated.ts';
import { addMeshObject, readLevelObjects } from './level.ts';
import { CURRENT_RELEASE } from './lua.ts';
import { currentInjectionName, stockInjections } from './stock.ts';
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

/** How the notes name each engine, by the name its executable gives. */
const EXECUTABLE_NAMES: Record<string, string> = {
    trx: 'TRX',
    tr1x: 'TR1X',
    tr2x: 'TR2X',
    tomb1main: 'Tomb1Main',
    tomb2main: 'Tomb2Main',
    tomb3main: 'Tomb3Main',
};

/** Where the file classifier keeps the legacy game flow and strings, inside the game's directory. */
export const LEGACY_DIR = '_meta/legacy/';
/** Left by the translation, so the migration knows the game now has TRX 1.0's shape, or the release it was made for. */
export const LEGACY_MARKER = '_meta/legacy.json';

const LEGACY_FILE = /^cfg\/((?:tomb[123]main|tr1x|tr2x)_(?:gameflow|strings)[^/]*\.json5)$/;
// TR1X 4.14, TR2X 1.4 and TRX up to 1.4 kept them in a directory of the
// game's own in cfg/, beside the ones of the games they shipped with.
const CFG_GAME_FILE = /^cfg\/(tr\d)\/((?:gameflow|strings)[^/]*\.json5)$/;

/** Where a legacy game flow or strings file goes, or null for any other file. */
export function legacyPath(lowerRelPath: string): string | null {
    const m = LEGACY_FILE.exec(lowerRelPath);
    if (m) return LEGACY_DIR + m[1];
    const cfg = CFG_GAME_FILE.exec(lowerRelPath);
    return cfg ? `${LEGACY_DIR}${cfg[1]}/${cfg[2]}` : null;
}

/** A game's flow and strings, as the engine it was made for read them. */
type LegacySource = {
    gameflow: MappedFile;
    /** Its strings files, by their names (strings.json5, strings-de.json5). */
    strings: Map<string, MappedFile>;
    /** Whether they come from cfg/<game>/, where the later releases kept them. */
    cfgLayout: boolean;
};

/**
 * The game flow of the game itself, not of the expansions or demos those
 * engines shipped beside it. One in cfg/<game>/ wins: an engine that read
 * that one never read the older name, which an upgraded game may still carry.
 */
function findLegacy(files: MappedFile[], prefix: string): LegacySource | null {
    const dir = prefix + LEGACY_DIR;
    const cfg = files.find((file) => new RegExp(`^${dir}tr\\d/gameflow\\.json5$`).test(file.path));
    const strings = new Map<string, MappedFile>();
    if (cfg) {
        const at = cfg.path.slice(0, cfg.path.length - 'gameflow.json5'.length);
        for (const file of files) {
            const name = file.path.startsWith(at) ? file.path.slice(at.length) : '';
            if (/^strings(?:-[\w-]+)?\.json5$/.test(name)) strings.set(name, file);
        }
        return { gameflow: cfg, strings, cfgLayout: true };
    }
    const flat = files.find((file) => new RegExp(`^${dir}(?:tomb[123]main|tr1x|tr2x)_gameflow\\.json5$`).test(file.path));
    if (!flat) return null;
    const own = files.find((file) => new RegExp(`^${dir}(?:tomb[123]main|tr1x|tr2x)_strings\\.json5$`).test(file.path));
    if (own) strings.set('strings.json5', own);
    return { gameflow: flat, strings, cfgLayout: false };
}

export function hasLegacyGameflow(files: MappedFile[], modDir: string): boolean {
    return findLegacy(files, `games/${modDir}/`) !== null;
}

/** The game flow a game kept in cfg/<game>/, if it has one. */
export function cfgGameflow(files: MappedFile[], modDir: string): MappedFile | undefined {
    const source = findLegacy(files, `games/${modDir}/`);
    return source?.cfgLayout ? source.gameflow : undefined;
}

/**
 * The engine a game was made for: its executable's name for itself, or else
 * what its files say. TRX 1.0 to 1.4 shipped the catalogs of the game in
 * cfg/, which the engines before it did not have.
 */
function legacyEngine(files: MappedFile[], prefix: string, source: LegacySource): { name: string; version: string | null; release: number | null } {
    const version = recordedEngine(files, prefix);
    const named = version === null ? null : /^(TRX|TR\dX|Tomb\dMain)\b/i.exec(version);
    if (version !== null && named) {
        const release = trxRelease(version, CURRENT_RELEASE);
        return { name: EXECUTABLE_NAMES[named[1].toLowerCase()] ?? named[1], version, release };
    }
    if (source.cfgLayout && files.some((file) => /^catalog_[a-z_]+\.csv$/.test(file.path.slice(prefix.length)))) {
        return { name: 'TRX', version, release: 0 };
    }
    const byName = ENGINE_NAMES.find(([pattern]) => pattern.test(source.gameflow.path))?.[1] ?? 'TR1X';
    return { name: source.cfgLayout && source.gameflow.path.includes('/tr2/') ? 'TR2X' : byName, version, release: null };
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
/** Injections TR1X 4.6 merged into another one, which TRX's own carries: lara_jumping.bin into lara_animations.bin. */
const MERGED_INJECTIONS: Record<number, [string, string][]> = { 1: [['lara_jumping.bin', 'lara_animations.bin']] };

export type LegacyResult = { files: MappedFile[]; notes: string[] };

// ---------------------------------------------------------------------------
// Lara's guns
// ---------------------------------------------------------------------------

// Those engines drew the guns in Lara's hands, in her holsters and on her
// back with meshes of the guns' own objects (lara_pistols, lara_shotgun and
// so on), each one a whole Lara whose hands hold that gun and whose thighs
// carry it. TRX draws them through her outfit, from one object of gun meshes
// and a map of where each gun's meshes are in it; without that object she
// holds nothing. So each level gets one, made of the meshes its gun objects
// already have, in a skin slot TRX's own outfits leave free, and her outfit
// a map into it: the level's own guns, as its author made them.

type GunBlock = { slot: number; gun: string; kind: 'pistol' | 'rifle' | 'flare' };

const LARA_MESHES = 15;
/** lara_skin_swap_32, past the 24 outfits lara_outfits.bin fills. */
const GUNS_SLOT: Record<number, number> = { 1: 289, 2: 333 };
const GUNS_OBJECT = 'lara_skin_swap_32';
const CLASSIC_GUNS: Record<number, GunBlock[]> = {
    1: [
        { slot: 1, gun: 'pistols', kind: 'pistol' },
        { slot: 2, gun: 'shotgun', kind: 'rifle' },
        { slot: 3, gun: 'magnums', kind: 'pistol' },
        { slot: 4, gun: 'uzis', kind: 'pistol' },
    ],
    2: [
        { slot: 1, gun: 'pistols', kind: 'pistol' },
        { slot: 4, gun: 'autos', kind: 'pistol' },
        { slot: 5, gun: 'uzis', kind: 'pistol' },
        { slot: 3, gun: 'shotgun', kind: 'rifle' },
        { slot: 6, gun: 'm16', kind: 'rifle' },
        { slot: 7, gun: 'grenade', kind: 'rifle' },
        { slot: 8, gun: 'harpoon', kind: 'rifle' },
        { slot: 9, gun: 'flare', kind: 'flare' },
    ],
};

// Lara's meshes, as every one of her objects orders them.
const THIGH_L = 1;
const THIGH_R = 4;
const TORSO = 7;
const HAND_R = 10;
const HAND_L = 13;

/** Where each gun's meshes are in the guns object: Lara's own first, then each gun object's in turn. */
function classicGunMap(blocks: GunBlock[]): AnyObj {
    const map: AnyObj = { unarmed: { thigh_r: THIGH_R, thigh_l: THIGH_L } };
    blocks.forEach((block, i) => {
        const base = (i + 1) * LARA_MESHES;
        if (block.kind === 'pistol') {
            map[block.gun] = { hand_r: base + HAND_R, hand_l: base + HAND_L, thigh_r: base + THIGH_R, thigh_l: base + THIGH_L };
        } else if (block.kind === 'rifle') {
            map[block.gun] = { hand_r: base + HAND_R, torso: base + TORSO };
        } else {
            map[block.gun] = { hand_l: base + HAND_L };
        }
    });
    return map;
}

/**
 * The level file with the guns object added, or null when it has no Lara
 * to take the meshes from, or the slot is taken. A gun the level has no
 * object for draws as Lara's empty hands.
 */
function withGunsObject(data: Uint8Array, gameVersion: number): Uint8Array | null {
    const slot = GUNS_SLOT[gameVersion];
    const blocks = CLASSIC_GUNS[gameVersion];
    const level = slot === undefined || blocks === undefined ? null : readLevelObjects(data);
    if (level === null || level.objects.some((object) => object.id === slot)) return null;
    const meshesOf = (id: number): number[] | null => {
        const object = level.objects.find((candidate) => candidate.id === id && candidate.meshCount === LARA_MESHES);
        return object ? Array.from({ length: LARA_MESHES }, (_, i) => object.firstMesh + i) : null;
    };
    const lara = meshesOf(0);
    if (lara === null) return null;
    const meshes = [...lara, ...blocks.flatMap((block) => meshesOf(block.slot) ?? lara)];
    try {
        return addMeshObject(data, level, slot, meshes);
    } catch {
        return null;
    }
}

/**
 * The name TRX knows an injection by: no directory and its current name,
 * with the game's own file moved under injections/, where TRX looks for it
 * now. A copy of one of TRX's own files goes by the name TRX shipped it
 * under, whatever the game named it, so the game gets the one the current
 * TRX ships.
 */
function injectionNamer(prefix: string, byPath: Map<string, MappedFile>, stockNames: Map<MappedFile, string>): (path: unknown) => string | null {
    const injectionNames = new Map<string, string>();
    return (path) => {
        if (typeof path !== 'string' || !path) return null;
        const own = baseName(path);
        const known = injectionNames.get(own);
        if (known !== undefined) return known;
        const file = byPath.get(prefix + 'injections/' + own) ?? byPath.get(prefix + own);
        let stock = file ? stockNames.get(file) : undefined;
        // A file of the game's own under that name wins.
        if (stock !== undefined && (byPath.get(prefix + 'injections/' + stock) ?? file) !== file) stock = undefined;
        const name = currentInjectionName(stock ?? own);
        const to = prefix + 'injections/' + (stock ?? name);
        if (file && file.path !== to && !byPath.has(to)) {
            byPath.delete(file.path);
            file.path = to;
            byPath.set(to, file);
        }
        injectionNames.set(own, name);
        return name;
    };
}

/**
 * Gives a game made for one of the engines before TRX the game flow and strings
 * files of a TRX 1.0 game, in games/<mod>/, and one made for TRX 1.0 to 1.4
 * the place TRX keeps them in now. Returns null when it has no such game
 * flow, or one that cannot be read.
 */
export async function translateLegacy(mapped: MappedFile[], modDir: string, gameVersion: number, modTitle: string): Promise<LegacyResult | null> {
    const prefix = `games/${modDir}/`;
    const source = findLegacy(mapped, prefix);
    if (!source) return null;
    let old: AnyObj;
    try {
        old = parseJSON5(new TextDecoder().decode(source.gameflow.data)) as AnyObj;
    } catch {
        return null;
    }
    if (!isObject(old) || !Array.isArray(old.levels)) return null;
    const engine = legacyEngine(mapped, prefix, source);
    if (engine.release !== null) return moveTRXGame(mapped, modDir, gameVersion, modTitle, source, old, { ...engine, release: engine.release });

    const files = mapped.slice();
    const notes: string[] = [];
    const encoder = new TextEncoder();
    const byPath = new Map(files.map((file) => [file.path, file]));

    // The strings: TR1X 4.8 to 4.13 kept them in a file of their own, the
    // releases before in the game flow.
    const strings: Strings = { levels: [], cutscenes: [], objects: {}, game_strings: {} };
    const ownStrings = source.strings.get('strings.json5');
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

    const stockNames = await stockInjections(files, prefix, gameVersion);
    const injection = injectionNamer(prefix, byPath, stockNames);
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

    // An injection TR1X merged into another goes where the game takes that
    // other one from TRX, whose own carries it: injected on top, it would
    // apply its changes a second time.
    const fromTRX = (name: string): boolean => {
        const file = byPath.get(prefix + 'injections/' + name);
        return !file || stockNames.get(file) === name;
    };
    for (const [merged, into] of MERGED_INJECTIONS[gameVersion] ?? []) {
        if (!fromTRX(merged) || !fromTRX(into)) continue;
        const inherited = Array.isArray(out.injections) && out.injections.includes(into);
        const holders: AnyObj[] = [out, ...(out.title ? [out.title] : []), ...levels, ...cutscenes];
        for (const holder of holders) {
            const list = holder.injections;
            if (!Array.isArray(list) || !list.includes(merged)) continue;
            if (list.includes(into) || (holder !== out && holder.inherit_injections !== false && inherited)) {
                holder.injections = list.filter((name: string) => name !== merged);
            }
        }
        const file = byPath.get(prefix + 'injections/' + merged);
        if (file && !holders.some((holder) => Array.isArray(holder.injections) && holder.injections.includes(merged))) {
            files.splice(files.indexOf(file), 1);
            byPath.delete(file.path);
        }
    }
    if (fmvs.length > 0) out.fmvs = fmvs;
    out.engine = gameVersion;
    out.extends = `tr${gameVersion}`;
    if (modTitle) out.name = modTitle;

    const doc: AnyObj = { levels: strings.levels };
    if (strings.cutscenes.length > 0) doc.cutscenes = strings.cutscenes;
    if (Object.keys(strings.objects).length > 0) doc.objects = strings.objects;
    if (Object.keys(strings.game_strings).length > 0) doc.game_strings = strings.game_strings;

    const write = writer(files, byPath, encoder);
    write(prefix + 'gameflow.json5', out);
    write(prefix + 'strings.json5', doc);
    const armed = dressAsLevels(files, byPath, write, out, modDir, gameVersion);

    notes.push(`Made for ${engine.version ?? engine.name}: gave its game flow and strings the shape TRX 1.0 reads, and kept Lara in the outfit her levels carry.`);
    if (armed > 0) notes.push(`Gave Lara the guns her levels carry in ${armed} level${armed === 1 ? '' : 's'}, through her outfit, where TRX draws them now.`);
    if (lost > 0) notes.push(`Left out ${lost} flip map or mesh swap event${lost === 1 ? '' : 's'}, which TRX no longer has.`);
    write(prefix + LEGACY_MARKER, { engine: engine.name, notes });

    // What is left of the legacy files is the converter's working copy.
    return { files: files.filter((file) => !file.path.startsWith(prefix + LEGACY_DIR)), notes };
}

type Write = (path: string, value: unknown) => void;

/** Writes a file as JSON into the game's files, in place of one at that path. */
function writer(files: MappedFile[], byPath: Map<string, MappedFile>, encoder: TextEncoder): Write {
    return (path, value) => {
        const data = encoder.encode(JSON.stringify(value, null, 4));
        const existing = byPath.get(path);
        if (existing) existing.data = data;
        else {
            const file = { path, data };
            files.push(file);
            byPath.set(path, file);
        }
    };
}

/**
 * Dresses Lara in what her levels carry, for a game made for an engine
 * without outfits, as the level_default outfit its levels and cutscenes
 * already name: her braid, and her guns through the outfit. Returns how many
 * levels got the object of their gun meshes.
 */
function dressAsLevels(files: MappedFile[], byPath: Map<string, MappedFile>, write: Write, out: AnyObj, modDir: string, gameVersion: number): number {
    const prefix = `games/${modDir}/`;
    const levels: AnyObj[] = Array.isArray(out.levels) ? out.levels : [];
    const cutscenes: AnyObj[] = Array.isArray(out.cutscenes) ? out.cutscenes : [];
    // Lara's braid. TRX draws it from meshes of its own in lara_outfits.bin,
    // where those engines took the braid object of braid.bin. A game that
    // injected TR1X's own braid.bin gets TRX's braid, drawn on Lara's own head
    // and torso; one that brought a braid of its own, which TRX cannot draw,
    // or none, shows Lara as her levels have her.
    const lists = [out.injections, ...levels.map((level) => level.injections), ...cutscenes.map((cutscene) => cutscene.injections)];
    const stockBraid = lists.some((list) => Array.isArray(list) && list.includes('braid.bin'));

    // Her guns: each level she plays gets the object of its gun meshes.
    let armed = 0;
    for (const level of levels) {
        if (level.type === 'dummy' || level.type === 'current' || typeof level.path !== 'string') continue;
        const file = byPath.get(prefix + 'levels/' + level.path);
        const changed = file ? withGunsObject(file.data, gameVersion) : null;
        if (file && changed) {
            file.data = changed;
            armed++;
        }
    }

    // TRX dresses her only where its outfit objects are, lara_outfits.bin.
    if (stockBraid || armed > 0) {
        for (const list of [out.injections, ...levels.filter((level) => level.inherit_injections === false).map((level) => level.injections)]) {
            if (Array.isArray(list) && !list.includes('lara_outfits.bin')) list.push('lara_outfits.bin');
        }
        write(prefix + 'gameflow.json5', out);
    }
    for (const file of injectLevelDefaultOutfit(modDir, gameVersion)) {
        const outfits = JSON.parse(new TextDecoder().decode(file.data)) as AnyObj;
        const own = outfits.outfits?.level_default;
        if (isObject(own)) {
            if (stockBraid && Array.isArray(own.braid)) own.braid = own.braid.map((braid: AnyObj) => ({ ...braid, mode: 'none' }));
            else delete own.braid;
            if (armed > 0 && Array.isArray(outfits.gun_maps)) {
                outfits.gun_maps.push(classicGunMap(CLASSIC_GUNS[gameVersion]));
                own.gun_map = outfits.gun_maps.length - 1;
                own.guns_object = GUNS_OBJECT;
            }
        }
        write(file.path, outfits);
    }
    addOutfitLabel(files, modDir);
    return armed;
}

/** The keys of a TRX 1.0 game flow that name a file. */
const FILE_KEYS = new Set(['path', 'background_path', 'main_menu_picture', 'sfx_path']);

/**
 * Gives a game made for TRX 1.0 to 1.4, or a build before 1.0, the place of
 * its files that TRX has had since 1.5: its game flow and strings in its own
 * directory rather than cfg/<game>/, and every file it names by the name
 * TRX looks up there, rather than by its path from TRX's directory. What
 * those releases read is otherwise left as it was, for the migration to
 * bring from the release the game was made for (its marker says which).
 * TRX dressed Lara in outfits from 1.2; a game made before wears what her
 * levels carry, as she did.
 */
async function moveTRXGame(
    mapped: MappedFile[],
    modDir: string,
    gameVersion: number,
    modTitle: string,
    source: LegacySource,
    old: AnyObj,
    engine: { name: string; version: string | null; release: number },
): Promise<LegacyResult> {
    const prefix = `games/${modDir}/`;
    const files = mapped.slice();
    const byPath = new Map(files.map((file) => [file.path, file]));
    const encoder = new TextEncoder();
    const write = writer(files, byPath, encoder);
    const notes: string[] = [];

    const stockNames = await stockInjections(files, prefix, gameVersion);
    const injection = injectionNamer(prefix, byPath, stockNames);
    const injections = (list: unknown): string[] | undefined =>
        Array.isArray(list) ? list.map(injection).filter((name): name is string => name !== null) : undefined;

    const out: AnyObj = {};
    for (const [key, value] of Object.entries(old)) {
        if (DROPPED.includes(key) || TO_ENFORCED.includes(key)) continue;
        out[key] = value;
    }
    // A build before TRX 1.0 still had some of the settings 1.0 made the
    // player's.
    const enforced: AnyObj = isObject(old.enforced_config) ? { ...old.enforced_config } : {};
    for (const key of TO_ENFORCED) {
        if (old[key] !== undefined) enforced[key] ??= old[key];
    }
    if (Object.keys(enforced).length > 0) out.enforced_config = enforced;

    // Files by name, as the file classifier placed them: lower case, with no
    // directory.
    let named = 0;
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walk);
        } else if (isObject(node)) {
            for (const [key, value] of Object.entries(node)) {
                if (key === 'enforced_config') continue;
                if (key === 'injections' && Array.isArray(value)) {
                    node[key] = injections(value);
                } else if (FILE_KEYS.has(key) && typeof value === 'string') {
                    const name = baseName(value);
                    if (name !== value) named++;
                    node[key] = name;
                } else {
                    walk(value);
                }
            }
        }
    };
    walk(out);
    const laraInjections = LARA_INJECTIONS[gameVersion] ?? [];
    const own = Array.isArray(out.injections) ? out.injections as string[] : [];
    out.injections = [...own, ...laraInjections.filter((name) => !own.includes(name))];

    const levels: AnyObj[] = Array.isArray(out.levels) ? out.levels : [];
    const cutscenes: AnyObj[] = Array.isArray(out.cutscenes) ? out.cutscenes : [];
    const dressed = engine.release < 2;
    if (dressed) {
        for (const entry of [...levels, ...cutscenes]) {
            if (isObject(entry) && entry.type !== 'dummy' && entry.type !== 'current') entry.lara_outfit ??= 'level_default';
        }
    }
    out.engine = gameVersion;
    out.extends = `tr${gameVersion}`;
    if (modTitle) out.name = modTitle;
    write(prefix + 'gameflow.json5', out);

    // Its strings, as that release read them.
    for (const [name, file] of source.strings) {
        const to = prefix + name;
        if (byPath.has(to)) continue;
        const copy = { path: to, data: file.data };
        files.push(copy);
        byPath.set(to, copy);
    }
    if (!byPath.has(prefix + 'strings.json5')) {
        write(prefix + 'strings.json5', { levels: levels.map((level) => ({ title: typeof level.path === 'string' ? level.path.replace(/\.[^.]+$/, '') : 'Level' })) });
    }

    const armed = dressed ? dressAsLevels(files, byPath, write, out, modDir, gameVersion) : 0;

    const release = `TRX 1.${engine.release}`;
    const made = engine.version !== null && !engine.version.startsWith(release) ? `${release} (${engine.version})` : release;
    notes.push(`Made for ${made}: moved its game flow, strings and data files from cfg/ into its own directory${named > 0 ? `, and named ${named} file${named === 1 ? '' : 's'} the way TRX looks them up now` : ''}.`);
    if (dressed) notes.push('Kept Lara in the outfit her levels carry, as TRX dressed her before 1.2.');
    if (armed > 0) notes.push(`Gave Lara the guns her levels carry in ${armed} level${armed === 1 ? '' : 's'}, through her outfit, where TRX draws them now.`);
    write(prefix + LEGACY_MARKER, { engine: engine.name, release: engine.release, notes });
    return { files: files.filter((file) => !file.path.startsWith(prefix + LEGACY_DIR)), notes };
}
