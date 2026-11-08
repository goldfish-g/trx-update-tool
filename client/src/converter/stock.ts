// The files TRX has shipped, known by their contents (history.generated.ts).
//
// Level builders copy TRX's own files into their games, and some rename them
// as they do (bin_font.bin for font.bin, say). A copy is a copy under any
// name: it gets what the current TRX ships under the name TRX gave it, as a
// copy left under its own name does.

import { BASE_INJECTIONS } from '../templates/base/index.ts';
import { STOCK_BLOBS } from './history.generated.ts';
import type { MappedFile } from './types.ts';

const encoder = new TextEncoder();

function baseName(path: string): string {
    return path.split('/').pop()!.toLowerCase();
}

/** Injections TRX has renamed since older engines named them. */
const RENAMED_INJECTIONS: Record<string, string> = {
    'purple_crystal.bin': 'crystal.bin',
};

/** The name the current TRX knows an injection by. */
export function currentInjectionName(name: string): string {
    return RENAMED_INJECTIONS[name.toLowerCase()] ?? name;
}

/** The id git gives a file's contents, cut to the 16 hex digits STOCK_BLOBS keeps. */
async function blobId(data: Uint8Array): Promise<string> {
    const head = encoder.encode(`blob ${data.length}\0`);
    const all = new Uint8Array(head.length + data.length);
    all.set(head);
    all.set(data, head.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether a file is one TRX shipped under its name, unchanged. */
export async function isStock(file: MappedFile): Promise<boolean> {
    const known = STOCK_BLOBS[baseName(file.path)];
    if (!known) return false;
    return known.includes(await blobId(file.data));
}

let injectionsByBlob: Map<string, string[]> | null = null;

/** Every name TRX shipped an injection under, by the blob id of each of its versions. */
function injectionNames(): Map<string, string[]> {
    if (injectionsByBlob) return injectionsByBlob;
    injectionsByBlob = new Map();
    for (const [name, blobs] of Object.entries(STOCK_BLOBS)) {
        if (!name.endsWith('.bin')) continue;
        for (const blob of blobs) {
            const names = injectionsByBlob.get(blob);
            if (names) names.push(name);
            else injectionsByBlob.set(blob, [name]);
        }
    }
    return injectionsByBlob;
}

/**
 * The game's injections that are copies of TRX's own, with the name TRX
 * shipped each under: its own name where TRX shipped it under that, else the
 * one the current TRX ships for the game, else any.
 */
export async function stockInjections(files: MappedFile[], prefix: string, gameVersion: number): Promise<Map<MappedFile, string>> {
    const current = BASE_INJECTIONS[`tr${gameVersion}`] ?? [];
    const stock = new Map<MappedFile, string>();
    for (const file of files) {
        if (!file.path.startsWith(prefix) || !file.path.toLowerCase().endsWith('.bin')) continue;
        const names = injectionNames().get(await blobId(file.data));
        if (!names) continue;
        const own = baseName(file.path);
        const name = names.includes(own) ? own : names.find((other) => current.includes(other)) ?? names[0];
        if (name !== undefined) stock.set(file, name);
    }
    return stock;
}
