// Which of TRX's games a converted game is closest to: TR1, TR2, TR3, or
// TR3's expansion, The Lost Artifact.
//
// The Lost Artifact is told apart in two ways. Tomb Raider III Community
// Edition runs it with its `gold` switch, reading the script, levels and
// sound from datag/ and the pictures from pixg/, where the main game uses
// data/ and pix/; the archive mapping marks a game laid out that way. A game
// made for the 1999 standalone release has none of that, but its script still
// names the expansion's levels.
//
// A converted game always extends tr1, tr2 or tr3: TRX resolves a game's
// files through the game it extends and no further, and tr3-la carries no
// catalogs or injections of its own. What sets the expansion apart is
// applied in the converted game itself.

import tr1GameScript from './lua/base/tr1_game.lua?raw';
import tr2GameScript from './lua/base/tr2_game.lua?raw';
import tr3GameScript from './lua/base/tr3_game.lua?raw';
import tr3LaGameScript from './lua/base/tr3-la_game.lua?raw';
import { parseTR2Script } from './tombpc.ts';
import type { MappedFile } from './types.ts';

/** Written by the archive mapping for a game laid out for Gold mode. */
export const GOLD_MARKER = '_meta/lost_artifact';

const LOST_ARTIFACT_LEVELS = new Set(['scotland', 'willsden', 'chunnel', 'undersea', 'zoo', 'slinc']);
const TR3_LEVELS = new Set([
    'jungle', 'temple', 'quadchas', 'tonyboss', 'shore', 'crash', 'rapids', 'triboss', 'roofs', 'sewer',
    'tower', 'office', 'nevada', 'compound', 'area51', 'antarc', 'mines', 'city', 'chamber',
]);

export type BaseGame = {
    /** tr1, tr2, tr3 or tr3-la. */
    key: string;
    /** The game it extends: tr1, tr2 or tr3. */
    extends: string;
    /** The game script TRX ships for it. */
    gameScript: string;
    lostArtifact: boolean;
};

export function baseGame(files: MappedFile[], modDir: string, gameVersion: number): BaseGame {
    const prefix = `games/${modDir}/`;
    let lostArtifact = false;
    if (gameVersion === 3) {
        if (files.some((f) => f.path === prefix + GOLD_MARKER)) {
            lostArtifact = true;
        } else {
            const tombpc = files.find((f) => f.path === prefix + 'tombpc.dat');
            const names = tombpc ? parseTR2Script(tombpc.data, 3)?.filenames ?? [] : [];
            const stems = names.map((n) => n.replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.[^.]+$/, ''));
            lostArtifact = stems.some((s) => LOST_ARTIFACT_LEVELS.has(s)) && !stems.some((s) => TR3_LEVELS.has(s));
        }
    }
    const scripts: Record<number, string> = { 1: tr1GameScript, 2: tr2GameScript, 3: tr3GameScript };
    return {
        key: lostArtifact ? 'tr3-la' : `tr${gameVersion}`,
        extends: `tr${gameVersion}`,
        gameScript: lostArtifact ? tr3LaGameScript : scripts[gameVersion] ?? '',
        lostArtifact,
    };
}
