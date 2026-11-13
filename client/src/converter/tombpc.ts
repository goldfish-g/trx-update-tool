import { STATS_BACKGROUND } from './objects.ts';
import type { ScriptInfo } from './types.ts';

const GFE = {
    PICTURE:          0x0000,
    LIST_START:       0x0001,
    LIST_END:         0x0002,
    PLAY_FMV:         0x0003,
    START_LEVEL:      0x0004,
    CUTSCENE:         0x0005,
    LEVEL_COMPLETE:   0x0006,
    DEMO_PLAY:        0x0007,
    JUMP_TO_SEQ:      0x0008,
    END_SEQ:          0x0009,
    SET_TRACK:        0x000A,
    SUNSET:           0x000B,
    LOADING_PIC:      0x000C,
    DEADLY_WATER:     0x000D,
    REMOVE_WEAPONS:   0x000E,
    GAME_COMPLETE:    0x000F,
    CUT_ANGLE:        0x0010,
    NO_FLOOR:         0x0011,
    ADD_TO_INV:       0x0012,
    START_ANIM:       0x0013,
    NUM_SECRETS:      0x0014,
    KILL_TO_COMPLETE: 0x0015,
    REMOVE_AMMO:      0x0016,
} as const;

const GFE_HAS_ARG: Record<number, number> = {
    [GFE.PICTURE]:     1,
    [GFE.PLAY_FMV]:    1,
    [GFE.START_LEVEL]: 1,
    [GFE.CUTSCENE]:    1,
    [GFE.DEMO_PLAY]:   1,
    [GFE.JUMP_TO_SEQ]: 1,
    [GFE.SET_TRACK]:   1,
    [GFE.LOADING_PIC]: 1,
    [GFE.CUT_ANGLE]:   1,
    [GFE.NO_FLOOR]:    1,
    [GFE.ADD_TO_INV]:  1,
    [GFE.START_ANIM]:  1,
    [GFE.NUM_SECRETS]: 1,
};

// The objects a script gives by number, under the names TRX knows them by.
// The TR2 order was checked against the retail script and TRX's gameflow,
// level by level; TR3 adds the rocket launcher, so its ammo and the rest
// sit two places further on.
const TR2_INV_KEYS: string[] = [
    'pistols_item',           // 0
    'shotgun_item',           // 1
    'autos_item',             // 2
    'uzis_item',              // 3
    'harpoon_gun_item',       // 4
    'm16_item',               // 5
    'grenade_gun_item',       // 6
    'pistols_ammo_item',      // 7
    'shotgun_ammo_item',      // 8
    'autos_ammo_item',        // 9
    'uzis_ammo_item',         // 10
    'harpoon_gun_ammo_item',  // 11
    'm16_ammo_item',          // 12
    'grenade_ammo_item',      // 13
    'flare_item',             // 14
    'small_medipack_item',    // 15
    'large_medipack_item',    // 16
    'pickup_item_1',          // 17
    'pickup_item_2',          // 18
    'puzzle_item_1',          // 19
    'puzzle_item_2',          // 20
    'puzzle_item_3',          // 21
    'puzzle_item_4',          // 22
    'key_item_1',             // 23
    'key_item_2',             // 24
    'key_item_3',             // 25
    'key_item_4',             // 26
];

const TR3_INV_KEYS: string[] = [
    'pistols_item',           // 0
    'shotgun_item',           // 1
    'autos_item',             // 2, the Desert Eagle
    'uzis_item',              // 3
    'harpoon_gun_item',       // 4
    'm16_item',               // 5, the MP5
    'rocket_gun_item',        // 6
    'grenade_gun_item',       // 7
    'pistols_ammo_item',      // 8
    'shotgun_ammo_item',      // 9
    'autos_ammo_item',        // 10
    'uzis_ammo_item',         // 11
    'harpoon_gun_ammo_item',  // 12
    'm16_ammo_item',          // 13
    'rocket_ammo_item',       // 14
    'grenade_ammo_item',      // 15
    'flare_item',             // 16
    'small_medipack_item',    // 17
    'large_medipack_item',    // 18
    'pickup_item_1',          // 19
    'pickup_item_2',          // 20
    'puzzle_item_1',          // 21
    'puzzle_item_2',          // 22
    'puzzle_item_3',          // 23
    'puzzle_item_4',          // 24
    'key_item_1',             // 25
    'key_item_2',             // 26
    'key_item_3',             // 27
    'key_item_4',             // 28
];

interface Opcode {
    op: number;
    arg: number;
}

interface TranslatedSequence {
    sequence: Record<string, unknown>[];
    music_track: number;
}

export function parseTR2Script(rawData: Uint8Array, gameVersion: number): ScriptInfo | null {
    const invKeys = gameVersion === 3 ? TR3_INV_KEYS : TR2_INV_KEYS;
    try {
        const data = new Uint8Array(rawData);
        const view = new DataView(data.buffer);

        const version = view.getUint32(0, true);
        if (version !== 3) return null;
        const optSize = view.getUint16(260, true);
        const optStart = 262;

        const numLevels = view.getUint16(optStart + 64, true);
        const numPictures = view.getUint16(optStart + 66, true);
        const numTitles = view.getUint16(optStart + 68, true);
        const numFMVs = view.getUint16(optStart + 70, true);
        const numCutscenes = view.getUint16(optStart + 72, true);
        const titleSoundId = view.getUint16(optStart + 76, true);
        const cypher = data[optStart + 120];
        if (numLevels < 2 || numLevels > 100) return null;

        function readBlock(pos: number, count: number): { strings: string[]; end: number } {
            const offsets: number[] = [];
            for (let i = 0; i < count; i++)
                offsets.push(view.getUint16(pos + i * 2, true));
            pos += count * 2;
            const dlen = view.getUint16(pos, true); pos += 2;
            const strings: string[] = [];
            for (let i = 0; i < count; i++) {
                let j = pos + offsets[i];
                let s = '';
                while (j < pos + dlen) {
                    const ch = data[j] ^ cypher;
                    j++;
                    if (ch === 0) break;
                    s += String.fromCharCode(ch);
                }
                strings.push(s);
            }
            return { strings: strings, end: pos + dlen };
        }

        // The string tables follow in a fixed order: level names, pictures,
        // titles, FMVs, level files and cutscenes.
        const titleBlock = readBlock(optStart + optSize, numLevels);
        const levelTitles = titleBlock.strings;
        const pictureBlock = readBlock(titleBlock.end, numPictures);
        const titlesBlock = readBlock(pictureBlock.end, numTitles);
        const fmvBlock = readBlock(titlesBlock.end, numFMVs);
        const fileBlock = readBlock(fmvBlock.end, numLevels);
        const cutsceneBlock = readBlock(fileBlock.end, numCutscenes);
        const filenames = fileBlock.strings;
        let scriptPos = cutsceneBlock.end;

        const scriptOffsets: number[] = [];
        for (let i = 0; i <= numLevels; i++) {
            scriptOffsets.push(
                view.getUint16(scriptPos + i * 2, true));
        }
        scriptPos += (numLevels + 1) * 2;
        const scriptSize = view.getUint16(scriptPos, true);
        scriptPos += 2;
        const scriptBase = scriptPos;

        function readOpcodes(seqIdx: number): Opcode[] {
            const sStart = scriptBase + scriptOffsets[seqIdx];
            const sEnd = (seqIdx + 1 < scriptOffsets.length)
                ? scriptBase + scriptOffsets[seqIdx + 1]
                : scriptBase + scriptSize;
            const ops: Opcode[] = [];
            for (let p = sStart; p + 1 < sEnd; ) {
                const op = view.getUint16(p, true); p += 2;
                if (op === GFE.END_SEQ) break;
                let arg = -1;
                if (GFE_HAS_ARG[op]) {
                    arg = (p + 1 < sEnd) ? view.getUint16(p, true) : -1;
                    p += 2;
                }
                ops.push({ op: op, arg: arg });
            }
            return ops;
        }

        const cutsceneTracks: number[] = [];
        for (let i = 0; i < numCutscenes; i++) cutsceneTracks.push(-1);

        function translateSequence(ops: Opcode[]): TranslatedSequence {
            const pre: Record<string, unknown>[] = [];
            const post: Record<string, unknown>[] = [];
            let musicTrack = -1;
            let lastTrack = -1;
            let seenLevel = false;
            let isGameComplete = false;

            for (let i = 0; i < ops.length; i++) {
                const op = ops[i].op;
                const arg = ops[i].arg;
                const target = seenLevel ? post : pre;

                switch (op) {
                case GFE.SET_TRACK:
                    // A track set after the level starts belongs to what
                    // follows it, such as a cutscene, not to the level.
                    if (!seenLevel) musicTrack = arg;
                    lastTrack = arg;
                    break;

                case GFE.START_LEVEL:
                    seenLevel = true;
                    break;

                case GFE.PLAY_FMV:
                    target.push({ type: 'play_fmv', fmv_id: arg });
                    break;

                case GFE.CUTSCENE:
                    target.push({ type: 'play_cutscene', cutscene_id: arg });
                    if (arg >= 0 && arg < numCutscenes) cutsceneTracks[arg] = lastTrack;
                    break;

                case GFE.LEVEL_COMPLETE:
                    post.push({ type: 'play_music', music_track: 41 });
                    post.push({ type: 'level_stats' });
                    post.push({ type: 'level_complete' });
                    break;

                case GFE.GAME_COMPLETE:
                    isGameComplete = true;
                    post.push({ type: 'total_stats', background_path: STATS_BACKGROUND[gameVersion] });
                    break;

                case GFE.SUNSET:
                    target.push({ type: 'enable_sunset' });
                    break;

                case GFE.REMOVE_WEAPONS:
                    target.push({ type: 'remove_weapons' });
                    break;

                case GFE.REMOVE_AMMO:
                    target.push({ type: 'remove_ammo' });
                    break;

                case GFE.NO_FLOOR:
                    target.push({ type: 'disable_floor', height: arg });
                    break;

                case GFE.START_ANIM:
                    target.push({ type: 'set_lara_start_anim', anim: arg });
                    break;

                case GFE.ADD_TO_INV:
                    if (arg >= 0) {
                        const itemIdx = arg >= 1000 ? arg - 1000 : arg;
                        const invType = arg >= 1000 ? 'give_item' : 'add_secret_reward';
                        const objKey = invKeys[itemIdx];
                        if (objKey) {
                            target.push({ type: invType, object_id: objKey });
                        }
                    }
                    break;
                }
            }

            const sequence: Record<string, unknown>[] = pre.slice();
            sequence.push({ type: 'loop_game' });
            for (let i = 0; i < post.length; i++) {
                sequence.push(post[i]);
            }

            if (!isGameComplete) {
                let hasComplete = false;
                for (let i = 0; i < post.length; i++) {
                    if (post[i].type === 'level_complete') {
                        hasComplete = true;
                        break;
                    }
                }
                if (!hasComplete) {
                    sequence.push({ type: 'level_stats' });
                    sequence.push({ type: 'level_complete' });
                }
            }

            return { sequence: sequence, music_track: musicTrack };
        }

        const musicTracks: number[] = [];
        const sequences: (Record<string, unknown>[] | null)[] = [];
        for (let i = 0; i < numLevels; i++) {
            musicTracks.push(-1);
            sequences.push(null);
        }

        for (let seq = 0; seq <= numLevels; seq++) {
            if (seq === numLevels
                && scriptOffsets[numLevels] >= scriptSize) {
                continue;
            }

            const ops = readOpcodes(seq);
            const result = translateSequence(ops);

            let levelTarget = -1;
            for (let i = 0; i < ops.length; i++) {
                if (ops[i].op === GFE.START_LEVEL) {
                    levelTarget = ops[i].arg;
                    break;
                }
            }

            const idx = (levelTarget >= 0 && levelTarget < numLevels)
                ? levelTarget : seq;
            if (idx >= numLevels) continue;
            musicTracks[idx] = result.music_track;
            sequences[idx] = result.sequence;
        }

        return {
            filenames: filenames,
            levelTitles: levelTitles,
            musicTracks: musicTracks,
            sequences: sequences,
            titleSoundId: titleSoundId,
            titleFiles: titlesBlock.strings,
            fmvFiles: fmvBlock.strings,
            cutsceneFiles: cutsceneBlock.strings,
            cutsceneTracks: cutsceneTracks,
        };
    } catch {
        return null;
    }
}

/**
 * The music file tomb2.exe played for a track number its script or a
 * trigger gives (Music_GetRealTrack): the numbers skip 2, 19, 20 and 26, so
 * the title theme, 64, is 60.mp3. TR2X 1.2 dropped the shift ("music: remove
 * track shifting logic") and TRX plays the file a number names, giving TR2's
 * own levels injections that renumber their triggers.
 */
export function tr2RealTrack(track: number): number {
    if (track < 0) return track;
    const skipped = [2, 19, 20, 26];
    let result = 2;
    let idx = 0;
    for (let i = 2; i < track; i++) {
        if (idx < skipped.length && i === skipped[idx]) idx++;
        else result++;
    }
    return result;
}
