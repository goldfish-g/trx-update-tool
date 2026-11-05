import { unzipSync, gunzipSync } from 'fflate';
import { GOLD_MARKER } from './basegame.ts';
import { decodeLzma } from './lzma.ts';
import type { MappedFile, Language } from './types.ts';

const LEVEL_EXTS = ['.phd', '.tr2', '.psx', '.tub'];
const MUSIC_EXTS = ['.flac', '.ogg', '.mp3', '.wav', '.wma'];
const SFX_EXTS   = ['.sfx'];
const FMV_EXTS   = ['.mp4', '.rpl', '.ogv', '.avi', '.fmv'];
const AUDIO_EXTS = ['.wad'];
const REMASTER_SKIP_EXTS = ['.trg', '.dds', '.trm', '.pdp', '.map', '.tex'];
const ROOT_MARKERS = ['data', 'datag', 'fmv', 'music', 'audio', 'cuts', 'tracks', 'sfx'];

const LANG_NAMES: Record<string, string> = {
    de: 'German',   en: 'English',  es: 'Spanish',
    fr: 'French',   it: 'Italian',  ja: 'Japanese',
    ru: 'Russian',
};

function getExt(path: string): string {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.substring(dot) : '';
}

function hasExt(ext: string, list: string[]): boolean {
    for (let i = 0; i < list.length; i++) {
        if (ext === list[i]) return true;
    }
    return false;
}

const ZIP_METHOD_LZMA = 14;

// Reads the entries fflate cannot inflate, compressed with LZMA as 7-Zip
// writes them, straight from the central directory.
function extractLzmaEntries(data: Uint8Array, names: Set<string>): MappedFile[] {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let end = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('The zip archive is damaged: its directory is missing.');

    let count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const locator = end - 20;
    if (locator >= 0 && view.getUint32(locator, true) === 0x07064b50) {
        const zip64 = Number(view.getBigUint64(locator + 8, true));
        count = Number(view.getBigUint64(zip64 + 32, true));
        at = Number(view.getBigUint64(zip64 + 48, true));
    }

    const decoder = new TextDecoder();
    const entries: MappedFile[] = [];
    for (let i = 0; i < count; i++) {
        let compressedSize = view.getUint32(at + 20, true);
        let size = view.getUint32(at + 24, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        let localOffset = view.getUint32(at + 42, true);
        const name = decoder.decode(data.subarray(at + 46, at + 46 + nameLength));

        // Sizes and offsets past 4 GB live in the ZIP64 extra field.
        let extra = at + 46 + nameLength;
        const extraEnd = extra + extraLength;
        while (extra + 4 <= extraEnd) {
            const id = view.getUint16(extra, true);
            let field = extra + 4;
            if (id === 0x0001) {
                if (size === 0xffffffff) { size = Number(view.getBigUint64(field, true)); field += 8; }
                if (compressedSize === 0xffffffff) { compressedSize = Number(view.getBigUint64(field, true)); field += 8; }
                if (localOffset === 0xffffffff) { localOffset = Number(view.getBigUint64(field, true)); }
            }
            extra += 4 + view.getUint16(extra + 2, true);
        }
        at = extraEnd + commentLength;
        if (!names.has(name)) continue;

        // A version, the length of the properties, the properties, then the stream.
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const propsSize = view.getUint16(start + 2, true);
        const props = data.subarray(start + 4, start + 4 + propsSize);
        const stream = data.subarray(start, start + compressedSize);
        entries.push({ path: name, data: decodeLzma(props, stream, 4 + propsSize, size) });
    }
    return entries;
}

function extractZip(data: Uint8Array): MappedFile[] {
    const entries: MappedFile[] = [];
    const lzmaNames = new Set<string>();
    const decompressed = unzipSync(data, {
        filter: (file) => {
            if (file.compression !== ZIP_METHOD_LZMA) return true;
            lzmaNames.add(file.name);
            return false;
        },
    });
    const keys = Object.keys(decompressed);
    for (let i = 0; i < keys.length; i++) {
        const path = keys[i];
        if (path.endsWith('/')) continue;
        entries.push({ path: path, data: decompressed[path] });
    }
    if (lzmaNames.size > 0) {
        const lzmaEntries = extractLzmaEntries(data, lzmaNames);
        for (let i = 0; i < lzmaEntries.length; i++) {
            if (!lzmaEntries[i].path.endsWith('/')) entries.push(lzmaEntries[i]);
        }
    }
    return entries;
}

function extractTarGz(data: Uint8Array): MappedFile[] {
    const tarData = gunzipSync(data);
    return parseTar(tarData);
}

function tarString(data: Uint8Array, offset: number, len: number): string {
    let s = '';
    for (let i = 0; i < len; i++) {
        if (data[offset + i] === 0) break;
        s += String.fromCharCode(data[offset + i]);
    }
    return s;
}

function tarOctal(data: Uint8Array, offset: number, len: number): number {
    const s = tarString(data, offset, len).trim();
    return parseInt(s, 8) || 0;
}

function parseTar(data: Uint8Array): MappedFile[] {
    const entries: MappedFile[] = [];
    let offset = 0;

    while (offset + 512 <= data.length) {
        let allZero = true;
        for (let i = 0; i < 512; i++) {
            if (data[offset + i] !== 0) { allZero = false; break; }
        }
        if (allZero) break;

        let name = tarString(data, offset, 100);
        const size = tarOctal(data, offset + 124, 12);
        const typeFlag = data[offset + 156];
        const prefix = tarString(data, offset + 345, 155);

        if (prefix) name = prefix + '/' + name;

        offset += 512;

        if ((typeFlag === 0 || typeFlag === 48) && size > 0) {
            const fileData = data.slice(offset, offset + size);
            entries.push({ path: name, data: fileData });
        }

        offset += Math.ceil(size / 512) * 512;
    }

    return entries;
}

function detectRoot(entries: MappedFile[]): string {
    const candidates: Record<string, number> = {};
    for (let i = 0; i < entries.length; i++) {
        const path = entries[i].path.replace(/\\/g, '/');
        const parts = path.toLowerCase().split('/');
        for (let j = 0; j < parts.length - 1; j++) {
            for (let k = 0; k < ROOT_MARKERS.length; k++) {
                if (parts[j] === ROOT_MARKERS[k]) {
                    let root = path.split('/').slice(0, j).join('/');
                    if (root) root += '/';
                    candidates[root] = (candidates[root] || 0) + 1;
                }
            }
        }
    }

    let bestRoot = '';
    let bestCount = 0;
    const keys = Object.keys(candidates);
    for (let i = 0; i < keys.length; i++) {
        if (candidates[keys[i]] > bestCount) {
            bestCount = candidates[keys[i]];
            bestRoot = keys[i];
        }
    }

    return bestRoot;
}

function classifyFile(lowerPath: string, _originalRelPath: string, modId: string): string | null {
    const ext = getExt(lowerPath);
    const lowerBase = lowerPath.split('/').pop()!;
    const prefix = 'games/' + modId + '/';

    if (hasExt(ext, REMASTER_SKIP_EXTS)) {
        return null;
    }

    // A package already laid out for TRX keeps its tree: its gameflow,
    // strings, catalogs, scripts, images and injections.
    const laidOut = /^games\/[^/]+\/(.+)$/.exec(lowerPath);
    if (laidOut) {
        return prefix + laidOut[1];
    }

    // Lua outside a game directory is either the engine's own or, before
    // TRX 1.10, a module a script required by its path. Which one depends on
    // the TRX the game was made for, so the scripts step decides.
    if (ext === '.lua') {
        return prefix + '_loose/' + lowerPath;
    }

    if (hasExt(ext, LEVEL_EXTS)) {
        const inCutsDir = lowerPath.indexOf('cuts/') === 0;
        if (inCutsDir) {
            return prefix + 'cuts/' + lowerBase;
        }
        return prefix + 'levels/' + lowerBase;
    }

    if (hasExt(ext, SFX_EXTS)) {
        return prefix + lowerBase;
    }

    if (hasExt(ext, MUSIC_EXTS)) {
        return prefix + 'music/' + lowerBase;
    }

    if (hasExt(ext, FMV_EXTS)) {
        return prefix + 'fmv/' + lowerBase;
    }

    if (hasExt(ext, AUDIO_EXTS)) {
        return prefix + 'audio/' + lowerBase;
    }

    if (ext === '.json5'
        && (lowerPath.indexOf('/') === -1
            || /^cfg\/tr\d-level\//.test(lowerPath))) {
        return prefix + lowerBase;
    }
    if (ext === '.json5' && lowerBase === 'gameflow.json5'
        && /^cfg\/tr\d\//.test(lowerPath)) {
        return prefix + '_meta/fullgameflow.json5';
    }
    // The outfits the engine the game shipped with read, which its levels may
    // have been built against.
    if (lowerPath === 'cfg/outfits.json5') {
        return prefix + '_meta/outfits.json5';
    }

    if (ext === '.bin') {
        if (lowerPath.indexOf('injections/') !== -1) {
            return prefix + 'injections/' + lowerBase;
        }
        return prefix + lowerBase;
    }

    if (ext === '.webp' || ext === '.png' || ext === '.jpg'
        || ext === '.bmp' || ext === '.pcx') {
        return prefix + 'images/' + lowerBase;
    }

    if (lowerBase === 'tombpc.dat') {
        return prefix + lowerBase;
    }

    return null;
}

function relativePath(rawPath: string, root: string): string {
    let relPath = rawPath;
    if (root && relPath.toLowerCase().indexOf(root.toLowerCase()) === 0) {
        relPath = relPath.substring(root.length);
    }
    return relPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function mapFiles(entries: MappedFile[], modId: string): MappedFile[] {
    const root = detectRoot(entries);
    // Tomb Raider III Community Edition plays The Lost Artifact from datag/
    // and pixg/, in place of data/ and pix/. A game laid out that way is the
    // expansion, and those are its files.
    const gold = entries.some((e) => /^datag\//i.test(relativePath(e.path, root)));

    const mapped: MappedFile[] = [];
    const depths: number[] = [];
    for (let i = 0; i < entries.length; i++) {
        const rawPath = entries[i].path;
        const data = entries[i].data;

        let relPath = relativePath(rawPath, root);
        if (gold) {
            if (/^(data|pix)\//i.test(relPath)) continue;
            relPath = relPath.replace(/^datag\//i, 'data/').replace(/^pixg\//i, 'pix/');
        }
        const lowerPath = relPath.toLowerCase();

        if (!relPath || data.byteLength === 0) continue;

        const vfsPath = classifyFile(lowerPath, relPath, modId);
        if (vfsPath) {
            mapped.push({ path: vfsPath, data: data });
            depths.push(relPath.split('/').length);
        }
    }

    // Files that land on the same path, such as a script and its copies in
    // language folders, leave the one nearest the top.
    const nearest: Record<string, number> = {};
    for (let i = 0; i < mapped.length; i++) {
        const seen = nearest[mapped[i].path];
        if (seen === undefined || depths[i] < depths[seen]) nearest[mapped[i].path] = i;
    }
    const out = mapped.filter(function(_file, i) { return nearest[mapped[i].path] === i; });
    if (gold) out.push({ path: `games/${modId}/${GOLD_MARKER}`, data: new Uint8Array([1]) });
    return out;
}

export function stripRemasteredSFXHeader(data: Uint8Array): Uint8Array {
    if (data.length >= 4
        && data[0] === 0x52 && data[1] === 0x49
        && data[2] === 0x46 && data[3] === 0x46) {
        return data;
    }
    for (let i = 2; i <= data.length - 4; i += 2) {
        if (data[i]     === 0x52 && data[i + 1] === 0x49
            && data[i + 2] === 0x46 && data[i + 3] === 0x46) {
            return data.slice(i);
        }
    }
    return data;
}

export function detectAudioLanguages(entries: MappedFile[]): Language[] {
    const found: Record<string, boolean> = {};
    for (let i = 0; i < entries.length; i++) {
        const path = entries[i].path.replace(/\\/g, '/').toLowerCase();
        const m = path.match(/(?:^|\/)tracks\/([a-z]{2})\//);
        if (m) {
            found[m[1]] = true;
        }
    }
    const codes = Object.keys(found);
    if (codes.length <= 1) return [];
    codes.sort();
    return codes.map(function (c) {
        return { code: c, name: LANG_NAMES[c] || c.toUpperCase() };
    });
}

export function filterByLanguage(entries: MappedFile[], lang: string): MappedFile[] {
    const lowerLang = lang.toLowerCase();
    const filtered: MappedFile[] = [];
    for (let i = 0; i < entries.length; i++) {
        const path = entries[i].path.replace(/\\/g, '/').toLowerCase();
        const m = path.match(/(?:^|\/)(sfx|tracks)\/([a-z]{2})\//);
        if (m) {
            if (m[2] === lowerLang) {
                filtered.push(entries[i]);
            }
        } else {
            filtered.push(entries[i]);
        }
    }
    return filtered;
}

export function extractArchive(data: Uint8Array, filename: string): MappedFile[] {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.zip')) {
        return extractZip(data);
    } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        return extractTarGz(data);
    }
    throw new Error('Unsupported archive format: ' + filename);
}

export function processFiles(
    entries: MappedFile[],
    modId: string,
): { mapped: MappedFile[]; languages: Language[] } {
    const languages = detectAudioLanguages(entries);

    const mapped = mapFiles(entries, modId);

    for (let i = 0; i < mapped.length; i++) {
        if (hasExt(getExt(mapped[i].path), SFX_EXTS)) {
            mapped[i].data = stripRemasteredSFXHeader(mapped[i].data);
        }
    }

    return { mapped, languages };
}
