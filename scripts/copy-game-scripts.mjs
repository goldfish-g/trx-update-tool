// Copies the game scripts TRX ships for TR1, TR2 and TR3 into
// client/src/converter/lua/base, where the converter finds them.
//
// A converted game that brings a game script of its own replaces the one of
// the game it extends, which is where TRX sets up the interface, the water
// colors and the save crystals. The converter runs both, so it needs the
// shipped one as it stands in the TRX the game will run on.
//
// Usage: node scripts/copy-game-scripts.mjs [path to TRX]

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const trx = process.argv[2] ?? '../TRX';
const out = 'client/src/converter/lua/base';
mkdirSync(out, { recursive: true });
for (const game of ['tr1', 'tr2', 'tr3']) {
    copyFileSync(join(trx, 'data/trx/ship/games', game, 'scripts/_game.lua'), join(out, `${game}_game.lua`));
}
console.log(`copied the TR1-3 game scripts into ${out}`);
