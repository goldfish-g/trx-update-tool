// Reads what the converter needs from a TR1, TR2 or TR3 level file: its
// floor data, where the trigger commands sit, and its items. The layout
// follows the probes in TRX's src/trx/game/level/format/format_tr*.c.

export type LevelItem = {
    objectId: number;
    room: number;
    x: number;
    y: number;
    z: number;
    angle: number;
    flags: number;
};

export type LevelData = {
    gameVersion: 1 | 2 | 3;
    /** Byte offset of the first floor data word. */
    floorDataOffset: number;
    floorDataCount: number;
    /** Where each sector's floor data starts. */
    sectorFloorData: number[];
    items: LevelItem[];
};

const TEXTURE_PAGE = 256 * 256;

class Reader {
    at = 0;
    readonly data: Uint8Array;
    private readonly view: DataView;

    constructor(data: Uint8Array) {
        this.data = data;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    private need(n: number): void {
        if (n < 0 || this.at + n > this.data.length) throw new Error('level file ends early');
    }

    skip(n: number): void {
        this.need(n);
        this.at += n;
    }

    u16(): number {
        this.need(2);
        const v = this.view.getUint16(this.at, true);
        this.at += 2;
        return v;
    }

    s16(): number {
        this.need(2);
        const v = this.view.getInt16(this.at, true);
        this.at += 2;
        return v;
    }

    s32(): number {
        this.need(4);
        const v = this.view.getInt32(this.at, true);
        this.at += 4;
        return v;
    }

    u32(): number {
        this.need(4);
        const v = this.view.getUint32(this.at, true);
        this.at += 4;
        return v;
    }

    /** A count, as a 32-bit integer, followed by that many records. */
    arr32(size: number): number {
        const n = this.s32();
        this.skip(n * size);
        return n;
    }

    /** A count, as a 16-bit integer, followed by that many records. */
    arr16(size: number): number {
        const n = this.u16();
        this.skip(n * size);
        return n;
    }
}

function gameOf(version: number): 1 | 2 | 3 | null {
    if (version === 0x20) return 1;
    if (version === 45) return 2;
    if (version === 0xff080038 || version === 0xff180038 || version === 0xff180034) return 3;
    return null;
}

/** The game a level file was made for, from the version it starts with. */
export function levelFileGame(data: Uint8Array): 1 | 2 | 3 | null {
    if (data.length < 4) return null;
    return gameOf(new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true));
}

/** The level's floor data and items, or null for a file it cannot read. */
export function readLevel(data: Uint8Array): LevelData | null {
    try {
        const r = new Reader(data);
        const game = gameOf(r.u32());
        if (game === null) return null;

        if (game === 1) {
            r.arr32(TEXTURE_PAGE);
        } else {
            r.skip(1792); // palettes
            r.arr32(TEXTURE_PAGE * 3);
        }
        r.skip(4);

        const sectorFloorData: number[] = [];
        const rooms = r.u16();
        for (let i = 0; i < rooms; i++) {
            r.skip(16);
            r.arr32(2); // mesh data
            r.arr16(32); // portals
            const sizeZ = r.s16();
            const sizeX = r.s16();
            for (let s = 0; s < sizeZ * sizeX; s++) {
                sectorFloorData.push(r.u16());
                r.skip(6);
            }
            if (game === 1) {
                r.skip(2);
                r.arr16(18);
                r.arr16(18);
                r.skip(4);
            } else if (game === 2) {
                r.skip(6);
                r.arr16(24);
                r.arr16(20);
                r.skip(4);
            } else {
                r.skip(4);
                r.arr16(24);
                r.arr16(20);
                r.skip(7);
            }
        }

        const floorDataCount = r.s32();
        const floorDataOffset = r.at;
        r.skip(floorDataCount * 2);

        r.arr32(2); // object meshes
        r.arr32(4); // object mesh pointers
        r.arr32(32); // animations
        r.arr32(6); // animation changes
        r.arr32(8); // animation ranges
        r.arr32(2); // animation commands
        r.arr32(4); // animation bones
        r.arr32(2); // animation frames
        r.arr32(18); // objects
        r.arr32(32); // static objects
        if (game !== 3) r.arr32(20); // object textures
        r.arr32(16); // sprite textures
        r.arr32(8); // sprite sequences
        r.arr32(16); // cameras
        r.arr32(16); // sound sources
        const boxes = r.s32();
        r.skip(boxes * (game === 1 ? 20 : 8));
        r.arr32(2); // overlaps
        r.skip(boxes * (game === 1 ? 12 : 20)); // zones
        r.arr32(2); // animated textures
        if (game === 3) r.arr32(20); // object textures

        const items: LevelItem[] = [];
        const itemCount = r.s32();
        for (let i = 0; i < itemCount; i++) {
            const objectId = r.s16();
            const room = r.s16();
            const x = r.s32();
            const y = r.s32();
            const z = r.s32();
            const angle = r.s16();
            r.skip(game === 1 ? 2 : 4);
            const flags = r.u16();
            items.push({ objectId, room, x, y, z, angle, flags });
        }
        return { gameVersion: game, floorDataOffset, floorDataCount, sectorFloorData, items };
    } catch {
        return null;
    }
}

const TO_CAMERA = 1;
const TO_FINISH = 7;
const TO_FLYBY = 12;
const FT_DOOR = 1;
const FT_TILT = 2;
const FT_ROOF = 3;
const FT_TRIGGER = 4;
const TT_SWITCH = 2;
const TT_KEY = 3;
const TT_PICKUP = 4;

/**
 * Sets the parameter of every end-level trigger command to 0, so the game
 * flow says which level comes next, as it did before TRX 1.11 gave the
 * parameter a meaning. Returns how many it changed.
 */
export function clearEndLevelParameters(data: Uint8Array, level: LevelData): number {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const word = (i: number) => view.getUint16(level.floorDataOffset + i * 2, true);
    const done = new Set<number>();
    let changed = 0;
    for (const start of new Set(level.sectorFloorData)) {
        if (start === 0 || start >= level.floorDataCount) continue;
        let i = start;
        let entry = 0;
        do {
            if (i >= level.floorDataCount) break;
            entry = word(i++);
            const type = entry & 0x1f;
            if (type === FT_DOOR || type === FT_TILT || type === FT_ROOF || (type >= 7 && type <= 18)) {
                i++;
            } else if (type === FT_TRIGGER) {
                i++; // setup: timer, one shot, mask
                const triggerType = (entry & 0x7f00) >> 8;
                if (triggerType === TT_SWITCH || triggerType === TT_KEY || triggerType === TT_PICKUP) {
                    if (word(i++) & 0x8000) continue;
                }
                let command = 0;
                do {
                    if (i >= level.floorDataCount) break;
                    const at = i;
                    command = word(i++);
                    const kind = (command & 0x7c00) >> 10;
                    if (kind === TO_CAMERA || kind === TO_FLYBY) {
                        command = word(i++);
                    } else if (kind === TO_FINISH && (command & 0x3ff) !== 0 && !done.has(at)) {
                        view.setUint16(level.floorDataOffset + at * 2, command & ~0x3ff, true);
                        done.add(at);
                        changed++;
                    }
                } while (!(command & 0x8000));
            }
        } while (!(entry & 0x8000));
    }
    return changed;
}
