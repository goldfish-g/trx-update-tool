// Copies the files the converter takes as TRX ships them:
//
// - the game scripts of TR1, TR2 and TR3, into client/src/converter/lua/base.
//   A converted game that brings a game script of its own replaces the one of
//   the game it extends, which is where TRX sets up the interface, the water
//   colors and the save crystals, so the converter runs both.
// - cfg/outfits.json5, into client/src/templates/cfg. A game's outfits file
//   replaces the shipped one, so the outfit made of a level's own meshes is
//   written beside the shipped outfits as they stand.
//
// Usage: node scripts/copy-trx-files.mjs [path to TRX]

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const trx = process.argv[2] ?? '../TRX';
const ship = join(trx, 'data/trx/ship');

const scripts = 'client/src/converter/lua/base';
mkdirSync(scripts, { recursive: true });
for (const game of ['tr1', 'tr2', 'tr3']) {
    copyFileSync(join(ship, 'games', game, 'scripts/_game.lua'), join(scripts, `${game}_game.lua`));
}
copyFileSync(join(ship, 'cfg/outfits.json5'), 'client/src/templates/cfg/outfits.json5');
console.log('copied the TR1-3 game scripts and cfg/outfits.json5');
