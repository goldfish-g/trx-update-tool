// Brings a level made for an older TRX up to date, as far as TRX's migration
// guide (docs/trx/MIGRATING.md) renames things one for one. What the guide
// changed in meaning is left as it is and reported, for a person to port.

import { LUA_API, OBJECT_KEYS, OBJECT_SYMBOLS } from './renames.generated.ts';
import type { MappedFile } from './types.ts';

export type MigrationResult = {
    files: MappedFile[];
    // What changed, and what a person still has to port by hand.
    notes: string[];
};

type Rename = [RegExp, string | ((...match: string[]) => string)];

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A name, not part of a longer one.
function nameRename(was: string, now: string): Rename {
    return [new RegExp('(?<![\\w.:])' + escape(was) + '(?![\\w])', 'g'), now];
}

// Renames the guide gives outside its tables, newest last.
const LUA_RENAMES: Rename[] = [
    // TRX 1.2: the control hooks.
    nameRename('trx.events.on_control_post', 'trx.events.after_control'),
    nameRename('trx.events.on_control', 'trx.events.before_control'),
    // TRX 1.10: the guide's table spells these with an example name.
    [/trx\.lara\.mesh\.(\w+)/g, (_m, mesh) => 'trx.lara.Mesh.' + mesh.toUpperCase()],
    [/trx\.lara\.extra_mesh\.(\w+)/g, (_m, mesh) => 'trx.lara.ExtraMesh.' + mesh.toUpperCase()],
    [/trx\.pickup\.Mode\.(\w+)/g, 'trx.items.PickupMode.$1'],
    nameRename('trx.music.play_track', 'trx.music.play'),
    // TRX 1.12.
    nameRename('trx.inventory:give', 'trx.inventory.give'),
    nameRename('trx.inventory:icon_of', 'trx.inventory.icon_of'),
    nameRename('trx.stats:give_secret', 'trx.stats.give_secret'),
    nameRename('trx.events.on_ui_draw', 'trx.ui.on_reserve'),
    nameRename('trx.events.on_ui_paint', 'trx.ui.on_paint'),
    [/:is_shown\(/g, ':is_visible('],
    [/require\(\s*(["'])common\.(overlay|assault|legend)\1\s*\)/g, 'require($1common.ui.hud.$2$1)'],
];

for (const was in LUA_API) {
    const now = LUA_API[was];
    // The table's rows with an example name are covered above.
    if (/\.(X|hand_r|oar)$/.test(was)) continue;
    LUA_RENAMES.push(nameRename(was, now));
}

// The catalog names objects by key, and once by their C symbol.
const CATALOG_NAME = /(trx\.catalog\.objects\.)(\w+)/g;
const SYMBOL_KEYS: Record<string, string> = {};
for (const was in OBJECT_SYMBOLS) {
    SYMBOL_KEYS[was.replace(/^O_/, '').toLowerCase()] =
        OBJECT_SYMBOLS[was].replace(/^O_/, '').toLowerCase();
}

function currentKey(key: string): string {
    const lower = key.toLowerCase();
    const now = OBJECT_KEYS[lower] ?? SYMBOL_KEYS[lower];
    if (now === undefined) return key;
    return key === key.toUpperCase() ? now.toUpperCase() : now;
}

// What the guide changed in meaning, by the version that changed it.
const BY_HAND: [RegExp, string][] = [
    [/\b(before_level_file|after_level_file|before_item_setup|after_item_setup|after_level_state|on_level_init|on_level_start|on_level_load)\b/,
        'TRX 1.10 replaced the level events with trx.events.on_game_start.'],
    [/trx\.items\.(find|first)\(|\.flags\b|\.status\b/,
        'TRX 1.10 replaced item flags, status and trx.items.find with fields and queries.'],
    [/trx\.game\.settings\./, 'TRX 1.10 moved trx.game.settings to trx.config.override.'],
    [/trx\.events\.EventType|\._type\b/, 'TRX 1.10 removed trx.events.EventType.'],
    [/trx\.(music|sound)\.is_available\(/, 'TRX 1.10 replaced is_available with the tracks and samples tables.'],
    [/trx\.cutscenes\.(play|is_played|set_played)\(|trx\.cutscenes\.current\s*==|on_cutscene_start/,
        'TRX 1.11 made cutscenes objects.'],
    [/:die\(\s*(true|false|\d)/, 'TRX 1.12 made item:die take a table.'],
    [/:shatter\(\s*\d/, 'TRX 1.12 made item:shatter take a table.'],
    [/declare_ring_item/, 'TRX 1.12 moved the inventory ring to require("common.ui.ring").declare_item.'],
    [/\bshown\s*=|\bhidden\s*=/, 'TRX 1.12 renamed widget visibility: shown became visible, and a hidden Label became a Blank.'],
    [/:wakes_on\(|trx\.ui\.regions\.fallback|trx\.ui\.widgets\.Row\b|\bh_bars\b/,
        'TRX 1.12 removed parts of the UI API: wakes_on, regions.fallback, widgets.Row and h_bars.'],
    [/health_bar_forced/, 'TRX 1.12 replaced health_bar_forced with the health_bar signal of common.ui.ring.'],
    [/:above\(/, 'TRX 1.12 replaced Signal:above with Signal:map.'],
];

function migrateLua(text: string): string {
    let out = text;
    for (let i = 0; i < LUA_RENAMES.length; i++) {
        const [pattern, replacement] = LUA_RENAMES[i];
        out = out.replace(pattern, replacement as string);
    }
    return out.replace(CATALOG_NAME, (_m, prefix: string, key: string) => prefix + currentKey(key));
}

// Game flows and strings name objects by key.
function migrateJson5(text: string): string {
    return text
        .replace(/("object_id"\s*:\s*")(\w+)(")/g, (_m, a: string, key: string, b: string) => a + currentKey(key) + b)
        .replace(/("objects\/)(\w+)(\/)/g, (_m, a: string, key: string, b: string) => a + currentKey(key) + b);
}

// Catalogs list objects by their C symbol.
function migrateCatalog(text: string): string {
    return text.replace(/\bO_\w+\b/g, (symbol) => OBJECT_SYMBOLS[symbol] ?? symbol);
}

export function migrateToCurrentTRX(files: MappedFile[]): MigrationResult {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const notes: string[] = [];
    let changed = 0;
    const out = files.map(function(file) {
        const path = file.path.toLowerCase();
        let migrate: ((text: string) => string) | null = null;
        if (path.endsWith('.lua')) migrate = migrateLua;
        else if (path.endsWith('.json5')) migrate = migrateJson5;
        else if (/catalog_objects\.csv$/.test(path)) migrate = migrateCatalog;
        if (migrate === null) return file;

        const text = decoder.decode(file.data);
        const migrated = migrate(text);
        if (path.endsWith('.lua')) {
            const name = file.path.split('/').slice(2).join('/');
            for (let i = 0; i < BY_HAND.length; i++) {
                if (BY_HAND[i][0].test(migrated)) notes.push(`${name}: ${BY_HAND[i][1]}`);
            }
        }
        if (migrated === text) return file;
        changed++;
        return { path: file.path, data: encoder.encode(migrated) };
    });
    if (changed > 0) {
        notes.unshift(`Brought ${changed} file${changed === 1 ? '' : 's'} up to date with names TRX has changed.`);
    }
    return { files: out, notes: notes };
}
