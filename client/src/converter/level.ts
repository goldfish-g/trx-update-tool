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

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export type LevelObject = {
    id: number;
    meshCount: number;
    /** Index of its first mesh in the mesh pointer table. */
    firstMesh: number;
};

/** Where a level keeps its objects' meshes, bones and records, for adding an object. */
export type LevelObjects = {
    meshPointers: number[];
    /** Byte offsets of each table's count, and of the byte after its last record. */
    meshPointersAt: number;
    meshPointersEnd: number;
    boneCount: number;
    bonesAt: number;
    bonesEnd: number;
    objectsAt: number;
    objectsEnd: number;
    objects: LevelObject[];
};

/** The level's object records and the tables around them, or null for a file it cannot read. */
export function readLevelObjects(data: Uint8Array): LevelObjects | null {
    try {
        const r = new Reader(data);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const game = gameOf(r.u32());
        if (game === null) return null;
        if (game === 1) {
            r.arr32(TEXTURE_PAGE);
        } else {
            r.skip(1792);
            r.arr32(TEXTURE_PAGE * 3);
        }
        r.skip(4);
        const rooms = r.u16();
        for (let i = 0; i < rooms; i++) {
            r.skip(16);
            r.arr32(2);
            r.arr16(32);
            const sizeZ = r.s16();
            const sizeX = r.s16();
            r.skip(sizeZ * sizeX * 8);
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
        r.arr32(2); // floor data
        r.arr32(2); // object meshes

        const meshPointersAt = r.at;
        const pointerCount = r.s32();
        const meshPointers: number[] = [];
        for (let i = 0; i < pointerCount; i++) meshPointers.push(r.u32());
        const meshPointersEnd = r.at;

        r.arr32(32); // animations
        r.arr32(6); // animation changes
        r.arr32(8); // animation ranges
        r.arr32(2); // animation commands
        const bonesAt = r.at;
        const boneCount = r.arr32(4);
        const bonesEnd = r.at;
        r.arr32(2); // animation frames

        const objectsAt = r.at;
        const objectCount = r.s32();
        const objects: LevelObject[] = [];
        for (let i = 0; i < objectCount; i++) {
            const at = r.at;
            r.skip(18);
            objects.push({ id: view.getUint32(at, true), meshCount: view.getUint16(at + 4, true), firstMesh: view.getUint16(at + 6, true) });
        }
        return {
            meshPointers,
            meshPointersAt,
            meshPointersEnd,
            boneCount,
            bonesAt,
            bonesEnd,
            objectsAt,
            objectsEnd: r.at,
            objects,
        };
    } catch {
        return null;
    }
}

/**
 * The level with one more object, whose meshes are meshes the level already
 * has, by their places in the mesh pointer table. It shares their geometry,
 * so nothing is copied but the pointers; it has no animations, and bones
 * that offset nothing.
 */
export function addMeshObject(data: Uint8Array, level: LevelObjects, id: number, meshes: number[]): Uint8Array {
    if (meshes.length === 0 || level.meshPointers.length + meshes.length > 0xffff) throw new Error('too many meshes');
    const pointers = new Uint8Array(meshes.length * 4);
    const pointerView = new DataView(pointers.buffer);
    meshes.forEach((mesh, i) => pointerView.setUint32(i * 4, level.meshPointers[mesh], true));
    const bones = new Uint8Array((meshes.length - 1) * 16);
    const record = new Uint8Array(18);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, id, true);
    recordView.setUint16(4, meshes.length, true);
    recordView.setUint16(6, level.meshPointers.length, true);
    recordView.setUint32(8, level.boneCount, true);
    recordView.setUint32(12, 0, true);
    recordView.setUint16(16, 0xffff, true);

    const out = new Uint8Array(data.length + pointers.length + bones.length + record.length);
    let at = 0;
    const put = (part: Uint8Array) => {
        out.set(part, at);
        at += part.length;
    };
    put(data.subarray(0, level.meshPointersEnd));
    put(pointers);
    put(data.subarray(level.meshPointersEnd, level.bonesEnd));
    put(bones);
    put(data.subarray(level.bonesEnd, level.objectsEnd));
    put(record);
    put(data.subarray(level.objectsEnd));

    const view = new DataView(out.buffer);
    view.setInt32(level.meshPointersAt, level.meshPointers.length + meshes.length, true);
    view.setInt32(level.bonesAt + pointers.length, level.boneCount + (meshes.length - 1) * 4, true);
    view.setInt32(level.objectsAt + pointers.length + bones.length, level.objects.length + 1, true);
    return out;
}
