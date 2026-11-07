# TRX Level Converter

A web service for converting classic Tomb Raider I, II, and III custom levels into a format compatible with the [TRX engine](https://github.com/LostArtefacts/TRX).

Upload a ZIP of your custom level data, and the converter will produce a ready-to-use package with a generated gameflow, translated scripts, mapped file structure, and all the fixups TRX expects.

## How it works

1. **Upload** your custom level files as a ZIP or tar.gz archive (or select a folder).
2. **Configure** — the converter auto-detects the game version (TR1 / TR2 / TR3) and presents options including outfit import preferences.
3. **Download** — conversion runs entirely in your browser. The result is uploaded to temporary storage and you receive a one-time download link that expires after one hour.

### What the converter does

- Extracts and classifies level files (levels, music, SFX, FMVs, cutscenes, injections)
- Maps everything into the directory structure TRX expects (`games/<mod>/levels/`, `music/`, `fmv/`, etc.)
- Strips remastered SFX headers so original and remastered `MAIN.SFX` files both work
- Translates `TOMBPC.DAT` binary game scripts into TRX gameflow events (level sequencing, music triggers, inventory items, cutscenes, FMVs)
- Generates `gameflow.json5` and localized `strings-*.json5` from templates
- Translates games made for the engines before TRX (Tomb1Main, TR1X, TR2X, and Tomb2Main and Tomb3Main, the names TR2X and an abandoned TR3 project went by) into TRX packages: their game flow, strings and injections take the shape TRX 1.0 read, then go the rest of the way like any older TRX game
- Optionally injects a `level_default` outfit so custom levels can use their embedded Lara model
- Detects multi-language audio (remastered releases) and lets you pick one
- Reads ZIP archives whose entries 7-Zip compressed with LZMA
- Brings levels made for an older TRX up to date with the renames in TRX's migration guide, and lists what still needs porting by hand

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript, Vite, Tailwind CSS, DaisyUI |
| Conversion | Client-side TypeScript (fflate for ZIP/gzip) |
| Backend | Fastify, TypeScript (temporary file storage only) |

## Getting started

```bash
npm install
```

### Development

Runs the Vite dev server (with HMR) and Fastify backend in parallel:

```bash
npm run dev
```

- Frontend: http://localhost:5173 (proxies `/api` to the backend)
- Backend: http://localhost:3001

### Production

Builds the client and starts a single Fastify process that serves both the frontend and API:

```bash
npm start
```

The service runs on port `3001` (configurable via `PORT` env var).

## Project structure

```
├── client/                 React frontend
│   └── src/
│       ├── components/     UI components (upload, progress, result, etc.)
│       ├── converter/      Core conversion logic (ported from TRX JS)
│       │   ├── gamedata.ts   Archive extraction, file mapping, SFX fixups
│       │   ├── gameflow.ts   Gameflow generation and patching
│       │   ├── tombpc.ts     TOMBPC.DAT binary script translator
│       │   └── zip.ts        Output ZIP creation
│       └── templates/      TRX template data (gameflows, strings, outfits)
└── server/                 Fastify backend
    └── src/
        ├── index.ts          API routes + static file serving
        ├── storage.ts        UUID-based temp file storage
        └── cleanup.ts        Periodic expiry cleanup (every 10 min)
```

## Keeping up with TRX

The converter writes for the TRX it was last updated against, so these parts
follow TRX's own files:

- `client/src/templates/tr*-level/` mirror TRX's
  `data/trx/ship/games/tr*-level/` game flows. Keep their injection lists in
  step when TRX changes them.
- `client/src/converter/renames.generated.ts` holds the renames from TRX's
  `docs/trx/MIGRATING.md`. Regenerate it from a TRX checkout:

  ```bash
  node scripts/extract-renames.mjs ../TRX
  ```
- Some of TRX's files are copied in as they stand, from a TRX checkout:
  - `client/src/converter/lua/base/`: the game scripts of TR1-3. A converted
    game that brings a game script of its own runs both, so the shipped set-up
    (the interface, water colors, save crystals) still happens.
  - `client/src/templates/cfg/outfits.json5`: the outfits. A game's outfits
    file replaces the shipped one, so the outfit made of a level's own meshes
    is written beside the shipped ones.
  - `client/src/templates/base/`: the catalogs, weapons and inventory ring of
    TR1-3, and the names of their injections. A game's own copy of one of
    these is merged into TRX's current one, so it keeps what TRX has added.

  ```bash
  node scripts/copy-trx-files.mjs ../TRX
  ```
- `client/src/converter/history.generated.ts` comes from TRX's git history:
  the git blob ids of every injection, catalog, weapons and ring file TRX has
  shipped, so an unchanged copy in a game can be told from one its builder
  changed, and the string ids of TRX 1.3 with the paths that hold their text
  now. Regenerate it from a TRX checkout with its tags:

  ```bash
  node scripts/extract-history.mjs ../TRX
  ```
- `client/src/converter/lua/trx_compat.lua` lets a script written for an older
  TRX run on the current one. The converter tells which TRX a game was made
  for from the version its executable states, or else from what its scripts
  and game flow use, and starts each of its scripts with a line handing it the
  API of that release. When TRX changes its Lua API, add the change there,
  gated on the release that made it, as `docs/trx/MIGRATING.md` describes it.

- `client/src/converter/levelrules.ts` writes into a game's scripts what the
  original engines did by themselves: tomb2.exe and tomb3.exe decided some
  behaviour by the level's place in the script or by a trigger's timer, which
  TRX has moved into the scripts and data of the original levels. A game built
  from the original data gets every rule, and a TRX game the ones its release
  still had. When TRX moves another such rule out of the engine, add it there
  with the release that moved it.

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/store` | Upload a converted ZIP. Returns `{ token, downloadUrl, expiresAt }` |
| `GET /api/download/:token` | One-time download. File is deleted after transfer. Returns 410 if expired or already downloaded. |

## License

This project is part of the TRX ecosystem. See the main [TRX repository](https://github.com/LostArtefacts/TRX) for license details.
