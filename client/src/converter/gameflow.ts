import type { MappedFile } from './types.ts';
import { parseJSON5 } from './json5.ts';
import { parseTR2Script, tr2RealTrack } from './tombpc.ts';
import { readLevel, remapMusicTriggers } from './level.ts';
import { getTemplate, getTemplateFiles, getCfgFile } from '../templates/index.ts';
import { cfgGameflow, dressClassicGame, translateLegacy } from './legacy.ts';
import { currentInjectionName } from './stock.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

/**
 * Where setupCustomGameflow leaves how many music triggers of a TR2 game it
 * renumbered to the files tomb2.exe played, for migrate.ts to say so.
 */
export const MUSIC_NOTE = '_meta/music_renumbered';

// Lara's home in each game, which the passport offers apart from the levels
// a new game plays.
const HOME_LEVELS: Record<string, boolean> = {
    'gym.phd': true,
    'assault.tr2': true,
    'house.tr2': true,
};

// The name TRX knows an injection by: no directory, and its current name.
function currentInjection(path: string): string {
    return currentInjectionName(path.split('/').pop()!);
}

// The file name a script gives, as the archive maps it: lower case, with no
// directory, whichever slashes the script used.
function baseName(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
}

export async function setupCustomGameflow(
    mappedFiles: MappedFile[],
    modDir: string,
    gameVersion: number,
    useOutfitImport: boolean,
    modTitle: string = '',
): Promise<MappedFile[]> {
    const result = await buildGameflow(mappedFiles, modDir, gameVersion, useOutfitImport, modTitle);
    if (useOutfitImport) addOutfitLabel(result, modDir);
    return result;
}

async function buildGameflow(
    mappedFiles: MappedFile[],
    modDir: string,
    gameVersion: number,
    useOutfitImport: boolean,
    modTitle: string,
): Promise<MappedFile[]> {
    const modPrefix = 'games/' + modDir + '/';
    // A game made for an engine before TRX (Tomb1Main, TR1X, TR2X and their
    // kin) takes TRX 1.0's shape first.
    if (!mappedFiles.some((f) => f.path === modPrefix + 'gameflow.json5')) {
        const legacy = await translateLegacy(mappedFiles, modDir, gameVersion, modTitle);
        if (legacy) return legacy.files;
    }
    const result = mappedFiles.slice();
    const templateMod = `tr${gameVersion}-level`;
    const extendsBase = `tr${gameVersion}`;
    const defaultOutfit = useOutfitImport
        ? 'level_default'
        : `tr${gameVersion}_classic`;

    const outfitFiles: MappedFile[] = [];
    if (useOutfitImport) {
        outfitFiles.push(...injectLevelDefaultOutfit(modDir, gameVersion));
    }

    let hasGameflow = false;
    let hasStrings = false;
    let scriptEntry: MappedFile | null = null;
    let gfEntry: MappedFile | null = null;
    for (let i = 0; i < result.length; i++) {
        if (result[i].path === modPrefix + 'gameflow.json5') {
            hasGameflow = true;
            gfEntry = result[i];
        }
        if (result[i].path.indexOf(modPrefix + 'strings') === 0
            && result[i].path.endsWith('.json5')) {
            hasStrings = true;
        }
        if (result[i].path === modPrefix + 'tombpc.dat') {
            scriptEntry = result[i];
        }
    }

    if (hasGameflow && gfEntry) {
        const gfText = new TextDecoder().decode(gfEntry.data);

        if (gfText.indexOf('"PLACEHOLDER"') !== -1) {
            const fullGfData = cfgGameflow(result, modDir)?.data ?? null;
            if (fullGfData) {
                const fullText = new TextDecoder().decode(fullGfData);
                const fullGf = parseJSON5(fullText) as AnyObj;
                const uploadedLevels: Record<string, boolean> = {};
                for (let fi = 0; fi < result.length; fi++) {
                    const p = result[fi].path;
                    if (p.indexOf(modPrefix + 'levels/') === 0) {
                        const fn = p.split('/').pop()!;
                        uploadedLevels[fn] = true;
                    }
                }
                const filteredLevels: AnyObj[] = [];
                let titleEntry: AnyObj | null = null;
                const fullLevels: AnyObj[] = fullGf.levels || [];
                for (let li = 0; li < fullLevels.length; li++) {
                    const src = fullLevels[li];
                    const lvlPath = (src.path || '').split('/').pop().toLowerCase();
                    if (!uploadedLevels[lvlPath]) continue;
                    const lvl: AnyObj = {
                        path: lvlPath,
                        music_track: src.music_track != null ? src.music_track : -1,
                        lara_outfit: src.lara_outfit || defaultOutfit,
                        sequence: src.sequence || [],
                    };
                    if (src.injections) {
                        lvl.injections = src.injections.map(function(p: string) {
                            return p.split('/').pop();
                        });
                    }
                    if (src.type === 'gym_home' || lvlPath === 'title.tr2') {
                        titleEntry = {
                            path: lvlPath,
                            music_track: -1,
                            sequence: [
                                { type: 'exit_to_title' },
                            ],
                        };
                    } else {
                        filteredLevels.push(lvl);
                    }
                }
                if (filteredLevels.length > 0) {
                    const tplText = getTemplate(templateMod, 'gameflow.json5');
                    const tplGf = parseJSON5(tplText) as AnyObj;
                    tplGf.levels = filteredLevels;
                    if (fullGf.title) {
                        const ft = fullGf.title;
                        titleEntry = {
                            path: (ft.path || '').split('/').pop().toLowerCase(),
                            music_track: ft.music_track != null ? ft.music_track : -1,
                            sequence: [{ type: 'exit_to_title' }],
                        };
                    }
                    if (titleEntry) {
                        tplGf.title = titleEntry;
                    }
                    tplGf.engine = gameVersion;
                    tplGf.extends = extendsBase;
                    if (modTitle) {
                        tplGf.name = modTitle;
                    }
                    const gfJson = JSON.stringify(tplGf, null, 4);
                    const gfBytes = new TextEncoder().encode(gfJson);
                    gfEntry.data = gfBytes;
                    const strFiles = generateStrings(modDir, templateMod,
                        filteredLevels.map(function(l: AnyObj) {
                            const p: string = l.path || '';
                            return { title: p.replace(/\.[^.]+$/, '') };
                        }));
                    result.push(...outfitFiles, ...strFiles);
                    return result;
                }
            }
            hasGameflow = false;
            hasStrings = false;
        }
    }

    if (hasGameflow && gfEntry) {
        const gfText = new TextDecoder().decode(gfEntry.data);
        const gameflow = parseJSON5(gfText) as AnyObj;

        let gfDirty = false;
        if (!gameflow.main_menu_picture) {
            const tplText = getTemplate(templateMod, 'gameflow.json5');
            const tplGf = parseJSON5(tplText) as AnyObj;
            gameflow.main_menu_picture = tplGf.main_menu_picture;
            gfDirty = true;
        }
        const levels: AnyObj[] = gameflow.levels || [];
        for (let li = 0; li < levels.length; li++) {
            if (levels[li].type === 'title'
                || levels[li].type === 'dummy'
                || levels[li].type === 'current') continue;
            if (!levels[li].lara_outfit) {
                levels[li].lara_outfit = `tr${gameVersion}_classic`;
                gfDirty = true;
            }
            if (levels[li].injections) {
                const inj: string[] = levels[li].injections;
                for (let ii = 0; ii < inj.length; ii++) {
                    const stripped = currentInjection(inj[ii]);
                    if (stripped !== inj[ii]) {
                        inj[ii] = stripped;
                        gfDirty = true;
                    }
                }
            }
        }
        if (gameflow.injections) {
            for (let ii = 0; ii < gameflow.injections.length; ii++) {
                const stripped = currentInjection(gameflow.injections[ii]);
                if (stripped !== gameflow.injections[ii]) {
                    gameflow.injections[ii] = stripped;
                    gfDirty = true;
                }
            }
        }
        gameflow.engine = gameVersion;
        gameflow.extends = extendsBase;
        gfDirty = true;
        if (modTitle) {
            gameflow.name = modTitle;
        }
        if (gfDirty) {
            const gfJson = JSON.stringify(gameflow, null, 4);
            const gfBytes = new TextEncoder().encode(gfJson);
            gfEntry.data = gfBytes;
        }

        if (!hasStrings) {
            const strFiles = generateStrings(modDir, templateMod,
                levels.map(function(l: AnyObj) {
                    const p: string = l.path || '';
                    return { title: p.replace(/\.[^.]+$/, '') };
                }));
            result.push(...outfitFiles, ...strFiles);
        } else {
            result.push(...outfitFiles);
        }
        // An engine that reads a game flow of its own never reads a
        // TOMBPC.DAT the archive carries beside it, left over from the
        // original game; taken for the game's script, it would have the
        // game played by the original engine's rules (levelrules.ts).
        return scriptEntry ? result.filter((f) => f !== scriptEntry) : result;
    }

    if (scriptEntry && gameVersion >= 2) {
        try {
            const scriptInfo = parseTR2Script(scriptEntry.data, gameVersion);
            // A TR2 script numbers music as tomb2.exe did (tr2RealTrack).
            const scriptTrack = (track: number): number => (gameVersion === 2 ? tr2RealTrack(track) : track);
            if (scriptInfo && scriptInfo.filenames.length > 1) {
                const tplText = getTemplate(templateMod, 'gameflow.json5');
                const gameflow = parseJSON5(tplText) as AnyObj;
                const templateLevel = gameflow.levels[0];

                // What the archive brought, by the name a script gives it.
                const uploaded: Record<string, boolean> = {};
                for (let i = 0; i < result.length; i++) {
                    if (result[i].path.indexOf(modPrefix) === 0) {
                        uploaded[baseName(result[i].path)] = true;
                    }
                }

                // The title level is the first level among the title
                // screen's files; the rest are its pictures.
                let titlePath: string | null = null;
                for (let i = 0; i < scriptInfo.titleFiles.length; i++) {
                    const base = baseName(scriptInfo.titleFiles[i]);
                    if (/\.(tr2|phd|tub)$/.test(base)) {
                        titlePath = base;
                        break;
                    }
                }
                if (titlePath === null || !uploaded[titlePath]) {
                    for (const name in uploaded) {
                        if (/^title\.(tr2|phd|tub)$/.test(name)) titlePath = name;
                    }
                }
                gameflow.title = {
                    path: titlePath ?? 'title.tr2',
                    music_track: scriptTrack(scriptInfo.titleSoundId),
                    sequence: [{ type: 'exit_to_title' }],
                };

                // Only the FMVs and cutscenes the archive brought can play,
                // numbered as the gameflow lists them.
                const fmvIds: Record<number, number> = {};
                gameflow.fmvs = [];
                for (let i = 0; i < scriptInfo.fmvFiles.length; i++) {
                    const base = baseName(scriptInfo.fmvFiles[i]);
                    if (!uploaded[base]) continue;
                    fmvIds[i] = gameflow.fmvs.length;
                    gameflow.fmvs.push({ path: base });
                }
                const cutsceneIds: Record<number, number> = {};
                gameflow.cutscenes = [];
                for (let i = 0; i < scriptInfo.cutsceneFiles.length; i++) {
                    const base = baseName(scriptInfo.cutsceneFiles[i]);
                    if (!uploaded[base]) continue;
                    cutsceneIds[i] = gameflow.cutscenes.length;
                    gameflow.cutscenes.push({
                        path: base,
                        music_track: scriptTrack(scriptInfo.cutsceneTracks[i]),
                        lara_outfit: defaultOutfit,
                        sequence: [{ type: 'loop_game' }],
                    });
                }
                function renumber(sequence: AnyObj[]): AnyObj[] {
                    const out: AnyObj[] = [];
                    for (let i = 0; i < sequence.length; i++) {
                        const event = sequence[i];
                        if (event.type === 'play_fmv') {
                            if (!(event.fmv_id in fmvIds)) continue;
                            out.push({ ...event, fmv_id: fmvIds[event.fmv_id] });
                        } else if (event.type === 'play_cutscene') {
                            if (!(event.cutscene_id in cutsceneIds)) continue;
                            out.push({ ...event, cutscene_id: cutsceneIds[event.cutscene_id] });
                        } else if (event.type === 'play_music') {
                            out.push({ ...event, music_track: scriptTrack(event.music_track) });
                        } else {
                            out.push(event);
                        }
                    }
                    return out;
                }

                // The script lists every level of the game it was made
                // from; only the ones the archive brought can play. The
                // first is Lara's home.
                gameflow.levels = [];
                const titleEntries: { title: string }[] = [];
                for (let i = 0; i < scriptInfo.filenames.length; i++) {
                    const base = baseName(scriptInfo.filenames[i]);
                    if (!uploaded[base] || base === titlePath) continue;
                    const entry: AnyObj = JSON.parse(
                        JSON.stringify(templateLevel));
                    entry.path = base;
                    entry.lara_outfit = defaultOutfit;
                    entry.music_track = scriptTrack(scriptInfo.musicTracks[i]);
                    if (scriptInfo.sequences[i]) {
                        entry.sequence = renumber(scriptInfo.sequences[i] as AnyObj[]);
                    }
                    if (i === 0) entry.type = 'gym';
                    gameflow.levels.push(entry);

                    const title =
                        (i < scriptInfo.levelTitles.length
                         && scriptInfo.levelTitles[i])
                            ? scriptInfo.levelTitles[i]
                            : base.replace(/\.[^.]+$/, '');
                    titleEntries.push({ title: title });
                }

                // Lara starts the first level proper, not her home, with
                // what she carries.
                let firstLvl: AnyObj | null = null;
                for (let i = 0; i < gameflow.levels.length; i++) {
                    if (gameflow.levels[i].type !== 'gym') {
                        firstLvl = gameflow.levels[i];
                        break;
                    }
                }
                if (firstLvl) {
                    const seq: AnyObj[] = firstLvl.sequence || [];
                    let hasGiveItem = false;
                    let hasRemoveWeapons = false;
                    for (let si = 0; si < seq.length; si++) {
                        if (seq[si].type === 'give_item')
                            hasGiveItem = true;
                        if (seq[si].type === 'remove_weapons')
                            hasRemoveWeapons = true;
                    }
                    if (!hasGiveItem && !hasRemoveWeapons) {
                        const defaults: AnyObj[] =
                            gameVersion === 3
                                ? [
                                    { type: 'give_item',
                                      object_id: 'small_medipack_item' },
                                    { type: 'give_item',
                                      object_id: 'large_medipack_item' },
                                    { type: 'give_item',
                                      object_id: 'flare_item',
                                      quantity: 2 },
                                ]
                                : [
                                    { type: 'give_item',
                                      object_id: 'shotgun_item' },
                                    { type: 'give_item',
                                      object_id: 'small_medipack_item' },
                                    { type: 'give_item',
                                      object_id: 'large_medipack_item' },
                                    { type: 'give_item',
                                      object_id: 'flare_item',
                                      quantity: 2 },
                                ];
                        let loopIdx = -1;
                        for (let si = 0; si < seq.length; si++) {
                            if (seq[si].type === 'loop_game') {
                                loopIdx = si;
                                break;
                            }
                        }
                        if (loopIdx >= 0) {
                            seq.splice(loopIdx, 0, ...defaults);
                        } else {
                            seq.unshift(...defaults);
                        }
                        firstLvl.sequence = seq;
                    }
                }

                // The original engines gave Lara her pistols back on the
                // level after one that took her weapons; TRX's own game
                // flows say so for the Diving Area and Area 51.
                const levelList: AnyObj[] = gameflow.levels;
                for (let i = 1; i < levelList.length; i++) {
                    const before: AnyObj[] = levelList[i - 1].sequence || [];
                    if (!before.some((e) => e.type === 'remove_weapons')) continue;
                    const seq: AnyObj[] = levelList[i].sequence || [];
                    if (seq.some((e) => e.type === 'give_item' && e.object_id === 'pistols_item')) continue;
                    const pistols = { type: 'give_item', object_id: 'pistols_item', quantity: 1 };
                    const loopIdx = seq.findIndex((e) => e.type === 'loop_game');
                    if (loopIdx >= 0) seq.splice(loopIdx, 0, pistols);
                    else seq.unshift(pistols);
                    levelList[i].sequence = seq;
                }

                gameflow.engine = gameVersion;
                gameflow.extends = extendsBase;
                if (modTitle) {
                    gameflow.name = modTitle;
                }
                const gfJson = JSON.stringify(gameflow, null, 4);
                const gfData = new TextEncoder().encode(gfJson);
                const gfPath = modPrefix + 'gameflow.json5';
                result.push({ path: gfPath, data: gfData });

                const strFiles = generateStrings(modDir, templateMod, titleEntries);
                result.push(...outfitFiles, ...strFiles);

                // tomb2.exe played the file Music_GetRealTrack gave for the
                // numbers its script and the levels' triggers name, which TRX
                // plays as they stand (tombpc.ts tr2RealTrack): both are
                // renumbered to the files, and the game's own music keeps
                // the names the original engine looked it up by.
                if (gameVersion === 2) {
                    let triggers = 0;
                    for (const file of result) {
                        if (!/\/(levels|cuts)\/[^/]+\.tr2$/i.test(file.path)) continue;
                        const level = readLevel(file.data);
                        if (level === null) continue;
                        const copy = file.data.slice();
                        const n = remapMusicTriggers(copy, level, tr2RealTrack);
                        if (n > 0) {
                            file.data = copy;
                            triggers += n;
                        }
                    }
                    result.push({ path: modPrefix + MUSIC_NOTE, data: new TextEncoder().encode(String(triggers)) });
                }
                // The original engine drew Lara from her levels.
                dressClassicGame(result, modDir, gameVersion);
                return result;
            }
        } catch (e) {
            console.warn('[TRX] TOMBPC.DAT processing failed, '
                + 'falling back to auto-generation:', e);
        }
    }

    // Auto-generate gameflow from template (fallback)
    const tplText = getTemplate(templateMod, 'gameflow.json5');
    const gameflow = parseJSON5(tplText) as AnyObj;
    const templateLevel = gameflow.levels[0];

    const levelPrefix = modPrefix + 'levels/';
    const levelFiles: string[] = [];
    let titleFile: string | null = null;
    for (let i = 0; i < result.length; i++) {
        if (result[i].path.indexOf(levelPrefix) === 0) {
            const filename = result[i].path.substring(levelPrefix.length);
            const baseName = filename.replace(/\.[^.]+$/, '').toLowerCase();
            if (baseName === 'title') {
                titleFile = filename;
            } else {
                levelFiles.push(filename);
            }
        }
    }
    levelFiles.sort();

    gameflow.title = {
        path: titleFile || levelFiles[0] || 'PLACEHOLDER',
        music_track: -1,
        sequence: [
            { type: 'exit_to_title' },
        ],
    };

    gameflow.levels = levelFiles.map(function(filename: string) {
        const entry: AnyObj = JSON.parse(JSON.stringify(templateLevel));
        entry.path = filename;
        entry.lara_outfit = defaultOutfit;
        if (HOME_LEVELS[filename.toLowerCase()]) {
            entry.type = 'gym';
        }
        return entry;
    });

    gameflow.engine = gameVersion;
    gameflow.extends = extendsBase;
    if (modTitle) {
        gameflow.name = modTitle;
    }
    const gameflowJson = JSON.stringify(gameflow, null, 4);
    const gameflowData = new TextEncoder().encode(gameflowJson);
    const gameflowPath = modPrefix + 'gameflow.json5';
    result.push({ path: gameflowPath, data: gameflowData });

    const strFiles = generateStrings(modDir, templateMod,
        levelFiles.map(function(f: string) {
            return { title: f.replace(/\.[^.]+$/, '') };
        }));
    result.push(...outfitFiles, ...strFiles);
    // The original engine drew Lara from her levels.
    dressClassicGame(result, modDir, gameVersion);

    return result;
}

// An outfit of the meshes the level itself gives Lara. A game's outfits file
// replaces the shipped one, so this writes the shipped one as the TRX the
// converter targets has it, plus this outfit, built like the game's classic
// outfit: the braid and guns of TRX's own objects, on Lara's level meshes.
export function injectLevelDefaultOutfit(modDir: string, gameVersion: number): MappedFile[] {
    const outfits = parseJSON5(getCfgFile('outfits.json5')) as AnyObj;
    const classic = outfits.outfits && outfits.outfits[`tr${gameVersion}_classic`];
    if (!classic || outfits.outfits.level_default) return [];
    const own: AnyObj = JSON.parse(JSON.stringify(classic));
    own.name_gs = 'dynamic/enums/lara_outfit/level_default';
    own.mesh_object = 'lara';
    // Lara's level object has no combat face or holster-less thighs of its
    // own, and no extra outfits to turn into.
    own.combat_face_offset = -1;
    delete own.no_holster_offsets;
    delete own.extra_outfits;
    delete own.speech_faces;
    outfits.outfits.level_default = own;
    return [{
        path: 'games/' + modDir + '/outfits.json5',
        data: new TextEncoder().encode(JSON.stringify(outfits, null, 4)),
    }];
}

// The name the settings show for that outfit, in the game's own strings.
export function addOutfitLabel(files: MappedFile[], modDir: string): void {
    const path = 'games/' + modDir + '/strings.json5';
    let file = files.find((f) => f.path === path);
    let strings: AnyObj = {};
    if (file) {
        try {
            strings = parseJSON5(new TextDecoder().decode(file.data)) as AnyObj;
        } catch {
            return;
        }
    } else {
        file = { path, data: new Uint8Array() };
        files.push(file);
    }
    strings.dynamic = strings.dynamic || {};
    strings.dynamic.enums = strings.dynamic.enums || {};
    strings.dynamic.enums.lara_outfit = strings.dynamic.enums.lara_outfit || {};
    strings.dynamic.enums.lara_outfit.level_default = 'Level Default';
    file.data = new TextEncoder().encode(JSON.stringify(strings, null, 4));
}

function generateStrings(
    modDir: string,
    templateMod: string,
    levelTitles: { title: string }[],
): MappedFile[] {
    const files: MappedFile[] = [];
    try {
        const entries = getTemplateFiles(templateMod);
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].indexOf('strings') === 0
                && entries[i].endsWith('.json5')) {
                const tplStrText = getTemplate(templateMod, entries[i]);
                const strObj = parseJSON5(tplStrText) as AnyObj;
                strObj.levels = levelTitles;
                const strJson = JSON.stringify(strObj, null, 4);
                const strData = new TextEncoder().encode(strJson);
                const strPath = 'games/' + modDir + '/' + entries[i];
                files.push({ path: strPath, data: strData });
            }
        }
    } catch { /* ignore */ }
    return files;
}
