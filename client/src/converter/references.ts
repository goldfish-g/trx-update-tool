// The files a converted game flow names, settled against what the game
// brings and what TRX ships, as TRX looks them up (paths.c).
//
// Levels. Every level, cutscene and demo a game flow names has to be a file
// TRX finds, or TRX reads none of the game flow ("no file named by 'path' is
// installed") and the game does not start. Games made for the original
// engines, TR1X, TR2X and older TRX releases often name levels they do not
// bring: the stock game's own, left in a game flow copied from the stock
// one, which those engines took from the player's copy of the game. TRX looks
// for a level only in the game's own directory, apart from a title or home
// level, which may come from the game it extends (GAME_DYNAMIC_PATH_LEVEL_FILE
// and _SHARED_LEVEL_FILE). So a level named by another spelling of a file the
// game brings takes that file's name, and one it does not bring at all
// becomes a stand-in TRX passes over: a dummy level, which keeps the numbers
// of the levels after it and plays nothing (a cutscene played by number then
// plays nothing too), or, for a demo, which nothing names by number, no entry.
//
// Injections. TRX finds an injection by its name in the game's injections/,
// then in those of the game it extends; a path from an older layout, such as
// data/injections/font.bin, finds nothing, and the level loads without it.
// Such a path takes the name TRX knows the file by, and one neither the game
// nor TRX has goes, as TRX would pass it over anyway.

import { parseJSON5 } from './json5.ts';
import { currentInjectionName } from './stock.ts';
import { BASE_FILES, BASE_INJECTIONS } from '../templates/base/index.ts';
import { cdTracks, readLevel, readLevelObjects, removeObjects } from './level.ts';
import { BASE_GAME_FILES } from './basefiles.generated.ts';
import type { MappedFile } from './types.ts';

type AnyObj = Record<string, any>;

const isObject = (value: unknown): value is AnyObj => typeof value === 'object' && value !== null && !Array.isArray(value);
const baseName = (path: string): string => path.slice(path.replace(/\\/g, '/').lastIndexOf('/') + 1);
const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

/**
 * A file of the original game a converted game needs and does not bring,
 * which the app fetches from the server that holds the game and puts at
 * `to` in the game's directory: a level or cutscene, the sound file, a video,
 * or a music track (`to` then lacks the extension, which is the server's).
 */
export type BaseNeed = { kind: 'level' | 'cut' | 'sfx' | 'fmv' | 'music'; name: string; to: string };

export type SettleOptions = {
    /**
     * Whether the original game's files a game needs are to come from the
     * server (into `needs`), rather than the game doing without them.
     */
    fetchBase?: boolean;
    needs?: BaseNeed[];
};

/** TR1X's names of the stock game's pictures, which TRX ships under these. */
const STOCK_PICTURES: Record<string, string> = { cred1: 'credits_1.webp', cred2: 'credits_2.webp', cred3: 'credits_3.webp', eidospc: 'eidos.webp' };

/** Sequence events that end the game: no level after one is played. */
const GAME_ENDS = new Set(['total_stats', 'exit_to_title', 'play_credits']);

export function settleReferences(files: MappedFile[], modDir: string, gameVersion: number, options: SettleOptions = {}): string[] {
    const prefix = `games/${modDir}/`;
    const file = files.find((f) => f.path === prefix + 'gameflow.json5');
    if (!file) return [];
    let flow: unknown;
    try {
        flow = parseJSON5(new TextDecoder().decode(file.data));
    } catch {
        return [];
    }
    if (!isObject(flow)) return [];
    const base = options.fetchBase ? BASE_GAME_FILES[gameVersion] : undefined;
    const needs = options.needs ?? [];
    const need = (kind: BaseNeed['kind'], name: string, to: string): void => {
        if (!needs.some((other) => other.to === to)) needs.push({ kind, name, to });
    };
    const fetchedLevels: string[] = [];

    // What the game can reach: its home, its levels from the first up to the
    // one that ends the game, the cutscenes those play, and the videos the
    // title and those play. A level after the end, such as the rest of a
    // stock game flow a game was made from, is never played.
    const levelList: unknown[] = Array.isArray(flow.levels) ? flow.levels : [];
    const cutsceneList: unknown[] = Array.isArray(flow.cutscenes) ? flow.cutscenes : [];
    const reachable = new Set<unknown>();
    for (const entry of levelList) {
        if (!isObject(entry) || entry.type === 'dummy' || entry.type === 'current') continue;
        reachable.add(entry);
        if (entry.type !== 'gym' && Array.isArray(entry.sequence) && entry.sequence.some((event: unknown) => isObject(event) && GAME_ENDS.has(event.type))) break;
    }
    const played = [flow.title, ...reachable].filter(isObject);
    const playedEvents = (type: string, key: string): number[] => played
        .flatMap((entry) => (Array.isArray(entry.sequence) ? entry.sequence : []))
        .filter((event: unknown) => isObject(event) && event.type === type && typeof event[key] === 'number')
        .map((event: AnyObj) => event[key] as number);
    for (const id of playedEvents('play_cutscene', 'cutscene_id')) {
        if (isObject(cutsceneList[id])) reachable.add(cutsceneList[id]);
    }
    played.push(...cutsceneList.filter((entry): entry is AnyObj => isObject(entry) && reachable.has(entry)));

    // The game's own files where TRX looks: levels/, or cuts/ for TR3's
    // cutscenes, and injections/.
    const levelFiles = new Map<string, string>();
    const exactLevels = new Set<string>();
    const ownInjections = new Map<string, string>();
    for (const f of files) {
        if (!f.path.startsWith(prefix)) continue;
        const rel = f.path.slice(prefix.length);
        const level = /^(?:levels|cuts)\/([^/]+)$/.exec(rel);
        if (level) {
            exactLevels.add(level[1]);
            if (!levelFiles.has(level[1].toLowerCase())) levelFiles.set(level[1].toLowerCase(), level[1]);
        }
        const injection = /^injections\/(.+)$/.exec(rel);
        if (injection) ownInjections.set(injection[1], injection[1]);
    }
    const shipped = new Set(BASE_INJECTIONS[`tr${gameVersion}`] ?? []);

    /** The name TRX finds a level file by, or null for one the game does not bring. */
    const resolveLevel = (path: unknown): string | null => {
        if (typeof path !== 'string' || path === '') return null;
        if (exactLevels.has(path)) return path;
        return levelFiles.get(path.toLowerCase()) ?? levelFiles.get(baseName(path).toLowerCase()) ?? null;
    };

    /** The name TRX finds an injection by, or null for one neither the game nor TRX has. */
    const resolveInjection = (path: string): string | null => {
        if (ownInjections.has(path) || shipped.has(path)) return path;
        const name = baseName(path);
        for (const candidate of [name, currentInjectionName(name)]) {
            if (ownInjections.has(candidate) || shipped.has(candidate)) return candidate;
            const own = [...ownInjections.keys()].find((key) => key.toLowerCase() === candidate.toLowerCase());
            if (own !== undefined) return own;
        }
        return null;
    };

    let renamedLevels = 0;
    let stood = 0;
    let dropped = 0;
    let renamedInjections = 0;
    const lostInjections = new Set<string>();

    const settleInjections = (holder: AnyObj): void => {
        if (!Array.isArray(holder.injections)) return;
        const out: string[] = [];
        for (const path of holder.injections) {
            if (typeof path !== 'string') continue;
            const name = resolveInjection(path);
            if (name === null) {
                lostInjections.add(path);
                continue;
            }
            if (name !== path) renamedInjections++;
            if (!out.includes(name)) out.push(name);
        }
        holder.injections = out;
    };

    /** Settles one entry; null when it is to go. */
    const settle = (entry: AnyObj, table: 'title' | 'levels' | 'cutscenes' | 'demos'): AnyObj | null => {
        if (entry.type === 'dummy' || entry.type === 'current') return entry;
        const candidates: unknown[] = Array.isArray(entry.path) ? entry.path : [entry.path];
        const found = candidates.map(resolveLevel).find((name) => name !== null) ?? null;
        if (found !== null) {
            if (entry.path !== found) {
                entry.path = found;
                renamedLevels++;
            }
            settleInjections(entry);
            return entry;
        }
        // A level of the original game it plays comes from the server.
        const stock = candidates.filter((path): path is string => typeof path === 'string').map((path) => baseName(path).toLowerCase())
            .find((name) => base !== undefined && (name in base.levels || name in base.cuts));
        if (base !== undefined && stock !== undefined && table !== 'demos' && (table === 'title' || reachable.has(entry))) {
            const cut = !(stock in base.levels);
            need(cut ? 'cut' : 'level', stock, `${cut ? 'cuts' : 'levels'}/${stock}`);
            fetchedLevels.push(stock);
            entry.path = stock;
            // The original's level carries the original's Lara, as TRX's own
            // outfits for the game draw her, guns and all.
            if (entry.lara_outfit === 'level_default') entry.lara_outfit = entry.type === 'gym' ? `tr${gameVersion}_gym` : `tr${gameVersion}_classic`;
            settleInjections(entry);
            return entry;
        }
        if (table === 'title') {
            // The stock title where the player has the original game, else a
            // level of the game's own: a game plays without the original,
            // and the menu's picture covers the level behind it.
            if (ownLevel !== null && typeof entry.path === 'string') {
                entry.path = [entry.path, ownLevel];
                borrowedTitle = true;
            }
            settleInjections(entry);
            return entry;
        }
        if (table === 'demos') {
            dropped++;
            return null;
        }
        stood++;
        // TRX reads a cutscene's sequence even when it is a dummy.
        return { type: 'dummy', sequence: [] };
    };

    // Pictures, videos and the sound file: TRX's file system tells case
    // apart, so a name spelt otherwise than the file takes the file's
    // spelling. TRX tries a picture's or video's other extensions itself.
    let respelt = 0;
    const byLower = new Map<string, string>();
    for (const f of files) if (f.path.startsWith(prefix)) byLower.set(f.path.slice(prefix.length).toLowerCase(), f.path.slice(prefix.length));
    const respell = (holder: AnyObj, key: string, dir: string, extensions: string[]): void => {
        const name = holder[key];
        if (typeof name !== 'string' || name === '') return;
        const stem = name.replace(/\.[^./]+$/, '');
        // TRX's own pictures of the stock game, under the names TR1X gave them.
        const renamed = dir === 'images/' ? STOCK_PICTURES[stem.toLowerCase()] : undefined;
        if (renamed !== undefined && !files.some((f) => f.path.toLowerCase().startsWith(`${prefix}${dir}${stem.toLowerCase()}.`))) {
            holder[key] = renamed;
            respelt++;
            return;
        }
        const tries = [name, ...extensions.map((ext) => stem + ext)];
        for (const candidate of tries) {
            if (files.some((f) => f.path === `${prefix}${dir}${candidate}`)) return;
        }
        for (const candidate of tries) {
            const actual = byLower.get(`${dir}${candidate}`.toLowerCase());
            if (actual === undefined) continue;
            holder[key] = actual.slice(dir.length);
            respelt++;
            return;
        }
    };
    const IMAGE = ['.webp', '.png', '.jpg', '.jpeg', '.pcx', '.bmp'];
    const VIDEO = ['.mp4', '.mkv', '.mpeg', '.avi', '.webm', '.ogv', '.rpl', '.fmv', '.bik'];
    respell(flow, 'main_menu_picture', 'images/', IMAGE);
    respell(flow, 'sfx_path', '', []);
    for (const fmv of Array.isArray(flow.fmvs) ? flow.fmvs : []) if (isObject(fmv)) respell(fmv, 'path', 'fmv/', VIDEO);
    for (const entry of [flow.title, ...['levels', 'cutscenes', 'demos'].flatMap((table) => (Array.isArray(flow[table]) ? flow[table] : []))]) {
        if (!isObject(entry) || !Array.isArray(entry.sequence)) continue;
        if (typeof entry.sfx_path === 'string') respell(entry, 'sfx_path', '', []);
        for (const event of entry.sequence) {
            if (!isObject(event)) continue;
            if (event.type === 'loading_screen' || event.type === 'display_picture') respell(event, 'path', 'images/', IMAGE);
            if (event.type === 'total_stats') respell(event, 'background_path', 'images/', IMAGE);
        }
    }

    // The first level of the game's own, for a title the game does not bring.
    let borrowedTitle = false;
    const ownLevel = (Array.isArray(flow.levels) ? flow.levels : [])
        .filter((entry: unknown) => isObject(entry) && entry.type !== 'dummy' && entry.type !== 'current')
        .map((entry: AnyObj) => resolveLevel(Array.isArray(entry.path) ? entry.path[0] : entry.path))
        .find((name: string | null) => name !== null) ?? null;

    settleInjections(flow);
    if (isObject(flow.title)) settle(flow.title, 'title');
    for (const table of ['levels', 'cutscenes', 'demos'] as const) {
        const list = flow[table];
        if (!Array.isArray(list)) continue;
        flow[table] = list.map((entry) => (isObject(entry) ? settle(entry, table) : entry)).filter((entry) => entry !== null);
        if (table === 'demos' && flow[table].length === 0) delete flow[table];
    }

    if (base !== undefined) {
        const own = (pattern: RegExp): boolean => files.some((f) => f.path.startsWith(prefix) && pattern.test(f.path.slice(prefix.length).toLowerCase()));
        // The sound file of TR2 and TR3, which their levels play every sound from.
        if (base.sfx) {
            const sfx = typeof flow.sfx_path === 'string' ? flow.sfx_path.toLowerCase() : 'main.sfx';
            if (!own(new RegExp(`^${sfx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))) {
                flow.sfx_path = 'main.sfx';
                need('sfx', 'main.sfx', 'main.sfx');
            }
        }

        // The videos it plays: the title's and those of the levels and
        // cutscenes it reaches, and the ones played as the game starts.
        const fmvs: unknown[] = Array.isArray(flow.fmvs) ? flow.fmvs : [];
        const fmvIds = new Set(playedEvents('play_fmv', 'fmv_id'));
        fmvs.forEach((fmv, id) => {
            if (isObject(fmv) && (fmv.legal === true || fmv.intro === true)) fmvIds.add(id);
        });
        for (const id of fmvIds) {
            const fmv = fmvs[id];
            if (!isObject(fmv) || typeof fmv.path !== 'string') continue;
            const stem = baseName(fmv.path).toLowerCase().replace(/\.[^.]+$/, '');
            if (own(new RegExp(`^fmv/${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[a-z0-9]+$`))) continue;
            const stock = base.fmvs.find((name) => name.replace(/\.[^.]+$/, '') === stem);
            if (stock === undefined) continue;
            fmv.path = stock;
            need('fmv', stock, `fmv/${stock}`);
        }

        // Its music. Once a game has music of its own TRX plays only from
        // it, so every track the game may play has to be there: the ones
        // its game flow names, its levels' triggers play (the original's
        // levels it takes too), the engine plays by itself (the music
        // catalog) and its scripts play.
        const tracks = new Set<number>();
        const add = (track: unknown): void => {
            if (typeof track === 'number' && Number.isInteger(track) && track >= 0) tracks.add(track);
        };
        for (const entry of [flow.title, ...levelList, ...cutsceneList]) {
            if (!isObject(entry) || entry.type === 'dummy') continue;
            add(entry.music_track);
            for (const event of Array.isArray(entry.sequence) ? entry.sequence : []) {
                if (isObject(event) && event.type === 'play_music') add(event.music_track);
            }
        }
        for (const f of files) {
            const rel = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : '';
            if (/^(levels|cuts)\/[^/]+$/.test(rel)) cdTracks(f.data).forEach(add);
            if (/\.lua$/i.test(rel) && !rel.startsWith('modules/')) {
                for (const m of new TextDecoder().decode(f.data).matchAll(/music[\w.:]*\s*\(\s*(\d+)/gi)) add(Number(m[1]));
            }
        }
        for (const name of fetchedLevels) (base.levels[name] ?? base.cuts[name] ?? []).forEach(add);
        for (const line of (BASE_FILES[`tr${gameVersion}/catalog_music.csv`] ?? '').split('\n')) {
            const m = /^\s*(\d+)\s*,/.exec(line);
            if (m) add(Number(m[1]));
        }
        // A game with Tomb Raider III's cdaudio.wad of its own has all its tracks.
        if (!own(/^(music|audio)\/cdaudio\.wad$/)) {
            const brought = new Set<number>();
            for (const f of files) {
                const m = /^(?:music|audio)\/(?:track)?0*(\d+)(?:_[^/]*)?\.[a-z0-9]+$/i.exec(f.path.startsWith(prefix) ? f.path.slice(prefix.length) : '');
                if (m) brought.add(Number(m[1]));
            }
            for (const track of [...tracks].sort((a, b) => a - b)) {
                if (!brought.has(track) && base.music.includes(track)) need('music', String(track), `music/${track}`);
            }
        }
    }

    const before = new TextDecoder().decode(file.data);
    const after = JSON.stringify(flow, null, 4);
    if (renamedLevels + stood + dropped + renamedInjections + lostInjections.size + respelt + needs.length === 0 && !borrowedTitle) return [];
    if (after !== before) file.data = new TextEncoder().encode(after);

    const notes: string[] = [];
    if (renamedLevels > 0) notes.push(`Named ${plural(renamedLevels, 'level')} by the file${renamedLevels === 1 ? '' : 's'} the game brings.`);
    if (stood + dropped > 0) {
        const parts = [
            stood > 0 ? `made ${plural(stood, 'level or cutscene', 'levels or cutscenes')} into stand-ins TRX passes over` : '',
            dropped > 0 ? `left out ${plural(dropped, 'demo')}` : '',
        ].filter(Boolean);
        notes.push(base !== undefined
            ? `Its game flow names levels it never plays and does not bring, left from the stock game flow it was made from: ${parts.join(' and ')}.`
            : `Its game flow names level files it does not bring, which the original engine took from the stock game and TRX cannot: ${parts.join(' and ')}.`);
    }
    if (needs.length > 0) {
        const count = (kind: BaseNeed['kind']) => needs.filter((n) => n.kind === kind).length;
        const parts = [
            count('level') + count('cut') > 0 ? plural(count('level') + count('cut'), 'level or cutscene', 'levels or cutscenes') : '',
            count('sfx') > 0 ? 'its sound file' : '',
            count('fmv') > 0 ? plural(count('fmv'), 'video') : '',
            count('music') > 0 ? plural(count('music'), 'music track') : '',
        ].filter(Boolean);
        notes.push(`Takes from the original game what it uses and does not bring, which comes from the server: ${parts.join(', ')}.`);
    }
    if (borrowedTitle) notes.push("Its title level is the original game's where the player has it, and one of its own levels where not.");
    if (respelt > 0) notes.push(`Spelt ${plural(respelt, 'file name')} as the files are, as TRX tells case apart.`);
    if (renamedInjections > 0) notes.push(`Named ${plural(renamedInjections, 'injection')} the way TRX looks them up now.`);
    if (lostInjections.size > 0) notes.push(`Left out ${plural(lostInjections.size, 'injection')} neither the game nor TRX has: ${[...lostInjections].map(baseName).join(', ')}.`);
    return notes;
}

/**
 * Objects of a TR1 or TR2 level in slots TRX's catalog for the game, with
 * the game's own on top, does not have: TRX refuses the level for any of
 * them ("invalid object id"). An older TRX had such slots, which it has
 * since dropped (TRX 1.0's extra skins of Lara, 195 to 200 in TR1). One no
 * item of the level is goes; one an item is stays, as the level could not
 * play without it either way.
 */
export function settleObjects(files: MappedFile[], modDir: string, gameVersion: number): string[] {
    if (gameVersion > 2) return [];
    const prefix = `games/${modDir}/`;
    const catalog = new Set<number>();
    const own = files.find((f) => f.path === prefix + 'catalog_objects.csv');
    for (const text of [BASE_FILES[`tr${gameVersion}/catalog_objects.csv`] ?? '', own ? new TextDecoder().decode(own.data) : '']) {
        for (const line of text.split('\n')) {
            const match = /^\s*(\d+)\s*,/.exec(line);
            if (match) catalog.add(Number(match[1]));
        }
    }
    let removed = 0;
    for (const file of files) {
        if (!file.path.startsWith(prefix + 'levels/') && !file.path.startsWith(prefix + 'cuts/')) continue;
        const objects = readLevelObjects(file.data);
        const level = readLevel(file.data);
        if (objects === null || level === null) continue;
        const used = new Set(level.items.map((item) => item.objectId));
        const strays = new Set(objects.objects.map((object) => object.id).filter((id) => !catalog.has(id) && !used.has(id)));
        if (strays.size === 0) continue;
        const out = removeObjects(file.data, strays);
        if (out === null) continue;
        file.data = out;
        removed += strays.size;
    }
    return removed > 0 ? [`Left out ${plural(removed, 'object')} of slots TRX no longer has, which nothing in the levels used.`] : [];
}

/** A game TRX cannot play: a level of it names objects TRX does not know. */
export class UnplayableLevelError extends Error {}

/**
 * Throws when a level the game plays has items of object slots TRX's
 * catalog for the game, with the game's own on top, does not have: TRX
 * refuses to load such a level ("item N names no object"). Tomb Raider III
 * levels made for the original engine meet this where they use objects TRX
 * does not have yet, which the converter cannot add.
 */
export function checkPlayable(files: MappedFile[], modDir: string, gameVersion: number): void {
    const prefix = `games/${modDir}/`;
    const flowFile = files.find((f) => f.path === prefix + 'gameflow.json5');
    if (!flowFile) return;
    let flow: AnyObj;
    try {
        flow = parseJSON5(new TextDecoder().decode(flowFile.data)) as AnyObj;
    } catch {
        return;
    }
    const catalog = new Set<number>();
    const own = files.find((f) => f.path === prefix + 'catalog_objects.csv');
    for (const text of [BASE_FILES[`tr${gameVersion}/catalog_objects.csv`] ?? '', own ? new TextDecoder().decode(own.data) : '']) {
        for (const line of text.split('\n')) {
            const match = /^\s*(\d+)\s*,/.exec(line);
            if (match) catalog.add(Number(match[1]));
        }
    }
    const played = [...(Array.isArray(flow.levels) ? flow.levels : []), ...(Array.isArray(flow.cutscenes) ? flow.cutscenes : [])]
        .filter((entry: unknown) => isObject(entry) && entry.type !== 'dummy' && entry.type !== 'current' && typeof entry.path === 'string')
        .map((entry: AnyObj) => entry.path as string);
    const refused: string[] = [];
    const slots = new Set<number>();
    for (const path of [...new Set(played)]) {
        const file = files.find((f) => f.path === prefix + 'levels/' + path) ?? files.find((f) => f.path === prefix + 'cuts/' + path);
        const level = file ? readLevel(file.data) : null;
        if (!level) continue;
        const unknown = level.items.map((item) => item.objectId).filter((id) => !catalog.has(id));
        if (unknown.length === 0) continue;
        refused.push(path);
        unknown.forEach((id) => slots.add(id));
    }
    if (refused.length === 0) return;
    const game = `Tomb Raider${gameVersion === 1 ? '' : gameVersion === 2 ? ' II' : ' III'}`;
    const names = refused.length === 1 ? refused[0] : `${refused.slice(0, -1).join(', ')} and ${refused[refused.length - 1]}`;
    throw new UnplayableLevelError(
        `TRX cannot play this level yet: ${names} ${refused.length === 1 ? 'uses' : 'use'} ${game} objects it does not support `
        + `(object slot${slots.size === 1 ? '' : 's'} ${[...slots].sort((a, b) => a - b).join(', ')}).`,
    );
}
