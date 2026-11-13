// The settings a game came with.
//
// A builder's archive often carries the settings file the engine wrote while
// they played, cfg/TR3X.json5 and the like, and the game's look can rest on
// it: point filtering, vertex snapping, PS1 fog and colours, the bars and
// menus. Those are settings the player may change, so the game flow does not
// enforce them; the engine just finds them on the first run of the archive.
//
// TRX keeps those settings in the player's own storage, which a converted
// game does not reach, so the converter keeps them beside the game as
// games/<mod>/starting_settings.json5 (plain JSON, as TRX writes its file),
// for whoever plays it to lay them over the player's settings. What belongs
// to the builder's machine and person stays out: the window, the controls,
// the language, records, and the outfit they last tried on.
//
// Builders also make presets of their own, the sets of settings a player
// applies at once from the settings menu (cfg/presets/*.json5): True PS1, say.
// TRX takes a game's presets from its own directory before its own
// (modules/ui/settings/presets.lua), so a game whose archive changed any
// keeps the whole set as it was, in games/<mod>/presets/.

import { renameSettingKeys } from './datafiles.ts';
import { parseJSON5 } from './json5.ts';
import { isStock } from './stock.ts';
import type { MappedFile } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

export const STARTING_SETTINGS = 'starting_settings.json5';

/** Settings of the builder's machine and person, not of the game. */
const PERSONAL = new Set([
    // The window.
    'is_fullscreen', 'is_maximized', 'is_borderless', 'enable_fullscreen', 'enable_maximized',
    'x', 'y', 'width', 'height', 'fs_width', 'fs_height',
    'window_x', 'window_y', 'window_width', 'window_height', 'resolution_width', 'resolution_height',
    // The controls, which name the builder's keys and pads.
    'input', 'layout', 'cntlr_layout', 'backend', 'keyboard_layout', 'controller_layout', 'touch_layout',
    'enable_controller', 'enable_xbox_one_controller', 'enable_touch_controls',
    'touch_button_scale', 'touch_dpad_deadzone', 'touch_dpad_scale', 'touch_opacity',
    // The player: their language, their records, what they were checking.
    'language', 'media_language', 'assault_stats', 'racetrack_stats', 'enable_fps_counter',
    // An outfit picked in the settings dresses Lara in every level; the
    // game flow says what she wears where.
    'lara_outfit',
]);
const PERSONAL_PATTERN = /^(?:cntlr_)?layout_\d+$/;

/** How the engines named the files. */
const DISPLAY: Record<string, string> = { 'tr1x.json5': 'TR1X.json5', 'tr2x.json5': 'TR2X.json5', 'tr3x.json5': 'TR3X.json5', 'tomb1main.json5': 'Tomb1Main.json5' };

/** The settings files the archive may carry, by the game's engine, most current first. */
function candidates(gameVersion: number): string[] {
    return gameVersion === 1 ? ['tr1x.json5', 'tomb1main.json5'] : [`tr${gameVersion}x.json5`];
}

/**
 * The settings a game's players start from, out of the settings file its
 * archive carried (kept at _meta/settings/), or null where it carried none.
 */
export function startingSettings(text: string): AnyObj | null {
    let settings: unknown;
    try {
        settings = parseJSON5(text);
    } catch {
        return null;
    }
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;
    const kept: AnyObj = {};
    for (const [key, value] of Object.entries(settings)) {
        if (PERSONAL.has(key) || PERSONAL_PATTERN.test(key)) continue;
        kept[key] = value;
    }
    renameSettingKeys(kept);
    return Object.keys(kept).length > 0 ? kept : null;
}

/** Writes games/<mod>/starting_settings.json5 from the settings file the archive carried. */
export function keepStartingSettings(files: MappedFile[], modDir: string, gameVersion: number): string[] {
    const prefix = `games/${modDir}/`;
    for (const name of candidates(gameVersion)) {
        const file = files.find((f) => f.path === `${prefix}_meta/settings/${name}`);
        if (!file) continue;
        const settings = startingSettings(new TextDecoder().decode(file.data));
        if (settings === null) return [];
        const data = new TextEncoder().encode(JSON.stringify(settings, null, 2));
        const existing = files.find((f) => f.path === prefix + STARTING_SETTINGS);
        if (existing) existing.data = data;
        else files.push({ path: prefix + STARTING_SETTINGS, data });
        return [`Kept the settings the game came with (cfg/${DISPLAY[name] ?? name}), such as how it draws and sounds, for its players to start from, without the builder's window, controls and language.`];
    }
    return [];
}

/**
 * Writes the archive's settings presets (kept at _meta/presets/) into
 * games/<mod>/presets/ where any is not a copy of one TRX shipped. Returns
 * the notes and the game strings the presets are named by.
 */
export async function keepOwnPresets(files: MappedFile[], modDir: string): Promise<{ notes: string[]; names: Set<string> }> {
    const prefix = `games/${modDir}/`;
    const names = new Set<string>();
    const presets = files.filter((f) => f.path.startsWith(`${prefix}_meta/presets/`));
    let own = false;
    for (const preset of presets) if (!(await isStock(preset))) own = true;
    if (!own) return { notes: [], names };
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let kept = 0;
    for (const preset of presets) {
        let doc: unknown;
        try {
            doc = parseJSON5(decoder.decode(preset.data));
        } catch {
            continue;
        }
        if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) continue;
        const data = doc as AnyObj;
        if (typeof data.name_gs !== 'string' || typeof data.config !== 'object' || data.config === null) continue;
        renameSettingKeys(data.config);
        names.add(data.name_gs);
        files.push({ path: `${prefix}presets/${preset.path.split('/').pop()}`, data: encoder.encode(JSON.stringify(data, null, 4)) });
        kept++;
    }
    if (kept === 0) return { notes: [], names };
    return { notes: [`Kept the ${kept} settings presets the game came with, which it made its own, in place of TRX's.`], names };
}
