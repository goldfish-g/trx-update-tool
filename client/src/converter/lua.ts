// Brings the Lua scripts of a game made for an older TRX up to date.
//
// The scripts themselves are left as their author wrote them. Each one starts
// with a line that hands it the API of the TRX it was written for, as
// lua/trx_compat.lua translates it onto the current one; what TRX changed in
// the files around the scripts, such as where a game keeps them, is done
// here.

import compatTemplate from './lua/trx_compat.lua?raw';
import { parseJSON5 } from './json5.ts';
import { LEGACY_MARKER } from './legacy.ts';
import { luaObjectRenames } from './objects.ts';
import type { MappedFile } from './types.ts';

/** The TRX 1.x release the converter writes for. */
export const CURRENT_RELEASE = 12;


// ---------------------------------------------------------------------------
// Reading Lua
// ---------------------------------------------------------------------------

export type TokenKind = 'name' | 'number' | 'string' | 'long_string' | 'comment' | 'op' | 'space';

export type Token = {
    kind: TokenKind;
    start: number;
    end: number;
};

const OPERATORS = ['...', '..', '==', '~=', '<=', '>=', '//', '::', '<<', '>>'];

// The length of a long bracket's opening, `[[` or `[==[`, at `at`, or 0.
function longBracket(src: string, at: number): number {
    if (src[at] !== '[') return 0;
    let i = at + 1;
    while (src[i] === '=') i++;
    return src[i] === '[' ? i - at + 1 : 0;
}

function longEnd(src: string, from: number, level: number): number {
    const close = ']' + '='.repeat(level) + ']';
    const end = src.indexOf(close, from);
    return end < 0 ? src.length : end + close.length;
}

/** Splits Lua source into tokens that cover every character of it. */
export function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const push = (kind: TokenKind, end: number) => {
        tokens.push({ kind, start: i, end });
        i = end;
    };
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) {
            let j = i + 1;
            while (j < src.length && /\s/.test(src[j])) j++;
            push('space', j);
        } else if (c === '-' && src[i + 1] === '-') {
            const open = longBracket(src, i + 2);
            if (open > 0) {
                push('comment', longEnd(src, i + 2 + open, open - 2));
            } else {
                const nl = src.indexOf('\n', i);
                push('comment', nl < 0 ? src.length : nl);
            }
        } else if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== c && src[j] !== '\n') {
                if (src[j] === '\\') {
                    j++;
                    // \z skips the whitespace after it, line breaks included.
                    if (src[j] === 'z') {
                        j++;
                        while (j < src.length && /\s/.test(src[j])) j++;
                        continue;
                    }
                }
                j++;
            }
            push('string', Math.min(j + 1, src.length));
        } else if (c === '[' && longBracket(src, i) > 0) {
            const open = longBracket(src, i);
            push('long_string', longEnd(src, i + open, open - 2));
        } else if (/[A-Za-z_]/.test(c)) {
            let j = i + 1;
            while (j < src.length && /\w/.test(src[j])) j++;
            push('name', j);
        } else if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
            const m = /^(0[xX][\da-fA-F]*(\.[\da-fA-F]*)?([pP][+-]?\d+)?|\d*\.?\d*([eE][+-]?\d+)?)/.exec(src.slice(i));
            push('number', i + Math.max(1, m ? m[0].length : 1));
        } else {
            const op = OPERATORS.find((o) => src.startsWith(o, i));
            push('op', i + (op ? op.length : 1));
        }
    }
    return tokens;
}

/** The source with its strings and comments blanked, so a pattern sees code. */
export function codeOnly(src: string, tokens: Token[] = tokenize(src)): string {
    let out = '';
    for (const t of tokens) {
        const text = src.slice(t.start, t.end);
        if (t.kind === 'comment') {
            out += text.replace(/[^\n]/g, ' ');
        } else if (t.kind === 'string' || t.kind === 'long_string') {
            // Kept as a string, so a call still reads as one.
            out += text[0] + text.slice(1, -1).replace(/[^\n]/g, ' ') + text[text.length - 1];
        } else {
            out += text;
        }
    }
    return out;
}

/** The text of every string literal, as the script spells it. */
function stringContents(src: string, tokens: Token[]): string[] {
    return tokens
        .filter((t) => t.kind === 'string' || t.kind === 'long_string')
        .map((t) => src.slice(t.start, t.end));
}

/** Whether the script reaches a global of this name, as `name.` or `name(`. */
function usesGlobal(code: string, name: string): boolean {
    return new RegExp('(?<![\\w.:])' + name + '\\s*[.(]').test(code);
}

// ---------------------------------------------------------------------------
// Which TRX a game was made for
// ---------------------------------------------------------------------------

export type ReleaseGuess = {
    /** The TRX 1.x release, or null for a game made for no TRX. */
    release: number | null;
    /** What told: the engine the game shipped with, or its scripts. */
    from: string;
};

function findBytes(data: Uint8Array, needle: Uint8Array, from = 0): number {
    const first = needle[0];
    outer: for (let i = data.indexOf(first, from); i >= 0 && i <= data.length - needle.length; i = data.indexOf(first, i + 1)) {
        for (let j = 1; j < needle.length; j++) {
            if (data[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

function utf16(text: string): Uint8Array {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) out[i * 2] = text.charCodeAt(i);
    return out;
}

/**
 * The version a Windows executable states in its version resource, such as
 * "TRX 1.11.1" or "TR1X 4.15.1", or null.
 */
export function executableVersion(data: Uint8Array): string | null {
    for (const field of ['ProductVersion', 'FileVersion']) {
        const at = findBytes(data, utf16(field + '\0'));
        if (at < 0) continue;
        // The value follows, aligned to four bytes.
        let i = at + (field.length + 1) * 2;
        while (i < data.length - 1 && data[i] === 0 && data[i + 1] === 0) i += 2;
        let value = '';
        while (i < data.length - 1 && (data[i] !== 0 || data[i + 1] !== 0) && value.length < 64) {
            value += String.fromCharCode(data[i] | (data[i + 1] << 8));
            i += 2;
        }
        if (/\d+\.\d+/.test(value)) return value.trim();
    }
    return null;
}

// Script features by the last release that had them.
const CODE_SIGNATURES: [RegExp, number][] = [
    [/\btrx\.events\.(on_level_init|on_level_start|on_level_load|on_control|on_control_post)\b/, 1],
    [/\btrx\.catalog\.objects\.O_[A-Z]/, 1],
    [/\btrx\.lara\.exposure_timer\b/, 1],
    [/(?<!properties)\.max_hit_points\s*=(?!=)/, 6],
    [/\btrx\.assault_stats\b/, 7],
    [/\btrx\.(items|rooms)\.fn\b/, 9],
    [/\btrx\.items\.(find|first)\s*\(/, 9],
    [/\btrx\.pickup\b/, 9],
    [/\btrx\.events\.(before_level_file|after_level_file|before_item_setup|after_item_setup|after_level_state|EventType)\b/, 9],
    [/\btrx\.game\.settings\b/, 9],
    [/\btrx\.music\.(play_track|get_track|get_looped_track|available_tracks|is_available)\b/, 9],
    [/\btrx\.sound\.is_available\b/, 9],
    [/\btrx\.lara\.(mesh|extra_mesh)\./, 9],
    [/\btrx\.console\.log\.LogLevel\b/, 9],
    [/\btrx\.events\.on_game_start\s*\(\s*function\s*\(\s*\w+\s*,/, 9],
    [/\btrx\.game\.trx_version\b/, 10],
    [/\btrx\.cutscenes\.(play|is_played|set_played)\s*\(/, 10],
    [/\btrx\.cutscenes\.current\s*[=~]=\s*\d/, 10],
    [/\btrx\.(inventory|stats)\s*:/, 11],
    [/\bdeclare_ring_item\b/, 11],
    [/\btrx\.events\.on_ui_(draw|paint)\b/, 11],
    [/\bhealth_bar_forced\b/, 11],
    [/:\s*(wakes_on|above|is_shown)\s*\(/, 11],
    [/\bh_bars\b/, 11],
    [/\bwidgets\.Row\b/, 11],
    [/\bregions\.fallback\b/, 11],
    [/:\s*die\s*\(\s*(true|false|\d)/, 11],
    [/:\s*shatter\s*\(\s*\d/, 11],
];

const STRING_SIGNATURES: [RegExp, number][] = [
    [/^["'[=]*common\.(overlay|assault|legend)\b/, 11],
    [/\\\{(color \d+|dim)\}/, 11],
];

const GAMEFLOW_SIGNATURES: [RegExp, number][] = [
    [/"(savegame_fmt_bson|savegame_fmt_legacy)"\s*:/, 1],
    [/"enable_game_modes"\s*:/, 8],
    [/"(main_script|script)"\s*:/, 9],
    [/"setup_bacon_lara"/, 9],
];

/**
 * Which TRX a game was made for: the version its executable states, or else
 * the oldest release whose API its scripts and game flow still use.
 */
export function detectRelease(upload: MappedFile[], mapped: MappedFile[]): ReleaseGuess {
    // A game made for the engines before TRX now has the shape of a TRX 1.0
    // game (legacy.ts).
    const legacy = mapped.find((f) => f.path.endsWith('/' + LEGACY_MARKER));
    if (legacy) {
        const exe = upload.find((f) => f.path.toLowerCase().endsWith('.exe'));
        const version = exe ? executableVersion(exe.data) : null;
        return { release: 0, from: version ?? 'its game flow' };
    }
    for (const entry of upload) {
        if (!entry.path.toLowerCase().endsWith('.exe')) continue;
        const version = executableVersion(entry.data);
        if (version === null) continue;
        const trx = /^TRX\s+v?(\d+)\.(\d+)/i.exec(version);
        if (trx) {
            const major = +trx[1];
            const minor = +trx[2];
            return { release: major === 1 ? Math.min(minor, CURRENT_RELEASE) : CURRENT_RELEASE, from: version };
        }
        if (/^(TR\dX|Tomb\dMain)\b/i.test(version)) return { release: null, from: version };
    }

    const decoder = new TextDecoder();
    let release = CURRENT_RELEASE;
    let reason = '';
    const note = (at: number, why: string) => {
        if (at < release) {
            release = at;
            reason = why;
        }
    };
    for (const file of mapped) {
        const lower = file.path.toLowerCase();
        if (lower.endsWith('.lua')) {
            const src = decoder.decode(file.data);
            const tokens = tokenize(src);
            const code = codeOnly(src, tokens);
            for (const [pattern, at] of CODE_SIGNATURES) {
                if (pattern.test(code)) note(at, file.path);
            }
            for (const text of stringContents(src, tokens)) {
                for (const [pattern, at] of STRING_SIGNATURES) {
                    if (pattern.test(text)) note(at, file.path);
                }
            }
        } else if (/(^|\/)gameflow[^/]*\.json5$/.test(lower)) {
            const text = decoder.decode(file.data);
            for (const [pattern, at] of GAMEFLOW_SIGNATURES) {
                if (pattern.test(text)) note(at, file.path);
            }
        }
    }
    return { release, from: reason ? `what ${reason} uses` : 'nothing older found' };
}

// ---------------------------------------------------------------------------
// Text colors
// ---------------------------------------------------------------------------

// The numbered colors of the text markup before TRX 1.12, as the top and the
// bottom of a glyph. Only TR3 graded them.
const TEXT_COLORS: [string, string][] = [
    ['ffffff', '808080'], ['b0b000', '505000'], ['a0a0a0', '181818'],
    ['ff6060', '180000'], ['8080ff', '000018'], ['c08040', '401000'],
    ['b6d164', 'b62013'], ['c0ffc0', 'c0ffc0'], ['ffffff', 'ffffff'],
    ['ff00ff', '3f003f'], ['ff00ff', '3f003f'], ['ff00ff', '3f003f'],
];

/**
 * Text markup with its numbered colors spelled as the shades they were.
 * `escaped` is for text written inside a quoted Lua or JSON string, where
 * the markup's backslash is itself escaped.
 */
export function currentMarkup(text: string, gameVersion: number, escaped: boolean): string {
    // One backslash, or two where the string escapes it.
    const slash = escaped ? '\\\\' : '\\';
    const color = (n: string) => {
        const [top, bottom] = TEXT_COLORS[+n] ?? TEXT_COLORS[0];
        return gameVersion === 3 ? `#${top} #${bottom}` : `#${top}`;
    };
    const numbered = escaped ? /\\\\\{color (\d+)\}/g : /\\\{color (\d+)\}/g;
    const dim = escaped ? /\\\\\{dim\}/g : /\\\{dim\}/g;
    const undim = escaped ? /\\\\\{\/dim\}/g : /\\\{\/dim\}/g;
    return text
        .replace(numbered, (_m, n: string) => `${slash}{color ${color(n)}}`)
        .replace(dim, () => `${slash}{color #808080}`)
        .replace(undim, () => `${slash}{/color}`);
}

function currentMarkupInLua(src: string, gameVersion: number): string {
    const tokens = tokenize(src);
    let out = '';
    for (const t of tokens) {
        const text = src.slice(t.start, t.end);
        if (t.kind === 'string') out += currentMarkup(text, gameVersion, true);
        else if (t.kind === 'long_string') out += currentMarkup(text, gameVersion, false);
        else out += text;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Moving a game's scripts to where TRX looks for them
// ---------------------------------------------------------------------------

export type ScriptMigration = {
    files: MappedFile[];
    notes: string[];
};

function luaString(text: string): string {
    return JSON.stringify(text);
}

function compatModule(moduleRenames: Record<string, string>, gameVersion: number): string {
    const table = (entries: Record<string, string>) =>
        Object.keys(entries).sort().map((k) => `[${luaString(k)}] = ${luaString(entries[k])},`).join(' ');
    return compatTemplate
        .replace('--[[OBJECT_RENAMES]]', luaObjectRenames(gameVersion))
        .replace('--[[MODULE_RENAMES]]', table(moduleRenames));
}

// The game may be installed under a name of its own, so the module is found
// through the game that is running.
const COMPAT = 'require(trx.mod.current.name .. ".trx_compat")';

function header(release: number, code: string): string {
    const names = ['trx', 'require'];
    const call = `${COMPAT}(${release})`;
    if (release < 10 && usesGlobal(code, 'os')) {
        // os went with the sandbox in TRX 1.10; the clock it gave is the game's.
        return `local ${names.join(', ')} = ${call}; local os = { time = function() return math.floor(trx.game.real_time) end, clock = function() return trx.game.real_time end, date = function() return "" end }; `;
    }
    return `local ${names.join(', ')} = ${call}; `;
}

/** A game script run beside the one of the game it extends. */
function composeGameScript(release: number, own: string | null, base: string): string {
    const parts: string[] = [];
    if (own !== null) {
        // The game's own script keeps its line numbers, and an error in it
        // leaves the shipped set-up below to run.
        parts.push(
            'local ok, err = pcall(function() ' + header(release, codeOnly(own)) + own + '\nend)\n'
            + 'if not ok then trx.log.error(tostring(err)) end\n',
        );
    } else {
        parts.push(`${COMPAT}(${release})\n`);
    }
    parts.push(
        `-- What the game this one extends sets up, as TRX ${'1.' + CURRENT_RELEASE} ships it.\n`
        + `do\nlocal trx, require = ${COMPAT}()\n${base}\nend\n`,
    );
    return parts.join('');
}

// A script name as require reads one: dot-separated segments of letters,
// digits, `_` and `-`.
function moduleName(path: string): string {
    return path
        .replace(/\.lua$/i, '')
        .replace(/\/init$/i, '')
        .split('/')
        .map((s) => s.replace(/[^A-Za-z0-9_-]/g, '_'))
        .join('.');
}

/**
 * Moves and opens up the scripts of a game made for TRX 1.<release>. Lua the
 * archive held outside a game directory sits in games/<mod>/_loose/ until
 * here: a game made before TRX 1.10 could require it, and a later one only
 * carried the engine's own copy.
 */
export function migrateScripts(
    files: MappedFile[],
    modDir: string,
    gameVersion: number,
    release: number | null,
    baseGameScript: string,
): ScriptMigration {
    const prefix = `games/${modDir}/`;
    const loose = prefix + '_loose/';
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const notes: string[] = [];
    const effective = release ?? CURRENT_RELEASE;
    const byPath = new Map<string, MappedFile>();
    for (const file of files) byPath.set(file.path, file);

    const moduleRenames: Record<string, string> = {};
    // Loose Lua: the engine's own, or a module a script required by its path.
    for (const file of [...byPath.values()]) {
        if (!file.path.startsWith(loose)) continue;
        byPath.delete(file.path);
        const rel = file.path.slice(loose.length);
        if (effective >= 10 || /^data\/scripting\//.test(rel)) continue;
        const name = moduleName(rel);
        byPath.set(prefix + 'modules/' + name.replace(/\./g, '/') + '.lua', { path: prefix + 'modules/' + name.replace(/\./g, '/') + '.lua', data: file.data });
        moduleRenames[rel.replace(/\.lua$/i, '').replace(/\//g, '.').toLowerCase()] = name.toLowerCase();
        const base = rel.split('/').pop()!.replace(/\.lua$/i, '').toLowerCase();
        if (!(base in moduleRenames)) moduleRenames[base] = name.toLowerCase();
    }

    // Before TRX 1.10 the game flow named its scripts.
    const gfPath = prefix + 'gameflow.json5';
    const gfFile = byPath.get(gfPath);
    let ownGameScript: string | null = null;
    if (gfFile && effective < 10) {
        let gameflow: Record<string, unknown> | null = null;
        try {
            gameflow = parseJSON5(decoder.decode(gfFile.data)) as Record<string, unknown>;
        } catch {
            gameflow = null;
        }
        if (gameflow !== null) {
            const find = (rel: string): MappedFile | undefined => {
                const clean = rel.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
                const base = clean.split('/').pop()!;
                return byPath.get(prefix + 'scripts/' + clean)
                    ?? byPath.get(prefix + clean)
                    ?? [...files].find((f) => f.path.toLowerCase().endsWith('/' + clean))
                    ?? [...files].find((f) => f.path.toLowerCase().endsWith('/' + base));
            };
            let moved = 0;
            const sources = new Set<string>();
            const targets = new Set<string>();
            if (typeof gameflow.main_script === 'string') {
                const found = find(gameflow.main_script);
                if (found) {
                    ownGameScript = decoder.decode(found.data);
                    sources.add(found.path);
                    moved++;
                }
                delete gameflow.main_script;
            }
            const levels = Array.isArray(gameflow.levels) ? gameflow.levels as Record<string, unknown>[] : [];
            for (const level of levels) {
                if (typeof level.script !== 'string') continue;
                const found = find(level.script);
                const levelPath = typeof level.path === 'string' ? level.path : '';
                const levelBase = levelPath.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase();
                if (found && levelBase) {
                    const to = prefix + 'scripts/' + levelBase + '.lua';
                    byPath.set(to, { path: to, data: found.data });
                    sources.add(found.path);
                    targets.add(to);
                    moved++;
                }
                delete level.script;
            }
            // The scripts now go by their levels' names, and only by those.
            for (const source of sources) {
                if (!targets.has(source)) byPath.delete(source);
            }
            gfFile.data = encoder.encode(JSON.stringify(gameflow, null, 4));
            byPath.set(gfPath, gfFile);
            if (moved > 0) {
                notes.push(`Moved ${moved} script${moved === 1 ? '' : 's'} to where TRX looks for them, named after their levels.`);
            }
        }
    }

    const gameScriptPath = prefix + 'scripts/_game.lua';
    if (ownGameScript === null && byPath.has(gameScriptPath)) {
        ownGameScript = decoder.decode(byPath.get(gameScriptPath)!.data);
    }

    if (effective >= CURRENT_RELEASE) {
        return { files: [...byPath.values()], notes };
    }

    // Every script the game brought reaches the API of its own release.
    let opened = 0;
    for (const file of [...byPath.values()]) {
        const lower = file.path.toLowerCase();
        if (!lower.startsWith(prefix) || !lower.endsWith('.lua') || file.path === gameScriptPath) continue;
        let src = decoder.decode(file.data);
        if (effective < 12) src = currentMarkupInLua(src, gameVersion);
        src = header(effective, codeOnly(src)) + src;
        byPath.set(file.path, { path: file.path, data: encoder.encode(src) });
        opened++;
    }

    // A game script of the game's own replaces the shipped one, which since
    // TRX 1.10 sets up what the engine used to. Running both keeps each.
    const allies = effective < 1 && gameVersion === 2;
    if (ownGameScript !== null || allies) {
        let own = ownGameScript;
        if (own !== null && effective < 12) own = currentMarkupInLua(own, gameVersion);
        byPath.set(gameScriptPath, {
            path: gameScriptPath,
            data: encoder.encode(composeGameScript(effective, own, baseGameScript)),
        });
        opened++;
    }

    if (opened > 0) {
        const compatPath = prefix + 'modules/trx_compat.lua';
        byPath.set(compatPath, { path: compatPath, data: encoder.encode(compatModule(moduleRenames, gameVersion)) });
        notes.push(
            `Its scripts were written for TRX 1.${effective}, and now reach that API through a compatibility module.`,
        );
    }
    return { files: [...byPath.values()], notes };
}
