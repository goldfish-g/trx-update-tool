// The pictures a game shows, as the builder's own TRX showed them.
//
// Screen shapes. TRX looks for a picture's file in images/, and then beside
// it for a directory named after a screen shape, such as 4x3/ or 3x2/,
// holding a file of the same name; it shows whichever suits the player's
// screen best, the one in images/ counting as 16:9 (output/overlay.c,
// M_ImageCandidates_Scan). TRX installs its own pictures that way, and a game
// laid out as a whole TRX brings them along. A builder who drew their own
// loading screens in place of TRX's in images/ and left TRX's in 4x3/ saw
// their own on their screen, and a player on a squarer one would see TRX's
// instead. Those of TRX's go, so the builder's show on every screen.
//
// Pictures the builder's install lacks. A game laid out as a whole TRX is its
// own install: its TRX looks a picture up in the game's images/, its base
// game's, data/images/ and its own directory (game/paths.c), all within the
// archive, and where none is found it shows none: a black menu, no loading
// screen. Here the game stands on TRX's own, whose pictures would show in
// their place, so such a name points where no picture is.

import { laidOutGame } from './gamedata.ts';
import { parseJSON5 } from './json5.ts';
import { isStockPicture } from './stock.ts';
import type { MappedFile } from './types.ts';

/** A directory TRX reads as a screen shape: sscanf(entry, "%dx%d"). */
const SHAPE_DIR = /^\d+x\d+/;

/** The extensions TRX tries for a picture in place of its own (game/paths.c, m_ImageExtensions). */
const IMAGE_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.pcx', '.bmp'];

/** Where a picture the builder's install lacks is pointed: no install has this directory. */
export const NO_PICTURE_DIR = 'missing/';

type AnyObj = Record<string, any>;
const isObject = (value: unknown): value is AnyObj => typeof value === 'object' && value !== null && !Array.isArray(value);

export async function keepOwnPictures(files: MappedFile[], modDir: string): Promise<{ files: MappedFile[]; notes: string[] }> {
    const prefix = `games/${modDir}/images/`;
    const pictures = new Map<string, MappedFile>();
    for (const file of files) {
        if (file.path.startsWith(prefix)) pictures.set(file.path.slice(prefix.length).toLowerCase(), file);
    }
    const dropped = new Set<MappedFile>();
    const shapes = new Set<string>();
    for (const [rel, file] of pictures) {
        const parts = rel.split('/');
        if (parts.length !== 2 || !SHAPE_DIR.test(parts[0]!)) continue;
        const main = pictures.get(parts[1]!);
        if (main === undefined || await isStockPicture(main) || !await isStockPicture(file)) continue;
        dropped.add(file);
        shapes.add(parts[0]!);
    }
    if (dropped.size === 0) return { files, notes: [] };
    return {
        files: files.filter((f) => !dropped.has(f)),
        notes: [`Left out ${dropped.size} of TRX's own pictures for other screen shapes (${[...shapes].sort().join(', ')}) that stood beside pictures of the game's own, so its own show on every screen.`],
    };
}

/** Each place in a game flow that names a picture, with the name or names it gives. */
function pictureRefs(flow: AnyObj): { holder: AnyObj; key: string }[] {
    const refs: { holder: AnyObj; key: string }[] = [];
    if (flow.main_menu_picture !== undefined) refs.push({ holder: flow, key: 'main_menu_picture' });
    const entries = [flow.title, ...['levels', 'cutscenes', 'demos'].flatMap((table) => (Array.isArray(flow[table]) ? flow[table] : []))];
    for (const entry of entries) {
        if (!isObject(entry) || !Array.isArray(entry.sequence)) continue;
        for (const event of entry.sequence) {
            if (!isObject(event)) continue;
            if (event.type === 'loading_screen' || event.type === 'display_picture') refs.push({ holder: event, key: 'path' });
            if (event.type === 'total_stats' && event.background_path !== undefined) refs.push({ holder: event, key: 'background_path' });
            if (event.type === 'globe_select' && event.image !== undefined) refs.push({ holder: event, key: 'image' });
        }
    }
    return refs;
}

const namesOf = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).filter((name): name is string => typeof name === 'string' && name !== '');

export function keepMissingPictures(files: MappedFile[], modDir: string, upload: MappedFile[]): string[] {
    const game = laidOutGame(upload);
    if (game === null) return [];
    const norm = (path: string): string => path.replace(/\\/g, '/').toLowerCase();
    const root = norm(game.root);
    const paths = new Set(upload.map((entry) => norm(entry.path)));
    // A game laid out beside its own TRX, not one to drop into the player's.
    if (!paths.has(`${root}trx.exe`)) return [];
    const own = upload.find((entry) => norm(entry.path) === `${root}games/${game.dir}/gameflow.json5`);
    const flowFile = files.find((f) => f.path === `games/${modDir}/gameflow.json5`);
    if (own === undefined || flowFile === undefined) return [];
    let original: unknown;
    let flow: unknown;
    try {
        original = parseJSON5(new TextDecoder().decode(own.data));
        flow = parseJSON5(new TextDecoder().decode(flowFile.data));
    } catch {
        return [];
    }
    if (!isObject(original) || !isObject(flow)) return [];

    // The names the builder's game flow gives: one the conversion added is
    // not the builder's to have left missing.
    const named = new Set(pictureRefs(original).flatMap(({ holder, key }) => namesOf(holder[key])).map(norm));
    const base = isObject(original.meta) && typeof original.meta.extends === 'string' ? norm(original.meta.extends) : null;
    const dirs = [`${root}games/${game.dir}/images/`, ...(base !== null ? [`${root}games/${base}/images/`] : []), `${root}data/images/`, root];
    // TRX finds a file whatever its case, and under its other extensions.
    const installed = (name: string): boolean => {
        const rel = norm(name);
        const stem = rel.replace(/\.[^./]+$/, '');
        return dirs.some((dir) => paths.has(dir + rel) || IMAGE_EXTENSIONS.some((ext) => paths.has(dir + stem + ext)));
    };

    const missing = new Set<string>();
    for (const { holder, key } of pictureRefs(flow)) {
        const names = namesOf(holder[key]);
        if (names.length === 0 || names.some((name) => !named.has(norm(name)) || installed(name))) continue;
        if (names.every((name) => name.startsWith(NO_PICTURE_DIR))) continue;
        holder[key] = NO_PICTURE_DIR + names[0];
        missing.add(names[0]!);
    }
    if (missing.size === 0) return [];
    flowFile.data = new TextEncoder().encode(JSON.stringify(flow, null, 4));
    const list = [...missing].sort();
    return [`Left ${list.length === 1 ? 'the picture' : 'the pictures'} its game flow names and its own TRX lacks (${list.join(', ')}) missing, so it shows none there, as on the builder's computer, rather than TRX's own.`];
}
