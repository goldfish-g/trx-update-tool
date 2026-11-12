// Reads what the converter needs from a TR1, TR2 or TR3 level file: its
// floor data, where the trigger commands sit, and its items. The layout
// follows the probes in TRX's src/trx/game/level/format/format_tr*.c.

export type LevelItem = {
    /** Byte offset of its record, whose first field is its object id. */
    offset: number;
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
            const offset = r.at;
            const objectId = r.s16();
            const room = r.s16();
            const x = r.s32();
            const y = r.s32();
            const z = r.s32();
            const angle = r.s16();
            r.skip(game === 1 ? 2 : 4);
            const flags = r.u16();
            items.push({ offset, objectId, room, x, y, z, angle, flags });
        }
        return { gameVersion: game, floorDataOffset, floorDataCount, sectorFloorData, items };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Font
// ---------------------------------------------------------------------------

/** One sprite of a font, as its texture shows it. */
export type Glyph = {
    width: number;
    height: number;
    /** Where the sprite is drawn, from the cursor on the baseline. */
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    /** width × height pixels, red, green, blue and alpha; alpha is 0 or 255. */
    rgba: Uint8Array;
};

/** The slot of the font object in each game, in its level files and in TRX. */
export const ALPHABET_SLOT: Record<number, number> = { 1: 190, 2: 255, 3: 356 };

/** The part of a glyph that shows: where it starts in the sprite, and its size. */
export function glyphBounds(glyph: Glyph): { x: number; y: number; width: number; height: number } | null {
    let left = glyph.width;
    let top = glyph.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < glyph.height; y++) {
        for (let x = 0; x < glyph.width; x++) {
            if (!glyph.rgba[(y * glyph.width + x) * 4 + 3]) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
    }
    return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * What a glyph looks like, wherever it sits in its sprite and whatever
 * palette it was drawn through: the shape of its pixels, as
 * "<width>x<height>:<hash>", and their average colour. Null for an empty one.
 */
export function glyphFingerprint(glyph: Glyph): { shape: string; colour: [number, number, number] } | null {
    const bounds = glyphBounds(glyph);
    if (!bounds) return null;
    let hash = 0x811c9dc5;
    const mix = (byte: number) => {
        hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    };
    for (const ch of `${bounds.width}x${bounds.height}:`) mix(ch.charCodeAt(0));
    const sum = [0, 0, 0];
    let shown = 0;
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
        for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
            const o = (y * glyph.width + x) * 4;
            const on = glyph.rgba[o + 3] !== 0;
            mix(on ? 49 : 48);
            if (!on) continue;
            sum[0] += glyph.rgba[o];
            sum[1] += glyph.rgba[o + 1];
            sum[2] += glyph.rgba[o + 2];
            shown++;
        }
    }
    const hex = hash.toString(16).padStart(8, '0');
    return { shape: `${bounds.width}x${bounds.height}:${hex}`, colour: [0, 1, 2].map((k) => Math.round(sum[k] / shown)) as [number, number, number] };
}

/** The sprites of the level's font, or null for a file it cannot read or a level without one. */
export function readAlphabet(data: Uint8Array): { gameVersion: 1 | 2 | 3; glyphs: Glyph[] } | null {
    try {
        const r = new Reader(data);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const game = gameOf(r.u32());
        if (game === null) return null;
        if (game !== 1) r.skip(1792); // palettes
        const pageCount = r.s32();
        const pages8 = r.at;
        const pages16 = r.at + pageCount * TEXTURE_PAGE;
        r.skip(pageCount * TEXTURE_PAGE * (game === 1 ? 1 : 3));
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
        const spriteCount = r.s32();
        const sprites = r.at;
        r.skip(spriteCount * 16);
        let first = -1;
        let count = 0;
        const sequences = r.s32();
        for (let i = 0; i < sequences; i++) {
            const id = r.s32();
            const length = -r.s16();
            const offset = r.s16();
            if (id === ALPHABET_SLOT[game]) {
                first = offset;
                count = length;
            }
        }
        if (first < 0 || count <= 0 || first + count > spriteCount) return null;

        // TR1 levels colour their pages through the palette after the items.
        let palette = 0;
        if (game === 1) {
            r.arr32(16); // cameras
            r.arr32(16); // sound sources
            const boxes = r.s32();
            r.skip(boxes * 20);
            r.arr32(2); // overlaps
            r.skip(boxes * 12); // zones
            r.arr32(2); // animated textures
            r.arr32(22); // items
            r.skip(8192); // light table
            palette = r.at;
            r.skip(768);
        }

        const glyphs: Glyph[] = [];
        for (let i = 0; i < count; i++) {
            const at = sprites + (first + i) * 16;
            const page = view.getUint16(at, true);
            const left = data[at + 2];
            const top = data[at + 3];
            const width = (view.getUint16(at + 4, true) + 1) >> 8;
            const height = (view.getUint16(at + 6, true) + 1) >> 8;
            const rgba = new Uint8Array(width * height * 4);
            for (let y = 0; y < height && page < pageCount; y++) {
                for (let x = 0; x < width && left + x < 256 && top + y < 256; x++) {
                    const pixel = page * TEXTURE_PAGE + (top + y) * 256 + left + x;
                    const o = (y * width + x) * 4;
                    if (game === 1) {
                        const index = data[pages8 + pixel];
                        if (index === 0) continue;
                        rgba[o] = data[palette + index * 3] * 4;
                        rgba[o + 1] = data[palette + index * 3 + 1] * 4;
                        rgba[o + 2] = data[palette + index * 3 + 2] * 4;
                        rgba[o + 3] = 255;
                    } else {
                        const value = view.getUint16(pages16 + pixel * 2, true);
                        if (!(value & 0x8000)) continue;
                        rgba[o] = Math.round(((value >> 10) & 31) * 255 / 31);
                        rgba[o + 1] = Math.round(((value >> 5) & 31) * 255 / 31);
                        rgba[o + 2] = Math.round((value & 31) * 255 / 31);
                        rgba[o + 3] = 255;
                    }
                }
            }
            glyphs.push({
                width,
                height,
                x0: view.getInt16(at + 8, true),
                y0: view.getInt16(at + 10, true),
                x1: view.getInt16(at + 12, true),
                y1: view.getInt16(at + 14, true),
                rgba,
            });
        }
        return { gameVersion: game, glyphs };
    } catch {
        return null;
    }
}

const TO_CAMERA = 1;
const TO_FINISH = 7;
const TO_CD = 8;
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

/** The music tracks a level's triggers play (TO_CD), as the level file numbers them. */
export function cdTracks(data: Uint8Array): number[] {
    const level = readLevel(data);
    if (level === null) return [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const word = (i: number) => view.getUint16(level.floorDataOffset + i * 2, true);
    const tracks = new Set<number>();
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
                i++;
                const triggerType = (entry & 0x7f00) >> 8;
                if (triggerType === TT_SWITCH || triggerType === TT_KEY || triggerType === TT_PICKUP) {
                    if (word(i++) & 0x8000) continue;
                }
                let command = 0;
                do {
                    if (i >= level.floorDataCount) break;
                    command = word(i++);
                    const kind = (command & 0x7c00) >> 10;
                    if (kind === TO_CAMERA || kind === TO_FLYBY) command = word(i++);
                    else if (kind === TO_CD) tracks.add(command & 0x3ff);
                } while (!(command & 0x8000));
            }
        } while (!(entry & 0x8000));
    }
    return [...tracks].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export type LevelObject = {
    id: number;
    meshCount: number;
    /** Index of its first mesh in the mesh pointer table. */
    firstMesh: number;
    /** Where its bones start in the bone table, in 32-bit words. */
    tree: number;
    /** Where its first frame starts in the frame table, in bytes. */
    frame: number;
};

/** Where a level keeps its objects' meshes, bones and records, for adding an object. */
export type LevelObjects = {
    gameVersion: 1 | 2 | 3;
    /** Byte offsets of the mesh data's count, of its first byte, and of the byte after it. */
    meshDataAt: number;
    meshDataStart: number;
    meshDataEnd: number;
    meshPointers: number[];
    /** Byte offsets of each table's count, and of the byte after its last record. */
    meshPointersAt: number;
    meshPointersEnd: number;
    boneCount: number;
    bonesAt: number;
    bonesEnd: number;
    /** Byte offset of the first frame word. */
    framesStart: number;
    framesEnd: number;
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
        const meshDataAt = r.at;
        r.arr32(2); // object meshes
        const meshDataEnd = r.at;

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
        const framesStart = r.at + 4;
        r.arr32(2); // animation frames
        const framesEnd = r.at;

        const objectsAt = r.at;
        const objectCount = r.s32();
        const objects: LevelObject[] = [];
        for (let i = 0; i < objectCount; i++) {
            const at = r.at;
            r.skip(18);
            objects.push({
                id: view.getUint32(at, true),
                meshCount: view.getUint16(at + 4, true),
                firstMesh: view.getUint16(at + 6, true),
                tree: view.getUint32(at + 8, true),
                frame: view.getUint32(at + 12, true),
            });
        }
        return {
            gameVersion: game,
            meshDataAt,
            meshDataStart: meshDataAt + 4,
            meshDataEnd,
            meshPointers,
            meshPointersAt,
            meshPointersEnd,
            boneCount,
            bonesAt,
            bonesEnd,
            framesStart,
            framesEnd,
            objectsAt,
            objectsEnd: r.at,
            objects,
        };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

/** A turn about each axis, in 65536ths of a circle, applied in the order Y, X, Z. */
export type Rotation = { x: number; y: number; z: number };
export type Offset = { x: number; y: number; z: number };

/** The length in bytes of the mesh at that offset into the mesh data, which TR1 to TR3 share one layout for. */
function meshLength(view: DataView, start: number): number {
    let at = start + 10; // centre, collision radius
    at += view.getInt16(at, true) * 6 + 2; // vertices
    const normals = view.getInt16(at, true);
    at += (normals > 0 ? normals * 6 : -normals * 2) + 2; // normals, or shades
    for (const corners of [4, 3, 4, 3]) at += view.getInt16(at, true) * (corners + 1) * 2 + 2; // faces
    return at - start;
}

/** A copy of the bytes of the mesh at that place in the mesh pointer table. */
export function meshData(data: Uint8Array, level: LevelObjects, mesh: number): Uint8Array {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const start = level.meshDataStart + level.meshPointers[mesh];
    if (start >= level.meshDataEnd) throw new Error('mesh outside the mesh data');
    const length = meshLength(view, start);
    if (start + length > level.meshDataEnd) throw new Error('mesh outside the mesh data');
    return data.slice(start, start + length);
}

/** Where a bone of an object puts the mesh after it, from the mesh its parent is. */
export function boneOffset(data: Uint8Array, level: LevelObjects, object: LevelObject, mesh: number): Offset {
    const at = level.bonesAt + 4 + (object.tree + (mesh - 1) * 4) * 4;
    if (mesh < 1 || at + 16 > level.bonesEnd) throw new Error('bone outside the bone table');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { x: view.getInt32(at + 4, true), y: view.getInt32(at + 8, true), z: view.getInt32(at + 12, true) };
}

/** How the first frame of an object turns one of its meshes, read as TRX's anims/frames.c reads it. */
export function frameRotation(data: Uint8Array, level: LevelObjects, object: LevelObject, mesh: number): Rotation {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = level.framesStart + object.frame + 9 * 2; // bounds, offset
    if (level.gameVersion === 1) at += 2; // mesh count
    const word = (): number => {
        if (at + 2 > level.framesEnd) throw new Error('frame outside the frame table');
        const value = view.getUint16(at, true);
        at += 2;
        return value;
    };
    const all = (first: number, second: number): Rotation => ({
        x: ((first & 0x3ff0) << 2) & 0xffff,
        y: ((((first & 0xf) << 6) | ((second & 0xfc00) >> 10)) << 6) & 0xffff,
        z: ((second & 0x3ff) << 6) & 0xffff,
    });
    let rotation: Rotation = { x: 0, y: 0, z: 0 };
    for (let i = 0; i <= mesh; i++) {
        const first = word();
        if (level.gameVersion === 1) {
            const second = word();
            rotation = all(second, first);
            continue;
        }
        const angle = ((first & 0x3ff) << 6) & 0xffff;
        switch ((first >> 14) & 3) {
            case 1: rotation = { x: angle, y: 0, z: 0 }; break;
            case 2: rotation = { x: 0, y: angle, z: 0 }; break;
            case 3: rotation = { x: 0, y: 0, z: angle }; break;
            default: rotation = all(first, word());
        }
    }
    return rotation;
}

/**
 * The mesh moved into the space of the joint it would hang off: turned as
 * Matrix_Rot16 turns (Y, then X, then Z) and then put at the offset, the way
 * the engine draws a mesh one bone further on. Its normals turn with it.
 */
export function placeMesh(mesh: Uint8Array, rotation: Rotation, offset: Offset): Uint8Array {
    const out = mesh.slice();
    const view = new DataView(out.buffer);
    const turn = (axis: number): [number, number] => {
        const radians = (axis / 65536) * 2 * Math.PI;
        return [Math.sin(radians), Math.cos(radians)];
    };
    const [sy, cy] = turn(rotation.y);
    const [sx, cx] = turn(rotation.x);
    const [sz, cz] = turn(rotation.z);
    const apply = (v: [number, number, number]): [number, number, number] => {
        // Z, then X, then Y, as the product Ry Rx Rz meets a vector.
        let [x, y, z] = v;
        [x, y] = [x * cz - y * sz, x * sz + y * cz];
        [y, z] = [y * cx - z * sx, y * sx + z * cx];
        [x, z] = [x * cy + z * sy, -x * sy + z * cy];
        return [x, y, z];
    };
    const clamp16 = (value: number): number => Math.max(-32768, Math.min(32767, Math.round(value)));
    const move = (at: number, translate: boolean): void => {
        const [x, y, z] = apply([view.getInt16(at, true), view.getInt16(at + 2, true), view.getInt16(at + 4, true)]);
        view.setInt16(at, clamp16(x + (translate ? offset.x : 0)), true);
        view.setInt16(at + 2, clamp16(y + (translate ? offset.y : 0)), true);
        view.setInt16(at + 4, clamp16(z + (translate ? offset.z : 0)), true);
    };
    move(0, true); // centre
    let at = 10;
    const vertices = view.getInt16(at, true);
    at += 2;
    for (let i = 0; i < vertices; i++, at += 6) move(at, true);
    const normals = view.getInt16(at, true);
    at += 2;
    for (let i = 0; i < normals; i++, at += 6) move(at, false);
    return out;
}

/**
 * The level with one more object. Its meshes are meshes the level already
 * has, by their places in the mesh pointer table, which it shares, or new
 * ones, whose bytes go at the end of the mesh data. It has no animations,
 * and bones that offset nothing.
 */
export function addMeshObject(data: Uint8Array, level: LevelObjects, id: number, meshes: (number | Uint8Array)[]): Uint8Array {
    if (meshes.length === 0 || level.meshPointers.length + meshes.length > 0xffff) throw new Error('too many meshes');
    // New meshes, each at a 4-byte boundary of the mesh data.
    const added: Uint8Array[] = [];
    let meshBytes = level.meshDataEnd - level.meshDataStart;
    const pointers = new Uint8Array(meshes.length * 4);
    const pointerView = new DataView(pointers.buffer);
    meshes.forEach((mesh, i) => {
        if (typeof mesh === 'number') {
            pointerView.setUint32(i * 4, level.meshPointers[mesh], true);
            return;
        }
        const padding = (4 - (meshBytes % 4)) % 4;
        const bytes = new Uint8Array(padding + mesh.length + ((4 - (mesh.length % 4)) % 4));
        bytes.set(mesh, padding);
        pointerView.setUint32(i * 4, meshBytes + padding, true);
        added.push(bytes);
        meshBytes += bytes.length;
    });
    const newMeshes = new Uint8Array(meshBytes - (level.meshDataEnd - level.meshDataStart));
    let filled = 0;
    for (const bytes of added) {
        newMeshes.set(bytes, filled);
        filled += bytes.length;
    }
    const bones = new Uint8Array((meshes.length - 1) * 16);
    const record = new Uint8Array(18);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, id, true);
    recordView.setUint16(4, meshes.length, true);
    recordView.setUint16(6, level.meshPointers.length, true);
    recordView.setUint32(8, level.boneCount, true);
    recordView.setUint32(12, 0, true);
    recordView.setUint16(16, 0xffff, true);

    const out = new Uint8Array(data.length + newMeshes.length + pointers.length + bones.length + record.length);
    let at = 0;
    const put = (part: Uint8Array) => {
        out.set(part, at);
        at += part.length;
    };
    put(data.subarray(0, level.meshDataEnd));
    put(newMeshes);
    put(data.subarray(level.meshDataEnd, level.meshPointersEnd));
    put(pointers);
    put(data.subarray(level.meshPointersEnd, level.bonesEnd));
    put(bones);
    put(data.subarray(level.bonesEnd, level.objectsEnd));
    put(record);
    put(data.subarray(level.objectsEnd));

    const view = new DataView(out.buffer);
    let shift = newMeshes.length;
    view.setInt32(level.meshDataAt, meshBytes / 2, true);
    view.setInt32(level.meshPointersAt + shift, level.meshPointers.length + meshes.length, true);
    shift += pointers.length;
    view.setInt32(level.bonesAt + shift, level.boneCount + (meshes.length - 1) * 4, true);
    shift += bones.length;
    view.setInt32(level.objectsAt + shift, level.objects.length + 1, true);
    return out;
}

/**
 * The level with the object in slot `from` moved to slot `to`, or null when
 * it has no such object, `to` is taken, or an item of the level is one, as
 * the move would change what that item is.
 */
export function moveObject(data: Uint8Array, from: number, to: number): Uint8Array | null {
    const objects = readLevelObjects(data);
    const level = readLevel(data);
    if (objects === null || level === null) return null;
    const index = objects.objects.findIndex((object) => object.id === from);
    if (index < 0 || objects.objects.some((object) => object.id === to)) return null;
    if (level.items.some((item) => item.objectId === from)) return null;
    const out = data.slice();
    new DataView(out.buffer).setUint32(objects.objectsAt + 4 + index * 18, to, true);
    return out;
}

/**
 * The level without the object records of those slots, or null when it has
 * none of them. Their meshes, bones and frames stay, unused.
 */
export function removeObjects(data: Uint8Array, ids: Set<number>): Uint8Array | null {
    const objects = readLevelObjects(data);
    if (objects === null) return null;
    const keep = objects.objects.map((object, i) => ({ object, i })).filter(({ object }) => !ids.has(object.id));
    if (keep.length === objects.objects.length) return null;
    const records = new Uint8Array(keep.length * 18);
    keep.forEach(({ i }, n) => records.set(data.subarray(objects.objectsAt + 4 + i * 18, objects.objectsAt + 4 + (i + 1) * 18), n * 18));
    const out = new Uint8Array(data.length - (objects.objects.length - keep.length) * 18);
    out.set(data.subarray(0, objects.objectsAt));
    new DataView(out.buffer).setInt32(objects.objectsAt, keep.length, true);
    out.set(records, objects.objectsAt + 4);
    out.set(data.subarray(objects.objectsEnd), objects.objectsAt + 4 + records.length);
    return out;
}

/**
 * The level with the object in slot `from` in slot `to` instead, and every
 * item that is one of it too; null when the level has no such object, or
 * has one in `to` already.
 */
export function renumberObject(data: Uint8Array, from: number, to: number): Uint8Array | null {
    const objects = readLevelObjects(data);
    const level = readLevel(data);
    if (objects === null || level === null) return null;
    const index = objects.objects.findIndex((object) => object.id === from);
    if (index < 0 || objects.objects.some((object) => object.id === to)) return null;
    const out = data.slice();
    const view = new DataView(out.buffer);
    view.setUint32(objects.objectsAt + 4 + index * 18, to, true);
    for (const item of level.items) {
        if (item.objectId === from) view.setInt16(item.offset, to, true);
    }
    return out;
}
