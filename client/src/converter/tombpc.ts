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

const TR2_INV_KEYS: string[] = [
    'pistols',                // 0
    'autos',                  // 1
    'uzis',                   // 2
    'shotgun',                // 3
    'harpoon_gun',            // 4
    'm16',                    // 5
    'grenade_launcher',       // 6
    'pistols_ammo',           // 7
    'autos_ammo',             // 8
    'uzis_ammo',              // 9
    'shotgun_ammo',           // 10
    'harpoon_gun_ammo',       // 11
    'm16_ammo',               // 12
    'grenade_launcher_ammo',  // 13
    'flare',                  // 14
    'small_medipack',         // 15
    'large_medipack',         // 16
    'pickup_1',               // 17
    'pickup_2',               // 18
    'puzzle_1',               // 19
    'puzzle_2',               // 20
    'puzzle_3',               // 21
    'puzzle_4',               // 22
    'key_1',                  // 23
    'key_2',                  // 24
    'key_3',                  // 25
    'key_4',                  // 26
];

interface Opcode {
    op: number;
    arg: number;
}

interface TranslatedSequence {
    sequence: Record<string, unknown>[];
    music_track: number;
}

export function parseTR2Script(rawData: Uint8Array): ScriptInfo | null {
    try {
        const data = new Uint8Array(rawData);
        const view = new DataView(data.buffer);

        const version = view.getUint32(0, true);
        if (version !== 3) return null;
        const optSize = view.getUint16(260, true);
        const optStart = 262;

        const numLevels = view.getUint16(optStart + 64, true);
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

        let pos = optStart + optSize;
        const titleBlock = readBlock(pos, numLevels);
        const levelTitles = titleBlock.strings;

        let filenames: string[] | null = null;
        let fnEndPos = 0;
        for (let sp = titleBlock.end;
             sp < data.length - numLevels * 2 - 4; sp++) {
            const first = view.getUint16(sp, true);
            if (first !== 0) continue;
            let ok = true;
            for (let k = 1; k < numLevels; k++) {
                if (view.getUint16(sp + k * 2, true)
                    <= view.getUint16(sp + (k - 1) * 2, true)) {
                    ok = false; break;
                }
            }
            if (!ok) continue;
            try {
                const blk = readBlock(sp, numLevels);
                let allValid = true;
                for (let k = 0; k < blk.strings.length; k++) {
                    const s = blk.strings[k];
                    const sl = s.toLowerCase();
                    if (sl.indexOf('.tr2') < 0
                        && sl.indexOf('.phd') < 0
                        && sl.indexOf('.tub') < 0
                        && sl.indexOf('.psx') < 0) {
                        allValid = false; break;
                    }
                    for (let c = 0; c < s.length; c++) {
                        const cc = s.charCodeAt(c);
                        if (cc < 32 || cc > 126) {
                            allValid = false; break;
                        }
                    }
                    if (!allValid) break;
                }
                if (allValid) {
                    filenames = blk.strings;
                    fnEndPos = blk.end;
                    break;
                }
            } catch (_e) { /* ignore */ }
        }
        if (!filenames) return null;

        let scriptPos = fnEndPos;
        if (numCutscenes > 0) {
            try {
                const cutBlk = readBlock(scriptPos, numCutscenes);
                scriptPos = cutBlk.end;
            } catch (_e) { /* ignore */ }
        }

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

        function translateSequence(ops: Opcode[]): TranslatedSequence {
            const pre: Record<string, unknown>[] = [];
            const post: Record<string, unknown>[] = [];
            let musicTrack = -1;
            let seenLevel = false;
            let isGameComplete = false;

            for (let i = 0; i < ops.length; i++) {
                const op = ops[i].op;
                const arg = ops[i].arg;
                const target = seenLevel ? post : pre;

                switch (op) {
                case GFE.SET_TRACK:
                    musicTrack = arg;
                    break;

                case GFE.START_LEVEL:
                    seenLevel = true;
                    break;

                case GFE.PLAY_FMV:
                    target.push({ type: 'play_fmv', fmv_id: arg });
                    break;

                case GFE.CUTSCENE:
                    target.push({ type: 'play_cutscene', cutscene_id: arg });
                    break;

                case GFE.LEVEL_COMPLETE:
                    post.push({ type: 'play_music', music_track: 41 });
                    post.push({ type: 'level_stats' });
                    post.push({ type: 'level_complete' });
                    break;

                case GFE.GAME_COMPLETE:
                    isGameComplete = true;
                    post.push({ type: 'total_stats' });
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
                        const objKey = TR2_INV_KEYS[itemIdx];
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

        for (let seq = 0; seq < numLevels; seq++) {
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
            musicTracks[idx] = result.music_track;
            sequences[idx] = result.sequence;
        }

        const cdOffset = titleSoundId > 0
            ? titleSoundId - 60 : 4;

        return {
            filenames: filenames,
            levelTitles: levelTitles,
            musicTracks: musicTracks,
            sequences: sequences,
            titleSoundId: titleSoundId,
            cdOffset: cdOffset,
        };
    } catch (_e) {
        return null;
    }
}
