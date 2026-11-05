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
- Handles TR2X/TR1X extended gameflows (filters to uploaded levels, cleans injection paths)
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
- `client/src/converter/lua/base/` holds the game scripts TRX ships for TR1-3.
  A converted game that brings a game script of its own runs both, so the
  shipped set-up (the interface, water colors, save crystals) still happens.
  Copy them again from a TRX checkout:

  ```bash
  node scripts/copy-game-scripts.mjs ../TRX
  ```
- `client/src/converter/lua/trx_compat.lua` lets a script written for an older
  TRX run on the current one. The converter tells which TRX a game was made
  for from the version its executable states, or else from what its scripts
  and game flow use, and starts each of its scripts with a line handing it the
  API of that release. When TRX changes its Lua API, add the change there,
  gated on the release that made it, as `docs/trx/MIGRATING.md` describes it.

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/store` | Upload a converted ZIP. Returns `{ token, downloadUrl, expiresAt }` |
| `GET /api/download/:token` | One-time download. File is deleted after transfer. Returns 410 if expired or already downloaded. |

## License

This project is part of the TRX ecosystem. See the main [TRX repository](https://github.com/LostArtefacts/TRX) for license details.
