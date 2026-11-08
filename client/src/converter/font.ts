// Rebuilds TRX's font for games whose levels bring lettering of their own.
//
// A level keeps its font in the sprites of its alphabet object, and some
// builders redraw them. TRX's injections/font.bin replaces those sprites
// with TRX's own, which add the characters and icons TRX draws (the touch
// controls' among them): a game that injects it loses the lettering its
// builder drew, and one that does not lacks those icons. As TRX's injection
// tool builds font.bin from glyph sheets, this builds the game a font.bin of
// its own: TRX's, with each sprite the builder redrew in the place of TRX's.
// A sprite is the builder's when it looks like neither the game's original
// one at its place (glyphs.generated.ts) nor TRX's.

import { unzlibSync, zlibSync } from 'fflate';
import { COMBINED_GLYPHS, STOCK_GLYPHS } from './glyphs.generated.ts';
import { parseJSON5 } from './json5.ts';
import { ALPHABET_SLOT, glyphBounds, glyphFingerprint, readAlphabet, type Glyph } from './level.ts';
import type { MappedFile } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** How far apart, in any channel, two levels' palettes leave the colours of one glyph. */
const COLOUR_TOLERANCE = 48;
const PAGE = 256 * 256;

// TRX's injection format (src/trx/game/inject/enum.h).
const MAGIC_TRXI = 0x49585254;
const ICT_TEXTURE_DATA = 0;
const ICT_TEXTURE_INFO = 1;
const IDT_PALETTE = 0;
const IDT_TEXTURE_PAGES = 1;
const IDT_SPRITE_TEXTURES = 3;
const IDT_SPRITE_SEQUENCES = 4;
const OBJ_TYPE_OBJECT = 0;

type Block = { type: number; count: number; data: Uint8Array };
type Chunk = { type: number; version: number; blocks: Block[] };
type Injection = { major: number; type: number; tests: Uint8Array; chunks: Chunk[] };

function readInjection(data: Uint8Array): Injection | null {
    try {
        const head = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (head.getUint32(0, true) !== MAGIC_TRXI) return null;
        const major = head.getInt32(4, true);
        const type = head.getInt32(8, true);
        const compressed = head.getInt32(16, true);
        const payload = unzlibSync(data.subarray(20, 20 + compressed));
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        let at = 0;
        const s32 = () => {
            const value = view.getInt32(at, true);
            at += 4;
            return value;
        };
        const testCount = s32();
        for (let i = 0; i < testCount; i++) {
            at += 8; // type and version
            const size = s32();
            at += size;
        }
        const tests = payload.slice(0, at);
        const chunks: Chunk[] = [];
        const chunkCount = s32();
        for (let i = 0; i < chunkCount; i++) {
            const chunk: Chunk = { type: s32(), version: s32(), blocks: [] };
            const blockCount = s32();
            s32(); // total size
            for (let j = 0; j < blockCount; j++) {
                const blockType = s32();
                const count = s32();
                const size = s32();
                chunk.blocks.push({ type: blockType, count, data: payload.slice(at, at + size) });
                at += size;
            }
            chunks.push(chunk);
        }
        return at === payload.length ? { major, type, tests, chunks } : null;
    } catch {
        return null;
    }
}

function writeInjection(injection: Injection): Uint8Array {
    const parts: Uint8Array[] = [injection.tests];
    const int = (value: number) => {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setInt32(0, value, true);
        parts.push(bytes);
    };
    int(injection.chunks.length);
    for (const chunk of injection.chunks) {
        int(chunk.type);
        int(chunk.version);
        int(chunk.blocks.length);
        int(chunk.blocks.reduce((sum, block) => sum + 12 + block.data.length, 0));
        for (const block of chunk.blocks) {
            int(block.type);
            int(block.count);
            int(block.data.length);
            parts.push(block.data);
        }
    }
    const payload = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        payload.set(part, at);
        at += part.length;
    }
    const compressed = zlibSync(payload, { level: 9 });
    const out = new Uint8Array(20 + compressed.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, MAGIC_TRXI, true);
    view.setInt32(4, injection.major, true);
    view.setInt32(8, injection.type, true);
    view.setInt32(12, payload.length, true);
    view.setInt32(16, compressed.length, true);
    out.set(compressed, 20);
    return out;
}

function findBlock(injection: Injection, chunkType: number, blockType: number): Block | undefined {
    return injection.chunks.find((chunk) => chunk.type === chunkType)?.blocks.find((block) => block.type === blockType);
}

/** TRX's font: its injection, and where its sprites of the font object are. */
type Font = { injection: Injection; pages: Block; sprites: Block; first: number; count: number };

function readFont(data: Uint8Array, gameVersion: number): Font | null {
    const injection = readInjection(data);
    if (!injection) return null;
    const pages = findBlock(injection, ICT_TEXTURE_DATA, IDT_TEXTURE_PAGES);
    const sprites = findBlock(injection, ICT_TEXTURE_INFO, IDT_SPRITE_TEXTURES);
    const sequences = findBlock(injection, ICT_TEXTURE_INFO, IDT_SPRITE_SEQUENCES);
    if (!pages || !sprites || !sequences) return null;
    const view = new DataView(sequences.data.buffer, sequences.data.byteOffset, sequences.data.byteLength);
    for (let i = 0; i < sequences.count; i++) {
        if (view.getInt32(i * 12, true) !== OBJ_TYPE_OBJECT || view.getInt32(i * 12 + 4, true) !== ALPHABET_SLOT[gameVersion]) continue;
        const count = -view.getInt16(i * 12 + 8, true);
        const first = view.getInt16(i * 12 + 10, true);
        if (count > 0 && first >= 0 && (first + count) * 16 <= sprites.data.length) return { injection, pages, sprites, first, count };
    }
    return null;
}

/** A sprite of a font cut to what shows: where it is drawn from the cursor on the baseline, and its pixels. */
type Sprite = { x0: number; y0: number; width: number; height: number; rgba: Uint8Array };

/** The part of a glyph that shows, as a sprite; null for an empty one. */
function cut(glyph: Glyph, x0: number): Sprite | null {
    const bounds = glyphBounds(glyph);
    if (!bounds) return null;
    const rgba = new Uint8Array(bounds.width * bounds.height * 4);
    for (let row = 0; row < bounds.height; row++) {
        const from = ((bounds.y + row) * glyph.width + bounds.x) * 4;
        rgba.set(glyph.rgba.subarray(from, from + bounds.width * 4), row * bounds.width * 4);
    }
    return { x0, y0: glyph.y0 + bounds.y, width: bounds.width, height: bounds.height, rgba };
}

/** TRX's sprite at a place in its font, as its 32-bit pages show it. */
function fontGlyph(font: Font, index: number): Glyph {
    const view = new DataView(font.sprites.data.buffer, font.sprites.data.byteOffset, font.sprites.data.byteLength);
    const at = (font.first + index) * 16;
    const page = view.getUint16(at, true);
    const left = font.sprites.data[at + 2];
    const top = font.sprites.data[at + 3];
    const width = (view.getUint16(at + 4, true) + 1) >> 8;
    const height = (view.getUint16(at + 6, true) + 1) >> 8;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height && page < font.pages.count; y++) {
        for (let x = 0; x < width && left + x < 256 && top + y < 256; x++) {
            const from = (page * PAGE + (top + y) * 256 + left + x) * 4;
            const o = (y * width + x) * 4;
            rgba.set(font.pages.data.subarray(from, from + 3), o);
            rgba[o + 3] = font.pages.data[from + 3] ? 255 : 0;
        }
    }
    return { width, height, x0: view.getInt16(at + 8, true), y0: view.getInt16(at + 10, true), x1: view.getInt16(at + 12, true), y1: view.getInt16(at + 14, true), rgba };
}

function looksLike(print: { shape: string; colour: number[] }, shape: string, colour: number[]): boolean {
    return print.shape === shape && print.colour.every((c, k) => Math.abs(c - colour[k]) <= COLOUR_TOLERANCE);
}

/**
 * The sprites of a level's font that its builder drew, by their place:
 * those of the game's original font that look like neither the original's
 * nor TRX's. Places past the original font are TRX's alone, and so is a
 * sprite drawn at another scale than its pixels, which no level has (the
 * original fonts draw some a unit shorter than they are).
 */
function ownGlyphs(glyphs: Glyph[], gameVersion: number, font: Font): Map<number, Glyph> {
    const stock = STOCK_GLYPHS[gameVersion] ?? [];
    const own = new Map<number, Glyph>();
    const count = Math.min(glyphs.length, stock.length, font.count);
    for (let i = 0; i < count; i++) {
        const glyph = glyphs[i];
        const print = glyphFingerprint(glyph);
        // An empty sprite leaves the character to TRX.
        if (!print || Math.abs(glyph.x1 - glyph.x0 - glyph.width) > 1 || Math.abs(glyph.y1 - glyph.y0 - glyph.height) > 1) continue;
        const original = stock[i].some((look) => {
            const [shape, hex] = look.split(' ');
            return looksLike(print, shape, [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16)));
        });
        if (original) continue;
        const trx = glyphFingerprint(fontGlyph(font, i));
        if (trx && looksLike(print, trx.shape, trx.colour)) continue;
        own.set(i, glyph);
    }
    return own;
}

/**
 * Whether two levels bring the same lettering: the same sprites in the same
 * places, which each level's palette may have tinted a little.
 */
function sameLettering(a: Map<number, Glyph>, b: Map<number, Glyph>): boolean {
    if (a.size !== b.size) return false;
    for (const [i, glyph] of a) {
        const other = b.get(i);
        if (!other || glyph.y0 !== other.y0 || glyph.height !== other.height) return false;
        const print = glyphFingerprint(other)!;
        const own = glyphFingerprint(glyph)!;
        if (!looksLike(print, own.shape, own.colour)) return false;
    }
    return true;
}

/**
 * An accent set on a letter, as TRX's glyph tools combine them
 * (CombineSource in tools/shared/glyph_mapping.py).
 */
function combine(letter: Sprite, accent: Sprite, offsetX: number, offsetY: number, align: string): Sprite {
    let dx = offsetX + Math.floor((letter.width - accent.width) / 2);
    let dy = offsetY;
    if (align === 'top') dy += letter.y0 - accent.y0 - accent.height;
    else if (align === 'center') dy += letter.y0 - accent.y0 + Math.floor((letter.height - accent.height) / 2);
    else if (align === 'bottom') dy += letter.y0 + letter.height - accent.y0;
    const accentTop = accent.y0 + dy;
    const left = Math.min(0, dx);
    const top = Math.min(letter.y0, accentTop);
    const width = Math.max(letter.width, dx + accent.width) - left;
    const height = Math.max(letter.y0 + letter.height, accentTop + accent.height) - top;
    const rgba = new Uint8Array(width * height * 4);
    const blit = (sprite: Sprite, x: number, y: number) => {
        for (let row = 0; row < sprite.height; row++) {
            for (let column = 0; column < sprite.width; column++) {
                const from = (row * sprite.width + column) * 4;
                if (sprite.rgba[from + 3]) rgba.set(sprite.rgba.subarray(from, from + 4), ((y + row) * width + x + column) * 4);
            }
        }
    };
    blit(letter, -left, letter.y0 - top);
    dx -= left;
    blit(accent, dx, accentTop - top);
    return { x0: left, y0: top, width, height, rgba };
}

/**
 * The sprites a font rebuilt with the builder's own takes: those, each cut
 * to what shows and drawn from the cursor, as TRX's own are, on the baseline
 * the level gave it; and every character TRX makes of a letter and an accent
 * where either is the builder's.
 */
function spritesOf(own: Map<number, Glyph>, font: Font): Map<number, Sprite> {
    const sprites = new Map<number, Sprite>();
    for (const [i, glyph] of own) {
        const sprite = cut(glyph, 0);
        if (sprite) sprites.set(i, sprite);
    }
    const at = (i: number) => {
        if (sprites.has(i)) return sprites.get(i)!;
        const glyph = fontGlyph(font, i);
        const bounds = glyphBounds(glyph);
        return cut(glyph, glyph.x0 + (bounds?.x ?? 0));
    };
    for (const [place, letter, accent, offsetX, offsetY, align] of COMBINED_GLYPHS) {
        if (place >= font.count || letter >= font.count || accent >= font.count) continue;
        if (!sprites.has(letter) && !sprites.has(accent)) continue;
        const letterSprite = at(letter);
        const accentSprite = at(accent);
        if (letterSprite && accentSprite) sprites.set(place, combine(letterSprite, accentSprite, offsetX, offsetY, align));
    }
    return sprites;
}

/** The palette entry closest to a colour, of those after the transparent first one. */
function nearestEntry(palette: Uint8Array, r: number, g: number, b: number): number {
    let best = 1;
    let bestDistance = Infinity;
    for (let i = 1; i * 3 + 2 < palette.length; i++) {
        const distance = (palette[i * 3] - r) ** 2 + (palette[i * 3 + 1] - g) ** 2 + (palette[i * 3 + 2] - b) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
        }
    }
    return best;
}

/** TRX's font with the given sprites in the place of its own, on pages added after its own. */
function rebuildFont(stock: Font, replaced: Map<number, Sprite>): Uint8Array {
    const { injection, pages, sprites } = stock;
    const palette = findBlock(injection, ICT_TEXTURE_DATA, IDT_PALETTE)?.data ?? new Uint8Array(0);
    const added: { rgba: Uint8Array; indexed: Uint8Array }[] = [];
    const newPage = () => {
        added.push({ rgba: new Uint8Array(PAGE * 4), indexed: new Uint8Array(PAGE) });
        return added[added.length - 1];
    };
    let page = newPage();
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    const entries = new Map<number, number>();
    const spriteData = sprites.data.slice();
    const spriteView = new DataView(spriteData.buffer);
    for (const [index, sprite] of replaced) {
        if (x + sprite.width > 256) {
            x = 0;
            y += rowHeight + 1;
            rowHeight = 0;
        }
        if (y + sprite.height > 256) {
            page = newPage();
            x = 0;
            y = 0;
            rowHeight = 0;
        }
        for (let row = 0; row < sprite.height; row++) {
            for (let column = 0; column < sprite.width; column++) {
                const from = (row * sprite.width + column) * 4;
                if (!sprite.rgba[from + 3]) continue;
                const to = (y + row) * 256 + x + column;
                const [r, g, b] = sprite.rgba.subarray(from, from + 3);
                page.rgba.set([r, g, b, 255], to * 4);
                const colour = (r << 16) | (g << 8) | b;
                let entry = entries.get(colour);
                if (entry === undefined) {
                    entry = nearestEntry(palette, r, g, b);
                    entries.set(colour, entry);
                }
                page.indexed[to] = entry;
            }
        }
        const at = (stock.first + index) * 16;
        spriteView.setUint16(at, pages.count + added.length - 1, true);
        spriteView.setUint16(at + 2, x | (y << 8), true);
        spriteView.setUint16(at + 4, sprite.width * 256 - 1, true);
        spriteView.setUint16(at + 6, sprite.height * 256 - 1, true);
        spriteView.setInt16(at + 8, sprite.x0, true);
        spriteView.setInt16(at + 10, sprite.y0, true);
        spriteView.setInt16(at + 12, sprite.x0 + sprite.width, true);
        spriteView.setInt16(at + 14, sprite.y0 + sprite.height, true);
        x += sprite.width + 1;
        rowHeight = Math.max(rowHeight, sprite.height);
    }

    // The pages hold every page's 32-bit pixels, then every page's indices.
    const oldRgba = pages.data.subarray(0, pages.count * PAGE * 4);
    const oldIndexed = pages.data.subarray(pages.count * PAGE * 4);
    const pageData = new Uint8Array(pages.data.length + added.length * PAGE * 5);
    let at = 0;
    for (const part of [oldRgba, ...added.map((p) => p.rgba), oldIndexed, ...added.map((p) => p.indexed)]) {
        pageData.set(part, at);
        at += part.length;
    }
    const swap = (block: Block, data: Uint8Array, count: number) => ({ ...block, data, count });
    const rebuilt: Injection = {
        ...injection,
        chunks: injection.chunks.map((chunk) => ({
            ...chunk,
            blocks: chunk.blocks.map((block) => {
                if (block === pages) return swap(block, pageData, pages.count + added.length);
                if (block === sprites) return swap(block, spriteData, sprites.count);
                return block;
            }),
        })),
    };
    return writeInjection(rebuilt);
}

async function stockFont(gameVersion: number): Promise<Uint8Array | null> {
    const { BASE_FONTS } = await import('../templates/base/fonts.ts');
    const base64 = BASE_FONTS[`tr${gameVersion}`];
    return base64 ? Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) : null;
}

function isObject(value: unknown): value is AnyObj {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const isFont = (name: unknown) => typeof name === 'string' && name.split('/').pop()!.toLowerCase() === 'font.bin';

/**
 * Gives every level of the game a font: TRX's, or one rebuilt with the
 * sprites its builder drew. A game that never injected TRX's font gets it,
 * for the characters and icons TRX draws.
 */
export async function rebuildFonts(files: MappedFile[], modDir: string, gameVersion: number): Promise<string[]> {
    const prefix = `games/${modDir}/`;
    const notes: string[] = [];
    const gameflowFile = files.find((f) => f.path === prefix + 'gameflow.json5');
    let gameflow: AnyObj | null = null;
    try {
        gameflow = gameflowFile ? parseJSON5(decoder.decode(gameflowFile.data)) as AnyObj : null;
    } catch {
        gameflow = null;
    }
    if (!gameflowFile || !isObject(gameflow)) return notes;
    // A font of the game's own is the builder's to keep, if TRX reads it;
    // one made for the engines before TRX it cannot, and it goes.
    const ownFont = files.find((f) => f.path.toLowerCase() === prefix + 'injections/font.bin');
    if (ownFont) {
        const magic = ownFont.data.length >= 4 ? decoder.decode(ownFont.data.subarray(0, 4)) : '';
        if (magic === 'TRXJ' || magic === 'TRXI') return notes;
        files.splice(files.indexOf(ownFont), 1);
        notes.push('Left out the game\'s font.bin, made for an engine before TRX, which TRX cannot read.');
    }

    const holders: AnyObj[] = [gameflow.title, ...(Array.isArray(gameflow.levels) ? gameflow.levels : []), ...(Array.isArray(gameflow.cutscenes) ? gameflow.cutscenes : [])]
        .filter((holder): holder is AnyObj => isObject(holder) && typeof holder.path === 'string');
    if (holders.length === 0) return notes;
    if (!Array.isArray(gameflow.injections)) gameflow.injections = [];
    const global: unknown[] = gameflow.injections;
    const inherits = (holder: AnyObj) => holder.inherit_injections !== false;
    const hasFont = (holder: AnyObj) => (inherits(holder) && global.some(isFont)) || (Array.isArray(holder.injections) && holder.injections.some(isFont));
    let changed = false;

    // Made before TRX had a font: TRX's draws the characters and icons TRX has since added.
    if (!holders.some(hasFont)) {
        global.push('font.bin');
        for (const holder of holders) {
            if (inherits(holder)) continue;
            holder.injections = [...(Array.isArray(holder.injections) ? holder.injections : []), 'font.bin'];
        }
        notes.push('Gave the game TRX\'s font, for the characters and icons TRX draws, the touch controls\' among them.');
        changed = true;
    }

    const data = await stockFont(gameVersion);
    const font = data && readFont(data, gameVersion);
    if (font) {
        // The lettering of each level file, read once; levels that bring the
        // same share one font, made from the first of them.
        type Lettering = { glyphs: Map<number, Glyph>; name: string; levels: string[] };
        const byPath = new Map(files.map((f) => [f.path.toLowerCase(), f]));
        const letterings: Lettering[] = [];
        const ofFile = new Map<string, Lettering | null>();
        const letteringOf = (holder: AnyObj): Lettering | null => {
            const path = (prefix + 'levels/' + holder.path).toLowerCase();
            if (!ofFile.has(path)) {
                const file = byPath.get(path);
                const alphabet = file ? readAlphabet(file.data) : null;
                const glyphs = alphabet && alphabet.gameVersion === gameVersion ? ownGlyphs(alphabet.glyphs, gameVersion, font) : null;
                let lettering: Lettering | null = null;
                if (glyphs && glyphs.size > 0) {
                    lettering = letterings.find((other) => sameLettering(other.glyphs, glyphs)) ?? null;
                    if (!lettering) {
                        const name = path.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/g, '_');
                        lettering = { glyphs, name, levels: [] };
                        letterings.push(lettering);
                    }
                    lettering.levels.push(holder.path);
                }
                ofFile.set(path, lettering);
            }
            return ofFile.get(path)!;
        };
        const users = holders.filter(hasFont);
        const drawn = users.map(letteringOf);
        // One font for every level goes by TRX's name, which the game's own
        // injections/ answers first; others by a level's.
        const sole = letterings.length === 1 && drawn.every((lettering) => lettering !== null);
        for (const lettering of letterings) {
            const name = sole ? 'font.bin' : `font_${lettering.name}.bin`;
            const sprites = spritesOf(lettering.glyphs, font);
            files.push({ path: prefix + 'injections/' + name, data: rebuildFont(font, sprites) });
            const own = lettering.glyphs.size;
            const combined = sprites.size - own;
            notes.push(`Rebuilt TRX's font with the ${own} sprite${own === 1 ? '' : 's'} the builder drew for ${lettering.levels.join(', ')}`
                + (combined > 0 ? ` and the ${combined} accented character${combined === 1 ? '' : 's'} TRX makes of them` : '')
                + `, so that ${lettering.levels.length === 1 ? 'it keeps its' : 'they keep their'} own lettering.`);
            if (sole) continue;
            users.forEach((holder, i) => {
                if (drawn[i] !== lettering) return;
                const list: unknown[] = Array.isArray(holder.injections) ? holder.injections : [];
                // After TRX's, if it inherits it: the last font injected is the one drawn.
                holder.injections = list.some(isFont) ? list.map((item) => (isFont(item) ? name : item)) : [...list, name];
                changed = true;
            });
        }
    }

    if (changed) gameflowFile.data = encoder.encode(JSON.stringify(gameflow, null, 4));
    return notes;
}
