// Decodes LZMA, as 7-Zip writes into zip archives (method 14). Browsers
// offer deflate but not LZMA, and community archives use both. This follows
// the structure of the reference decoder in Igor Pavlov's LZMA SDK
// (LzmaSpec.cpp, public domain), decoding a whole entry into one buffer.

/** LZMA data that cannot be decoded. */
export class LzmaError extends Error {}

const TOP_VALUE = 1 << 24;
const BIT_MODEL_TOTAL_BITS = 11;
const BIT_MODEL_TOTAL = 1 << BIT_MODEL_TOTAL_BITS;
const MOVE_BITS = 5;
const PROB_INIT = BIT_MODEL_TOTAL >>> 1;

const NUM_STATES = 12;
const POS_BITS_MAX = 4;
const NUM_LEN_TO_POS_STATES = 4;
const NUM_ALIGN_BITS = 4;
const END_POS_MODEL_INDEX = 14;
const NUM_FULL_DISTANCES = 1 << (END_POS_MODEL_INDEX >>> 1);
const MATCH_MIN_LEN = 2;

function probs(count: number): Uint16Array {
    return new Uint16Array(count).fill(PROB_INIT);
}

class RangeDecoder {
    // Kept as plain numbers, not 32-bit integers, so they stay unsigned.
    private range = 0xffffffff;
    private code = 0;
    private at: number;
    private readonly input: Uint8Array;

    constructor(input: Uint8Array, start: number) {
        this.input = input;
        this.at = start;
        if (this.next() !== 0) throw new LzmaError('The LZMA data is damaged.');
        for (let i = 0; i < 4; i++) this.code = this.code * 256 + this.next();
        if (this.code === this.range) throw new LzmaError('The LZMA data is damaged.');
    }

    private next(): number {
        if (this.at >= this.input.length) throw new LzmaError('The LZMA data is cut short.');
        return this.input[this.at++]!;
    }

    private normalize(): void {
        if (this.range < TOP_VALUE) {
            this.range *= 256;
            this.code = this.code * 256 + this.next();
        }
    }

    directBits(count: number): number {
        let result = 0;
        for (let i = 0; i < count; i++) {
            this.range = Math.floor(this.range / 2);
            let bit = 0;
            if (this.code >= this.range) {
                this.code -= this.range;
                bit = 1;
            }
            result = result * 2 + bit;
            this.normalize();
        }
        return result;
    }

    bit(model: Uint16Array, index: number): number {
        const probability = model[index]!;
        const bound = Math.floor(this.range / BIT_MODEL_TOTAL) * probability;
        let bit: number;
        if (this.code < bound) {
            model[index] = probability + ((BIT_MODEL_TOTAL - probability) >>> MOVE_BITS);
            this.range = bound;
            bit = 0;
        } else {
            model[index] = probability - (probability >>> MOVE_BITS);
            this.code -= bound;
            this.range -= bound;
            bit = 1;
        }
        this.normalize();
        return bit;
    }

    tree(model: Uint16Array, offset: number, bits: number): number {
        let m = 1;
        for (let i = 0; i < bits; i++) m = (m << 1) + this.bit(model, offset + m);
        return m - (1 << bits);
    }

    reverseTree(model: Uint16Array, offset: number, bits: number): number {
        let m = 1;
        let symbol = 0;
        for (let i = 0; i < bits; i++) {
            const bit = this.bit(model, offset + m);
            m = (m << 1) + bit;
            symbol |= bit << i;
        }
        return symbol;
    }
}

class LengthDecoder {
    private readonly choice = probs(2);
    private readonly low = probs(POS_BITS_MAX << 4 << 3);
    private readonly mid = probs(POS_BITS_MAX << 4 << 3);
    private readonly high = probs(1 << 8);

    decode(rc: RangeDecoder, posState: number): number {
        if (rc.bit(this.choice, 0) === 0) return rc.tree(this.low, posState << 3, 3);
        if (rc.bit(this.choice, 1) === 0) return 8 + rc.tree(this.mid, posState << 3, 3);
        return 16 + rc.tree(this.high, 0, 8);
    }
}

/**
 * Decodes a raw LZMA stream into exactly size bytes. props is the 5-byte
 * header: the lc, lp and pb parameters in one byte, then the dictionary size.
 */
export function decodeLzma(props: Uint8Array, input: Uint8Array, start: number, size: number): Uint8Array {
    let d = props[0]!;
    if (d >= 9 * 5 * 5) throw new LzmaError('The LZMA parameters are not valid.');
    const lc = d % 9;
    d = Math.floor(d / 9);
    const lp = d % 5;
    const pb = Math.floor(d / 5);

    const out = new Uint8Array(size);
    const rc = new RangeDecoder(input, start);
    const literals = probs(0x300 << (lc + lp));
    const posSlot = probs(NUM_LEN_TO_POS_STATES << 6);
    const posDecoders = probs(1 + NUM_FULL_DISTANCES - END_POS_MODEL_INDEX);
    const align = probs(1 << NUM_ALIGN_BITS);
    const isMatch = probs(NUM_STATES << POS_BITS_MAX);
    const isRep = probs(NUM_STATES);
    const isRepG0 = probs(NUM_STATES);
    const isRepG1 = probs(NUM_STATES);
    const isRepG2 = probs(NUM_STATES);
    const isRep0Long = probs(NUM_STATES << POS_BITS_MAX);
    const lengths = new LengthDecoder();
    const repLengths = new LengthDecoder();
    const pbMask = (1 << pb) - 1;
    const lpMask = (1 << lp) - 1;

    let pos = 0;
    let state = 0;
    let rep0 = 0;
    let rep1 = 0;
    let rep2 = 0;
    let rep3 = 0;

    const byteAt = (distance: number) => out[pos - distance - 1]!;

    while (pos < size) {
        const posState = pos & pbMask;
        if (rc.bit(isMatch, (state << POS_BITS_MAX) + posState) === 0) {
            const previous = pos > 0 ? out[pos - 1]! : 0;
            const base = 0x300 * (((pos & lpMask) << lc) + (previous >>> (8 - lc)));
            let symbol = 1;
            if (state >= 7) {
                // After a match, the byte the match would continue with guides the literal.
                let matchByte = byteAt(rep0);
                do {
                    const matchBit = (matchByte >>> 7) & 1;
                    matchByte <<= 1;
                    const bit = rc.bit(literals, base + ((1 + matchBit) << 8) + symbol);
                    symbol = (symbol << 1) | bit;
                    if (matchBit !== bit) break;
                } while (symbol < 0x100);
            }
            while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(literals, base + symbol);
            out[pos++] = symbol - 0x100;
            state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
            continue;
        }

        let length: number;
        if (rc.bit(isRep, state) !== 0) {
            if (pos === 0) throw new LzmaError('The LZMA data is damaged.');
            if (rc.bit(isRepG0, state) === 0) {
                if (rc.bit(isRep0Long, (state << POS_BITS_MAX) + posState) === 0) {
                    state = state < 7 ? 9 : 11;
                    out[pos] = byteAt(rep0);
                    pos++;
                    continue;
                }
            } else {
                let distance: number;
                if (rc.bit(isRepG1, state) === 0) {
                    distance = rep1;
                } else {
                    if (rc.bit(isRepG2, state) === 0) {
                        distance = rep2;
                    } else {
                        distance = rep3;
                        rep3 = rep2;
                    }
                    rep2 = rep1;
                }
                rep1 = rep0;
                rep0 = distance;
            }
            length = repLengths.decode(rc, posState);
            state = state < 7 ? 8 : 11;
        } else {
            rep3 = rep2;
            rep2 = rep1;
            rep1 = rep0;
            length = lengths.decode(rc, posState);
            state = state < 7 ? 7 : 10;

            const lenState = Math.min(length, NUM_LEN_TO_POS_STATES - 1);
            const slot = rc.tree(posSlot, lenState << 6, 6);
            if (slot < 4) {
                rep0 = slot;
            } else {
                const directBits = (slot >>> 1) - 1;
                let distance = (2 | (slot & 1)) * 2 ** directBits;
                if (slot < END_POS_MODEL_INDEX) {
                    distance += rc.reverseTree(posDecoders, distance - slot, directBits);
                } else {
                    distance += rc.directBits(directBits - NUM_ALIGN_BITS) * 2 ** NUM_ALIGN_BITS;
                    distance += rc.reverseTree(align, 0, NUM_ALIGN_BITS);
                }
                rep0 = distance;
            }
            // The largest distance marks the end of a stream that says so.
            if (rep0 === 0xffffffff) break;
        }

        length += MATCH_MIN_LEN;
        if (rep0 >= pos) throw new LzmaError('The LZMA data is damaged.');
        const end = Math.min(pos + length, size);
        while (pos < end) {
            out[pos] = byteAt(rep0);
            pos++;
        }
    }
    if (pos !== size) throw new LzmaError('The LZMA data ended early.');
    return out;
}
