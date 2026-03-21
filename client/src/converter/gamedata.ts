import { unzipSync, gunzipSync } from 'fflate';
import type { MappedFile, Language } from './types.ts';

const LEVEL_EXTS = ['.phd', '.tr2', '.psx', '.tub'];
const MUSIC_EXTS = ['.flac', '.ogg', '.mp3', '.wav', '.wma'];
const SFX_EXTS   = ['.sfx'];
const FMV_EXTS   = ['.mp4', '.rpl', '.ogv', '.avi', '.fmv'];
const AUDIO_EXTS = ['.wad'];
const REMASTER_SKIP_EXTS = ['.trg', '.dds', '.trm', '.pdp', '.map', '.tex'];
const ROOT_MARKERS = ['data', 'fmv', 'music', 'audio', 'cuts', 'tracks', 'sfx'];

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

function extractZip(data: Uint8Array): MappedFile[] {
    const entries: MappedFile[] = [];
    const decompressed = unzipSync(data);
    const keys = Object.keys(decompressed);
    for (let i = 0; i < keys.length; i++) {
        const path = keys[i];
        if (path.endsWith('/')) continue;
        entries.push({ path: path, data: decompressed[path] });
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

function mapFiles(entries: MappedFile[], modId: string): MappedFile[] {
    const root = detectRoot(entries);

    const mapped: MappedFile[] = [];
    for (let i = 0; i < entries.length; i++) {
        const rawPath = entries[i].path;
        const data = entries[i].data;

        let relPath = rawPath;
        if (root && relPath.toLowerCase().indexOf(root.toLowerCase()) === 0) {
            relPath = relPath.substring(root.length);
        }

        relPath = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
        const lowerPath = relPath.toLowerCase();

        if (!relPath || data.byteLength === 0) continue;

        const vfsPath = classifyFile(lowerPath, relPath, modId);
        if (vfsPath) {
            mapped.push({ path: vfsPath, data: data });
        }
    }

    return mapped;
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
