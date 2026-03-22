import type { MappedFile } from './types.ts';
import { parseJSON5 } from './json5.ts';
import { parseTR2Script } from './tombpc.ts';
import { getTemplate, getTemplateFiles, getCfgFile, getCfgFiles } from '../templates/index.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

// Track numbers from TRX catalog_music.csv that are engine-hardcoded
// and must remain at their exact file position (not shifted by cdOffset).
const TR2_CATALOG_TRACKS = new Set([
    18, 19, 20, 21, 22, 23, 24, 43, 48, 49, 57, 59,
]);

const TR3_CATALOG_TRACKS = new Set([
    82, 83, 86, 89, 90, 95, 96, 98,
    107, 108, 109, 110, 112, 113, 114, 115, 116, 117, 118, 119,
    122,
]);

export function setupCustomGameflow(
    mappedFiles: MappedFile[],
    modDir: string,
    templateMod: string,
    useOutfitImport: boolean,
    modTitle: string = '',
): MappedFile[] {
    const result = mappedFiles.slice();
    const modPrefix = 'games/' + modDir + '/';
    const extendsBase = templateMod.replace('-level', '');
    const defaultOutfit = useOutfitImport
        ? 'level_default'
        : templateMod.replace('-level', '_classic');

    const outfitFiles: MappedFile[] = [];
    if (useOutfitImport) {
        outfitFiles.push(...injectLevelDefaultOutfit(modDir, templateMod));
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
        let gfText = new TextDecoder().decode(gfEntry.data);

        if (gfText.indexOf('"PLACEHOLDER"') !== -1) {
            let fullGfData: Uint8Array | null = null;
            const fullGfPath = modPrefix + '_meta/fullgameflow.json5';
            for (let fi = 0; fi < result.length; fi++) {
                if (result[fi].path === fullGfPath) {
                    fullGfData = result[fi].data;
                    break;
                }
            }
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
                levels[li].lara_outfit = 'tr2_classic';
                gfDirty = true;
            }
            if (levels[li].injections) {
                const inj: string[] = levels[li].injections;
                for (let ii = 0; ii < inj.length; ii++) {
                    const stripped = inj[ii].split('/').pop()!;
                    if (stripped !== inj[ii]) {
                        inj[ii] = stripped;
                        gfDirty = true;
                    }
                }
            }
        }
        if (gameflow.injections) {
            for (let ii = 0; ii < gameflow.injections.length; ii++) {
                const stripped = gameflow.injections[ii].split('/').pop()!;
                if (stripped !== gameflow.injections[ii]) {
                    gameflow.injections[ii] = stripped;
                    gfDirty = true;
                }
            }
        }
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
        return result;
    }

    if (scriptEntry
        && (templateMod === 'tr2-level' || templateMod === 'tr3-level')) {
        try {
            const scriptInfo = parseTR2Script(scriptEntry.data);
            if (scriptInfo && scriptInfo.filenames.length > 1) {
                const tplText = getTemplate(templateMod, 'gameflow.json5');
                const gameflow = parseJSON5(tplText) as AnyObj;
                const templateLevel = gameflow.levels[0];

                const levelPrefix = modPrefix + 'levels/';
                let uploadedTitle: string | null = null;
                for (let i = 0; i < result.length; i++) {
                    if (result[i].path.indexOf(levelPrefix) === 0) {
                        const bn = result[i].path
                            .substring(levelPrefix.length)
                            .replace(/\.[^.]+$/, '').toLowerCase();
                        if (bn === 'title') {
                            uploadedTitle = result[i].path
                                .substring(levelPrefix.length);
                        }
                    }
                }

                const scriptTitle = scriptInfo.filenames[0]
                    .replace(/\\/g, '/').split('/').pop()!
                    .toLowerCase();
                gameflow.title = {
                    path: uploadedTitle || scriptTitle,
                    music_track: scriptInfo.titleSoundId,
                    sequence: [{ type: 'exit_to_title' }],
                };

                gameflow.levels = [];
                const titleEntries: { title: string }[] = [];
                for (let i = 1; i < scriptInfo.filenames.length; i++) {
                    const base = scriptInfo.filenames[i]
                        .replace(/\\/g, '/').split('/').pop()!
                        .toLowerCase();
                    const entry: AnyObj = JSON.parse(
                        JSON.stringify(templateLevel));
                    entry.path = base;
                    entry.lara_outfit = defaultOutfit;
                    entry.music_track = scriptInfo.musicTracks[i];
                    if (scriptInfo.sequences[i]) {
                        entry.sequence = scriptInfo.sequences[i];
                    }
                    gameflow.levels.push(entry);

                    const title =
                        (i < scriptInfo.levelTitles.length
                         && scriptInfo.levelTitles[i])
                            ? scriptInfo.levelTitles[i]
                            : base.replace(/\.[^.]+$/, '');
                    titleEntries.push({ title: title });
                }

                if (gameflow.levels.length > 0) {
                    const firstLvl = gameflow.levels[0];
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
                            templateMod === 'tr3-level'
                                ? [
                                    { type: 'give_item',
                                      object_id: 'small_medipack' },
                                    { type: 'give_item',
                                      object_id: 'large_medipack' },
                                    { type: 'give_item',
                                      object_id: 'flare',
                                      quantity: 2 },
                                ]
                                : [
                                    { type: 'give_item',
                                      object_id: 'shotgun' },
                                    { type: 'give_item',
                                      object_id: 'small_medipack' },
                                    { type: 'give_item',
                                      object_id: 'large_medipack' },
                                    { type: 'give_item',
                                      object_id: 'flare',
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

                if (scriptInfo.cdOffset !== 0) {
                    const mPrefix = modPrefix + 'music/';
                    const catalogTracks = templateMod === 'tr3-level'
                        ? TR3_CATALOG_TRACKS : TR2_CATALOG_TRACKS;

                    const sourceNums = new Set<number>();
                    for (let i = 0; i < result.length; i++) {
                        const mp = result[i].path;
                        if (mp.indexOf(mPrefix) !== 0) continue;
                        const fn = mp.substring(mPrefix.length);
                        const m = fn.match(/^(\d+)(\..*)/);
                        if (m) sourceNums.add(parseInt(m[1]));
                    }

                    const catalogInSource = new Set<number>();
                    sourceNums.forEach(function(n) {
                        if (catalogTracks.has(n))
                            catalogInSource.add(n);
                    });

                    let i = 0;
                    while (i < result.length) {
                        const mp = result[i].path;
                        if (mp.indexOf(mPrefix) !== 0) { i++; continue; }
                        const fn = mp.substring(mPrefix.length);
                        const m = fn.match(/^(\d+)(\..*)/);
                        if (!m) { i++; continue; }
                        const srcNum = parseInt(m[1]);
                        const dstNum = srcNum + scriptInfo.cdOffset;

                        if (catalogInSource.has(srcNum)) {
                            i++;
                        } else if (catalogInSource.has(dstNum)) {
                            result.splice(i, 1);
                        } else {
                            result[i].path = mPrefix + dstNum + m[2];
                            i++;
                        }
                    }
                }
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
        return entry;
    });

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

    return result;
}

function injectLevelDefaultOutfit(modDir: string, templateMod: string): MappedFile[] {
    const files: MappedFile[] = [];

    const isTR1 = templateMod === 'tr1-level';
    let braid: AnyObj;
    if (isTR1) {
        braid = {
            mode: 'BRAID_MODE_TR1_FULL',
            mesh_offset: 10,
            gold_offset: 16,
            hair_pos: { x: 0, y: 20, z: -45 },
        };
    } else {
        braid = {
            mesh_offset: 22,
            gold_offset: 28,
            hair_pos: { x: 0, y: -23, z: -55 },
        };
    }
    const gunMap = isTR1 ? 0 : (templateMod === 'tr3-level' ? 3 : 2);

    try {
        const outfitsText = getCfgFile('outfits.json5');
        const outfits = parseJSON5(outfitsText) as AnyObj;
        if (outfits.outfits && !outfits.outfits.level_default) {
            outfits.outfits.level_default = {
                name_gs: 'dynamic/enums/lara_outfit/level_default',
                mesh_object: 'O_LARA',
                gun_map: gunMap,
                combat_face_offset: -1,
                supports_sunglasses: false,
                braid: braid,
            };
            files.push({
                path: 'games/' + modDir + '/outfits.json5',
                data: new TextEncoder().encode(
                    JSON.stringify(outfits, null, 4)),
            });
        }
    } catch (e) {
        console.warn('[TRX] Failed to inject level_default outfit:', e);
    }

    try {
        const cfgEntries = getCfgFiles();
        for (let i = 0; i < cfgEntries.length; i++) {
            if (cfgEntries[i].indexOf('base_strings') !== 0
                || !cfgEntries[i].endsWith('.json5')) continue;
            const strText = getCfgFile(cfgEntries[i]);
            const strObj = parseJSON5(strText) as AnyObj;
            if (strObj.dynamic && strObj.dynamic.enums
                && strObj.dynamic.enums.lara_outfit
                && !strObj.dynamic.enums.lara_outfit.level_default) {
                strObj.dynamic.enums.lara_outfit.level_default
                    = 'Level Default';
                files.push({
                    path: 'games/' + modDir + '/' + cfgEntries[i],
                    data: new TextEncoder().encode(
                        JSON.stringify(strObj, null, 4)),
                });
            }
        }
    } catch (e) {
        console.warn('[TRX] Failed to inject level_default string:', e);
    }

    return files;
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
    } catch (_e) { /* ignore */ }
    return files;
}
