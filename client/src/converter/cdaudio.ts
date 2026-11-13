// The soundtrack of a TR2 game in one file: audio/cdaudio.mp3 (or .wav) and
// the cdaudio.dat that says where each track starts and ends in it, in
// milliseconds, as PaulD's CD audio patch and TR2Main play it in place of
// the CD (modding/cd_pauld.cpp, by the track Music_GetRealTrack gives). TRX
// reads the pair too, but only where no music directory exists, and a
// player who owns TR2 has one for the game a converted one extends; then
// the game's own soundtrack would never play. So each track becomes a file
// of its own, music/<track>.mp3 or .wav, cut at the MP3's frame boundaries
// or the WAV's samples, which TRX plays first wherever it is.

import type { MappedFile } from './types.ts';

type Range = { track: number; from: number; to: number };

/** The tracks cdaudio.dat lists, as PaulD's patch read them: "<track> <from ms> <to ms>", tracks 1 to 60. */
export function parseCdAudioDat(text: string): Range[] {
    const tracks: Range[] = [];
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)/.exec(line);
        if (!m) continue;
        const track = +m[1]!;
        if (track > 0 && track <= 60) tracks.push({ track, from: +m[2]!, to: +m[3]! });
    }
    tracks.sort((a, b) => a.track - b.track);
    // A track that ends where it starts runs to the next one, as TRX reads it.
    for (let i = 0; i < tracks.length; i++) {
        if (tracks[i]!.to <= tracks[i]!.from && i + 1 < tracks.length) tracks[i]!.to = tracks[i + 1]!.from;
    }
    return tracks.filter((t) => t.to > t.from);
}

const BITRATES: Record<string, number[]> = {
    // MPEG-1 Layer III, and MPEG-2/2.5 Layer III, in kbit/s by index.
    v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

type Frame = { at: number; ms: number };

/** The MPEG Layer III frames of an MP3, each with where it starts in the file and in time. */
function mp3Frames(data: Uint8Array): Frame[] {
    let i = 0;
    // An ID3v2 tag: "ID3", version, flags, and a size of 7-bit bytes.
    if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33 && data.length > 10) {
        i = 10 + ((data[6]! << 21) | (data[7]! << 14) | (data[8]! << 7) | data[9]!);
    }
    const frames: Frame[] = [];
    let ms = 0;
    while (i + 4 <= data.length) {
        const b1 = data[i + 1]!;
        const b2 = data[i + 2]!;
        if (data[i] !== 0xff || (b1 & 0xe0) !== 0xe0) {
            i++;
            continue;
        }
        const version = (b1 >> 3) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
        const layer = (b1 >> 1) & 3; // 1: Layer III
        const bitrate = (version === 3 ? BITRATES.v1! : BITRATES.v2!)[(b2 >> 4) & 15]!;
        const rate = SAMPLE_RATES[version]?.[(b2 >> 2) & 3];
        if (version === 1 || layer !== 1 || bitrate === 0 || rate === undefined) {
            i++;
            continue;
        }
        const padding = (b2 >> 1) & 1;
        const samples = version === 3 ? 1152 : 576;
        const length = Math.floor((samples / 8) * bitrate * 1000 / rate) + padding;
        frames.push({ at: i, ms });
        ms += (samples * 1000) / rate;
        i += length;
    }
    return frames;
}

/** Each listed track of an MP3 soundtrack, cut at the frames its range covers. */
function splitMp3(data: Uint8Array, tracks: Range[]): Map<number, Uint8Array> {
    const frames = mp3Frames(data);
    const out = new Map<number, Uint8Array>();
    if (frames.length === 0) return out;
    const end = (index: number) => (index < frames.length ? frames[index]!.at : data.length);
    for (const { track, from, to } of tracks) {
        const first = frames.findIndex((f) => f.ms >= from);
        if (first < 0) continue;
        let last = frames.findIndex((f) => f.ms >= to);
        if (last < 0) last = frames.length;
        if (last <= first) continue;
        out.set(track, data.slice(frames[first]!.at, end(last)));
    }
    return out;
}

/** Each listed track of a WAV soundtrack, cut at its samples, with a header of its own. */
function splitWav(data: Uint8Array, tracks: Range[]): Map<number, Uint8Array> {
    const out = new Map<number, Uint8Array>();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tag = (at: number) => String.fromCharCode(data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!);
    if (data.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return out;
    let fmt: Uint8Array | null = null;
    let at = 12;
    let pcm: { start: number; size: number } | null = null;
    while (at + 8 <= data.length) {
        const id = tag(at);
        const size = view.getUint32(at + 4, true);
        if (id === 'fmt ') fmt = data.slice(at, at + 8 + size);
        if (id === 'data') pcm = { start: at + 8, size: Math.min(size, data.length - at - 8) };
        at += 8 + size + (size & 1);
    }
    if (fmt === null || pcm === null) return out;
    const fmtView = new DataView(fmt.buffer);
    const rate = fmtView.getUint32(12, true);
    const block = fmtView.getUint16(20, true);
    if (rate === 0 || block === 0) return out;
    for (const { track, from, to } of tracks) {
        const a = Math.min(pcm.size, Math.floor((from * rate) / 1000) * block);
        const b = Math.min(pcm.size, Math.floor((to * rate) / 1000) * block);
        if (b <= a) continue;
        const file = new Uint8Array(12 + fmt.length + 8 + (b - a));
        const w = new DataView(file.buffer);
        file.set([0x52, 0x49, 0x46, 0x46], 0);
        w.setUint32(4, file.length - 8, true);
        file.set([0x57, 0x41, 0x56, 0x45], 8);
        file.set(fmt, 12);
        file.set([0x64, 0x61, 0x74, 0x61], 12 + fmt.length);
        w.setUint32(16 + fmt.length, b - a, true);
        file.set(data.subarray(pcm.start + a, pcm.start + b), 20 + fmt.length);
        out.set(track, file);
    }
    return out;
}

/**
 * Splits a game's cdaudio.mp3 or cdaudio.wav into music/<track> files by its
 * cdaudio.dat, in place of the pair. For a game made for the original engine
 * (`soundtrackFirst`) a track the soundtrack holds takes the place of a file
 * of the same number: the patches that played the pair read nothing else.
 * TRX and TR2X played a game's own track files first, so for a game made
 * for them the soundtrack fills in only the tracks those leave out.
 */
export function splitCdAudio(files: MappedFile[], modDir: string, soundtrackFirst: boolean): { files: MappedFile[]; notes: string[] } {
    const prefix = `games/${modDir}/`;
    const find = (name: string) => files.find((f) => f.path.startsWith(prefix) && f.path.toLowerCase().endsWith('/' + name)
        && /^(music|audio)\//.test(f.path.slice(prefix.length).toLowerCase()));
    const dat = find('cdaudio.dat');
    const mp3 = find('cdaudio.mp3');
    const wav = find('cdaudio.wav');
    const audio = mp3 ?? wav;
    if (!dat || !audio) return { files, notes: [] };
    const tracks = parseCdAudioDat(new TextDecoder().decode(dat.data));
    const cut = audio === mp3 ? splitMp3(audio.data, tracks) : splitWav(audio.data, tracks);
    if (cut.size === 0) return { files, notes: [] };
    const ext = audio === mp3 ? 'mp3' : 'wav';
    const own = new Set<number>();
    for (const f of files) {
        const m = f.path.startsWith(prefix) ? /^music\/0*(\d+)\.[a-z0-9]+$/i.exec(f.path.slice(prefix.length)) : null;
        if (m) own.add(+m[1]!);
    }
    if (!soundtrackFirst) for (const track of own) cut.delete(track);
    if (cut.size === 0) return { files, notes: [] };
    const replaced = (f: MappedFile) => {
        const m = /^music\/0*(\d+)\.[a-z0-9]+$/i.exec(f.path.slice(prefix.length));
        return m !== null && cut.has(+m[1]!);
    };
    const out = files.filter((f) => f !== dat && f !== audio && !(f.path.startsWith(prefix) && replaced(f)));
    for (const [track, data] of [...cut].sort((a, b) => a[0] - b[0])) {
        out.push({ path: `${prefix}music/${track}.${ext}`, data });
    }
    return {
        files: out,
        notes: [`Split its soundtrack (${audio.path.split('/').pop()}, by cdaudio.dat) into its ${cut.size} tracks, which TRX plays whatever else is installed.`],
    };
}
