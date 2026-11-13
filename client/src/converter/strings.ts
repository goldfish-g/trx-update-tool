// The engine's own game strings a builder edited.
//
// TRX keeps the texts every game shares in cfg/base_strings*.json5
// (TRX_common_strings*.json5 up to 1.3): menus, the passport, settings and
// their presets, outfits, the names of common items. Builders edit their copy
// to name a key or a puzzle item of their level, retitle the inventory, or
// name presets of their own. Those files belong to the engine, which a
// converted game does not bring, so the edits move into the game's own
// strings files, which the engine reads after the shared ones. An edit is a
// text no TRX build ever gave that string (strings.generated.ts, written by
// scripts/extract-strings.mjs); a string the game's own strings give already
// stays as they give it, as it did on the builder's engine.

import { GAME_STRING_IDS } from './history.generated.ts';
import { parseJSON5 } from './json5.ts';
import { currentObjectKey } from './objects.ts';
import type { MappedFile } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

/** The sections of a strings file the engine reads game strings from (game_strings/table/reader.c). */
const SECTIONS = new Set(['general', 'console', 'settings', 'enums', 'dynamic', 'objects']);

const isObject = (value: unknown): value is AnyObj => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Every game string a strings file gives, by its path now (objects/key_1/name):
 * the flat ids of TRX 1.3 and before by the path the current strings give
 * their text. Levels and other lists are not game strings.
 */
export function flattenStrings(doc: unknown): Map<string, string> {
    const out = new Map<string, string>();
    if (!isObject(doc)) return out;
    const walk = (node: AnyObj, path: string) => {
        for (const [key, value] of Object.entries(node)) {
            const here = `${path}/${key}`;
            if (typeof value === 'string') out.set(here, value);
            else if (isObject(value)) walk(value, here);
        }
    };
    for (const [section, value] of Object.entries(doc)) {
        if (!isObject(value)) continue;
        if (section === 'game_strings') {
            for (const [id, text] of Object.entries(value)) {
                const path = GAME_STRING_IDS[id];
                if (typeof text === 'string' && path !== undefined) out.set(path, text);
            }
        } else if (SECTIONS.has(section)) {
            walk(value, section);
        }
    }
    return out;
}

/** A short hash of a text (FNV-1a over its UTF-16 code units), as strings.generated.ts keeps them. */
export function textHash(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function setPath(doc: AnyObj, path: string, text: string): void {
    const keys = path.split('/');
    let node = doc;
    for (const key of keys.slice(0, -1)) {
        if (!isObject(node[key])) node[key] = {};
        node = node[key];
    }
    node[keys[keys.length - 1]!] = text;
}

/** The archive's copies of the engine's strings, kept at _meta/engine_strings/ (gamedata.ts). */
const ENGINE_STRINGS = /\/_meta\/engine_strings\/(?:base_strings|trx_common_strings)(?:-([a-z0-9-]+))?\.json5$/;

/**
 * Writes the texts a builder gave the engine's own game strings into the
 * game's strings files, of the same language, and the strings named in
 * `wanted` (the names of the game's own presets) where the builder added them.
 */
export async function carryEngineStrings(
    files: MappedFile[], modDir: string, release: number | null, gameVersion: number, wanted: ReadonlySet<string> = new Set(),
): Promise<string[]> {
    const prefix = `games/${modDir}/`;
    const sources = files.filter((f) => f.path.startsWith(prefix) && ENGINE_STRINGS.test(f.path));
    if (sources.length === 0) return [];
    // A large table, wanted only by games that bring these files.
    const { STOCK_STRINGS } = await import('./strings.generated.ts');
    const decoder = new TextDecoder();
    const examples: string[] = [];
    let carried = 0;
    for (const source of sources) {
        const lang = ENGINE_STRINGS.exec(source.path)![1];
        let doc: unknown;
        try {
            doc = parseJSON5(decoder.decode(source.data));
        } catch {
            continue;
        }
        const edits = new Map<string, string>();
        for (const [path, text] of flattenStrings(doc)) {
            let now = path;
            const object = /^objects\/([^/]+)\/(.+)$/.exec(path);
            if (object && release !== null) {
                const key = currentObjectKey(object[1]!, release, gameVersion);
                if (key === null) continue;
                now = `objects/${key}/${object[2]}`;
            }
            const stock = STOCK_STRINGS[now];
            // A string the current TRX does not have says nothing any more,
            // unless something the game keeps names it.
            if (stock === undefined ? !wanted.has(now) : stock.includes(textHash(text))) continue;
            edits.set(now, text);
        }
        if (edits.size === 0) continue;

        const target = prefix + (lang === undefined ? 'strings.json5' : `strings-${lang}.json5`);
        const file = files.find((f) => f.path === target);
        let game: AnyObj = {};
        if (file) {
            try {
                const parsed = parseJSON5(decoder.decode(file.data));
                if (isObject(parsed)) game = parsed;
            } catch {
                continue;
            }
        }
        const own = flattenStrings(game);
        let added = 0;
        for (const [path, text] of edits) {
            if (own.has(path)) continue;
            setPath(game, path, text);
            added++;
            if (examples.length < 3) examples.push(`"${text.trim()}"`);
        }
        if (added === 0) continue;
        carried += added;
        const data = new TextEncoder().encode(JSON.stringify(game, null, 4));
        if (file) file.data = data;
        else files.push({ path: target, data });
    }
    if (carried === 0) return [];
    return [`Kept ${carried} of the engine's own texts the builder changed (such as ${examples.join(', ')}) in the game's strings.`];
}
