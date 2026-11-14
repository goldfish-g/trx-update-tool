// The pictures a game shows for screens of other shapes. TRX looks for a
// picture's file in images/, and then beside it for a directory named after
// a screen shape, such as 4x3/ or 3x2/, holding a file of the same name; it
// shows whichever suits the player's screen best, the one in images/ counting
// as 16:9 (output/overlay.c, M_ImageCandidates_Scan). TRX installs its own
// pictures that way, and a game laid out as a whole TRX brings them along.
// A builder who drew their own loading screens in place of TRX's in images/
// and left TRX's in 4x3/ saw their own on their screen, and a player on a
// squarer one would see TRX's instead. Those of TRX's go, so the builder's
// show on every screen.

import { isStockPicture } from './stock.ts';
import type { MappedFile } from './types.ts';

/** A directory TRX reads as a screen shape: sscanf(entry, "%dx%d"). */
const SHAPE_DIR = /^\d+x\d+/;

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
