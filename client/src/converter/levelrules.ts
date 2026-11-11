// What the original engines did by themselves, which TRX now leaves to each
// level's script or data.
//
// tomb2.exe and tomb3.exe decided some behaviour by the number of the level
// being played, or from a trigger's timer, and early TRX releases kept those
// rules. TRX has since moved each into the scripts and properties of the
// original levels (docs/trx/MIGRATING.md, docs/CHANGELOG.md), which a custom
// game does not run. So a game built from TOMBPC.DAT or a TR1X/TR2X game
// flow gets them all, by the place each level had in its original script,
// and a TRX game gets those its release still had.
//
// The rules are taken from the TRX code that removed them; each says which
// release did, and is written as a script the level or game runs.

import { BASE_FILES } from '../templates/base/index.ts';
import { parseJSON5 } from './json5.ts';
import { LEGACY_MARKER } from './legacy.ts';
import { clearEndLevelParameters, readLevel, type LevelData } from './level.ts';
import { parseTR2Script } from './tombpc.ts';
import type { BaseGame } from './basegame.ts';
import type { MappedFile } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

// Shoal ranges of tomb3.exe by level and shoal number, in blocks of 256
// before the 2 the engine added along x and z (TRX 1.7.1 shoal.c).
const SHOAL_RANGES: Record<number, [number, number, number][]> = {
    0: [[4, 1, 4], [16, 2, 8], [24, 2, 8], [8, 2, 16], [8, 1, 12], [20, 2, 8], [16, 1, 8]],
    1: [[8, 3, 20]],
    2: [[4, 2, 4], [4, 2, 16], [4, 3, 28]],
    3: [[4, 1, 12], [0, 2, 12], [8, 2, 4], [4, 1, 8], [4, 2, 16], [4, 1, 24], [12, 1, 4], [16, 1, 4]],
    5: [[12, 6, 12], [12, 6, 20], [20, 8, 4]],
    6: [[20, 6, 4]],
    7: [[16, 8, 16], [4, 5, 8]],
};

type Scripts = {
    /** Set up each time a level of the game starts. */
    gameStart: string[];
    /** Registered once, for the whole game. */
    game: string[];
    levelStart: Map<string, string[]>;
    level: Map<string, string[]>;
};

function push(map: Map<string, string[]>, key: string, ...lines: string[]): void {
    const list = map.get(key) ?? [];
    list.push(...lines);
    map.set(key, list);
}

function levelKey(path: string): string {
    return path.split('/').pop()!.toLowerCase().replace(/\.[^.]+$/, '');
}

function objectNumber(gameVersion: number, key: string): number | null {
    const csv = BASE_FILES[`tr${gameVersion}/catalog_objects.csv`] ?? '';
    const m = new RegExp(`^(\\d+),\\s*${key}\\b`, 'm').exec(csv);
    return m ? +m[1] : null;
}

// Helpers every generated block starts with: objects and ids that a game
// may lack are skipped rather than raising.
const PRELUDE = [
    'local trx = _G.trx',
    'local function object(key)',
    '  local ok, found = pcall(function() return trx.objects[key] end)',
    '  return ok and found or nil',
    'end',
    'local function id(key)',
    '  local ok, found = pcall(function() return trx.catalog.objects[key] end)',
    '  return ok and found or nil',
    'end',
    // A property an object of this game or level lacks is left alone.
    'local function set(target, key, value)',
    '  if target ~= nil then',
    '    pcall(function() target.properties[key] = value end)',
    '  end',
    'end',
];

function block(raw: string[], start: string[]): string {
    const lines = ['do', '  -- What the original engine did by itself; see the converter\'s levelrules.ts.'];
    lines.push(...PRELUDE.map((l) => '  ' + l));
    lines.push(...raw.map((l) => '  ' + l));
    if (start.length > 0) {
        lines.push('  trx.events.on_game_start(function(is_save)');
        lines.push(...start.map((l) => '    ' + l));
        lines.push('  end)');
    }
    lines.push('end', '');
    return lines.join('\n');
}

function tr3Rules(
    s: Scripts,
    applies: (removedIn: number, classicOnly?: boolean) => boolean,
    levels: Map<string, number>,
    data: Map<string, LevelData>,
    lostArtifact: boolean,
): void {
    const quest = '{ "quest_item_1", "quest_item_2", "quest_item_3", "quest_item_4" }';

    // TRX 1.10: artefacts spun and glowed green wherever they lay.
    if (applies(10)) {
        s.gameStart.push(
            `for _, key in ipairs(${quest}) do`,
            '  local found = object(key)',
            '  if found ~= nil then',
            '    set(found, "glow_color", "#00F87C")',
            '    set(found, "rotation", trx.math.DEG_90 // 16)',
            '    set(found, "show_pickup_aid", false)',
            '  end',
            'end',
        );
    }
    // TRX 1.12: a fire head blew for as many frames as its trigger's timer
    // said, and the trigger did not time it out.
    if (applies(12)) {
        s.game.push(
            'trx.events.on_trigger(function(item, trigger)',
            '  if item.object_id ~= id("fire_head") or trigger.type == trx.items.TriggerType.ANTITRIGGER then',
            '    return',
            '  end',
            '  set(item, "blow_time", math.floor(trigger.timer) / 30)',
            '  item.timer = 0',
            'end)',
        );
    }
    if (applies(8)) {
        // Ceiling spikes fell fast where their trigger's timer was 1.
        s.game.push(
            'trx.events.on_trigger(function(item, trigger)',
            '  if item.object_id == id("ceiling_spikes") then',
            '    set(item, "speed", math.floor(trigger.timer) == 1 and 10 or 5)',
            '  end',
            'end)',
        );
    }
    // TRX 1.2: Monkeys left Lara be wherever there was a tiger.
    if (applies(2)) {
        s.gameStart.push(
            'local tiger = object("tiger")',
            'if tiger ~= nil and tiger.loaded and id("monkey") ~= nil then',
            '  trx.creatures.add_ally(id("monkey"))',
            'end',
        );
    }
    // The South Pacific mercenary was on Lara's side.
    if (applies(0, true)) {
        s.gameStart.push('if id("sthpac_mercenary") ~= nil then trx.creatures.add_ally(id("sthpac_mercenary")) end');
    }

    for (const [key, num] of levels) {
        // TRX 1.8: picking up an artefact ended the level, except in the
        // last one, and in The Lost Artifact the fifth.
        if (applies(8) && num !== 19 && !(lostArtifact && num === 4)) {
            push(s.level, key,
                'trx.events.on_pickup(function(item_num)',
                '  local item = trx.items[item_num]',
                '  if item == nil then return end',
                `  for _, key in ipairs(${quest}) do`,
                '    if item.object_id == id(key) then',
                '      trx.game.end_level()',
                '      return',
                '    end',
                '  end',
                'end)',
            );
        }
        if (applies(8) && num >= 9) {
            push(s.levelStart, key,
                'local cobra = object("cobra")',
                'if cobra ~= nil then',
                '  set(cobra, "alert_radius", 1.25)',
                '  set(cobra, "attack_radius", 0.666667)',
                '  set(cobra, "forget_radius", 2.5)',
                'end',
            );
        }
        if (applies(8)) {
            // Shoals took their number from the trigger's timer, and their
            // range from the level's table.
            const ranges = (SHOAL_RANGES[num] ?? [])
                .map(([x, y, z], i) => `[${i}] = { x = ${x + 2}, y = ${y}, z = ${z + 2} }`)
                .join(', ');
            push(s.level, key,
                `local shoal_ranges = { ${ranges} }`,
                'trx.events.on_trigger(function(item, trigger)',
                '  local fish = item.object_id == id("tropical_fish")',
                '  if not fish and item.object_id ~= id("piranhas") then return end',
                '  local shoal = math.floor(trigger.timer) & 7',
                '  set(item, "range", shoal_ranges[shoal] or { x = 1, y = 1, z = 1 })',
                '  if fish then',
                '    set(item, "sprite_offset", (shoal & 1) == 0 and 1 or 0)',
                '  end',
                'end)',
            );
        }
        if (applies(8) && num === 7) {
            push(s.levelStart, key, 'local flames = object("flame_emitter_side")', 'if flames ~= nil then set(flames, "interval", 4) end');
        }
        if (applies(8) && num === 9) {
            push(s.levelStart, key,
                'for _, key in ipairs({ "propeller_2", "propeller_3" }) do',
                '  local found = object(key)',
                '  if found ~= nil then set(found, "damage", 1000) end',
                'end',
            );
        }
        if (applies(8) && num === 15) {
            push(s.levelStart, key, 'local strobe = object("strobe_light")', 'if strobe ~= nil then set(strobe, "requires_alarm_active", true) end');
        }
        if (applies(8)) {
            // Spikes moved, with their own sound, in levels 5 and 7 alone;
            // elsewhere a trigger left them standing.
            const sample = num === 5 ? 'shiva_sword_2' : num === 7 ? 'lara_get_out' : null;
            if (sample) {
                push(s.level, key,
                    'local spikes = nil',
                    'trx.events.after_control(function()',
                    '  if spikes == nil then',
                    '    spikes = id("spikes") and trx.items.query:of_object(id("spikes")):matches() or {}',
                    '  end',
                    '  for _, item in ipairs(spikes) do',
                    '    if item:is_valid() and item.is_triggered and item.frame_num == 0 then',
                    `      trx.sound.play(trx.catalog.samples.${sample}, { pos = item.pos })`,
                    '    end',
                    '  end',
                    'end)',
                );
            } else {
                push(s.level, key,
                    'trx.events.on_trigger(function(item)',
                    '  if item.object_id == id("spikes") then item:deactivate() end',
                    'end)',
                );
            }
        }
        if (applies(8) && (num === 14 || num === 15)) {
            // A patrol marker standing on an enemy stayed, as a place to go.
            const level = data.get(key);
            const patrol = objectNumber(3, 'ai_patrol_1');
            const spots = level && patrol !== null ? level.items.filter((i) => i.objectId === patrol) : [];
            if (spots.length > 0) {
                push(s.levelStart, key,
                    'if not is_save and id("ai_patrol_1") ~= nil then',
                    ...spots.map((p) => `  trx.items.spawn(id("ai_patrol_1"), { x = ${p.x}, y = ${p.y}, z = ${p.z} }, ${p.angle})`),
                    'end',
                );
            }
        }
        if (applies(7) && num === 3) {
            push(s.levelStart, key,
                'local quad = object("quad_bike")',
                'if quad ~= nil then',
                '  set(quad, "track_1", 9)',
                '  set(quad, "track_2", 12)',
                '  set(quad, "track_3", 4)',
                '  set(quad, "track_4", 12)',
                'end',
            );
        }
        // Allies and cold of the original levels, which TRX had as scripts
        // from the first release that knew these creatures.
        const allies: Record<number, string[]> = { 11: ['punk_1'], 14: ['prisoner'], 15: ['prisoner'], 17: ['rx_worker_3'] };
        if (applies(0, true) && allies[num]) {
            push(s.levelStart, key, ...allies[num].map((a) => `if id("${a}") ~= nil then trx.creatures.add_ally(id("${a}")) end`));
        }
        if (applies(0, true) && (num === 16 || num === 17)) {
            push(s.levelStart, key,
                'for _, room in pairs(trx.rooms) do',
                '  room.damaging = room.underwater',
                '  room.cold = true',
                'end',
            );
        }
        if (applies(0, true) && num === 18) {
            push(s.levelStart, key,
                'if id("animating_ext_1") ~= nil then',
                '  for _, item in ipairs(trx.items.query:of_object(id("animating_ext_1")):matches()) do',
                '    set(item, "kill_on_trigger", true)',
                '  end',
                'end',
            );
        }
    }
}

function tr2Rules(s: Scripts, applies: (removedIn: number, classicOnly?: boolean) => boolean): void {
    // TRX 1.1: monks were Lara's allies and the bandits their enemies, as
    // tomb2.exe had them.
    if (applies(1)) {
        s.gameStart.push(
            'for _, key in ipairs({ "monk_1", "monk_2", "monk_3" }) do',
            '  if id(key) ~= nil then trx.creatures.add_ally(id(key)) end',
            'end',
            'for _, key in ipairs({ "bandit_1", "bandit_2" }) do',
            '  if id(key) ~= nil then trx.creatures.add_ally_target(id(key)) end',
            'end',
        );
    }
    if (!applies(0, true)) return;
    s.gameStart.push(
        // tomb2.exe moved Bartoli half a block before the dragon.
        'if not is_save and id("bartoli") ~= nil then',
        '  for _, item in ipairs(trx.items.query:of_object(id("bartoli")):matches()) do',
        '    local pos = item.pos',
        '    item.pos = { x = pos.x - 512, y = pos.y, z = pos.z - 512 }',
        '  end',
        'end',
    );
    // The bird guardian's death ended the level.
    s.game.push(
        'trx.events.after_control(function()',
        '  if id("bird_guardian") == nil or not trx.game.is_playing then return end',
        '  local guardian = trx.items.query:of_object(id("bird_guardian")):first()',
        '  if guardian ~= nil and guardian.anim_num == 20 and guardian.frame_num == 158 then',
        '    trx.game.end_level()',
        '  end',
        'end)',
    );
}

function tr1Rules(s: Scripts, applies: (removedIn: number, classicOnly?: boolean) => boolean): void {
    // TRX 1.10: a scion was picked up off its plinth with Lara's own
    // animation.
    if (applies(10)) {
        s.gameStart.push(
            'local scion = object("scion_item_1")',
            'if scion ~= nil then set(scion, "pickup_mode", trx.items.PickupMode.PLINTH_SCION) end',
        );
    }
}

export type LevelRules = { files: MappedFile[]; notes: string[] };

/** Whether legacy.ts gave the game TRX's shape from a TR1X or TR2X game flow, which kept the original engines' rules. */
function madeForEngineBeforeTRX(files: MappedFile[], prefix: string): boolean {
    const marker = files.find((f) => f.path === prefix + LEGACY_MARKER);
    if (!marker) return false;
    try {
        const doc = JSON.parse(decoder.decode(marker.data)) as { engine?: unknown };
        return doc.engine !== 'TRX';
    } catch {
        return true;
    }
}

/**
 * Writes the original engine's rules into the scripts of a game, for the
 * TRX release it was made for (null: a game built from the original data).
 */
export function applyLevelRules(
    files: MappedFile[],
    modDir: string,
    gameVersion: number,
    release: number | null,
    base: BaseGame,
): LevelRules {
    const prefix = `games/${modDir}/`;
    const notes: string[] = [];
    const tombpc = files.find((f) => f.path === prefix + 'tombpc.dat');
    const classic = tombpc !== undefined || madeForEngineBeforeTRX(files, prefix);
    const applies = (removedIn: number, classicOnly = false) =>
        classic || (!classicOnly && release !== null && release < removedIn);

    // Each level's number in the script it was made for.
    const levels = new Map<string, number>();
    if (tombpc && gameVersion >= 2) {
        const script = parseTR2Script(tombpc.data, gameVersion);
        script?.filenames.forEach((name, i) => {
            const key = levelKey(name.replace(/\\/g, '/'));
            if (!levels.has(key)) levels.set(key, i);
        });
    } else {
        const gameflow = files.find((f) => f.path === prefix + 'gameflow.json5');
        const doc = gameflow ? parseJSON5(decoder.decode(gameflow.data)) as AnyObj : null;
        (Array.isArray(doc?.levels) ? doc!.levels : []).forEach((level: AnyObj, i: number) => {
            if (typeof level.path === 'string') levels.set(levelKey(level.path), i);
        });
    }

    // The level files, read once; end-level parameters are cleared as they go.
    const data = new Map<string, LevelData>();
    let cleared = 0;
    for (const file of files) {
        if (!file.path.startsWith(prefix + 'levels/') || !/\.(phd|tr2)$/i.test(file.path)) continue;
        const level = readLevel(file.data);
        if (!level) continue;
        data.set(levelKey(file.path), level);
        // TRX 1.11: an end-level trigger's parameter names the next level.
        if (applies(11)) {
            const copy = file.data.slice();
            const n = clearEndLevelParameters(copy, level);
            if (n > 0) {
                file.data = copy;
                cleared += n;
            }
        }
    }
    if (cleared > 0) {
        notes.push(`Cleared ${cleared} end-level trigger parameter${cleared === 1 ? '' : 's'}, which the original engine ignored and TRX reads as the next level.`);
    }

    const s: Scripts = { gameStart: [], game: [], levelStart: new Map(), level: new Map() };
    // Only the levels this game has.
    for (const key of [...levels.keys()]) {
        if (!data.has(key)) levels.delete(key);
    }
    // TRX 1.8: vehicles could not set off heavy triggers.
    if (applies(8)) {
        s.gameStart.push(
            'for _, key in ipairs({ "boat", "kayak", "quad_bike", "rib" }) do',
            '  local found = object(key)',
            '  if found ~= nil then',
            '    set(found, "is_heavy", false)',
            '  end',
            'end',
        );
    }
    if (gameVersion === 3) tr3Rules(s, applies, levels, data, base.lostArtifact);
    else if (gameVersion === 2) tr2Rules(s, applies);
    else tr1Rules(s, applies);

    const out = files.slice();

    // The Lost Artifact's orcas collided underwater, as TRX's dolphin does;
    // the game's catalog binds the orca's slot to it.
    if (base.lostArtifact && applies(8)) {
        const path = prefix + 'catalog_objects.csv';
        const own = out.find((f) => f.path === path);
        const text = own ? decoder.decode(own.data) : BASE_FILES['tr3/catalog_objects.csv'] ?? '';
        const bound = text.replace(/^(\s*\d+\s*,\s*)(O_)?orca\b/gim, '$1dolphin');
        if (bound !== text) {
            if (own) own.data = encoder.encode(bound);
            else out.push({ path, data: encoder.encode(bound) });
            notes.push('Bound the orca to TRX\'s dolphin, which collides underwater as The Lost Artifact\'s orca did.');
        }
    }

    const write = (path: string, text: string, base: string) => {
        const existing = out.find((f) => f.path === path);
        if (existing) {
            existing.data = encoder.encode(decoder.decode(existing.data).replace(/\n*$/, '\n') + text);
        } else {
            out.push({ path, data: encoder.encode(base + text) });
        }
    };
    let scripts = 0;
    if (s.game.length > 0 || s.gameStart.length > 0) {
        // A game script of the game's own replaces the shipped one, so a new
        // one starts with the shipped set-up.
        write(prefix + 'scripts/_game.lua', block(s.game, s.gameStart), base.gameScript.replace(/\n*$/, '\n'));
        scripts++;
    }
    for (const key of new Set([...s.level.keys(), ...s.levelStart.keys()])) {
        write(prefix + `scripts/${key}.lua`, block(s.level.get(key) ?? [], s.levelStart.get(key) ?? []), '');
        scripts++;
    }
    if (scripts > 0) {
        notes.push(`Wrote what the original engine did by itself into ${scripts} script${scripts === 1 ? '' : 's'}.`);
    }
    return { files: out, notes };
}
