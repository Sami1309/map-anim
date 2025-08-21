# Browser Player Integration Guide

This service now exposes a browser-based, full‑fidelity player that:
- Loads the same map styles and helpers as the server renderer.
- Plays animations completely client‑side for accurate preview.
- Optionally records the animation to a WebM video using the browser’s MediaRecorder.

The design keeps your “user animation app” thin. It only needs to:
1) ask this service to resolve a prompt to a program, and 2) load the player module to play/record the program.

## What Goes Where

- Service (this repo):
  - Program resolution: `POST /api/resolve { text | program } -> { program }`.
  - Map style: `GET /style.json` (injects `MAPTILER_KEY` if present).
  - Player module: `GET /player/map-anim-player.js` (ESM).
  - Shared helpers: `GET /player/shared/*`.

- User animation app (your other app):
  - Imports the player ESM from the service origin.
  - Requests resolved programs from the service.
  - Calls `player.play()` for preview and `player.record()` to render videos in‑browser.

This keeps logic centralized and consistent with the server’s render pipeline.

## Prerequisites

- Service runs with CORS allowing your app origin. Set `CORS_ORIGIN` to your app’s URL (or `*` for dev).
- Recommended envs on the service: `MAPTILER_KEY` (for styles), `OPENAI_*` (if you call `text -> program`).
- Node 18+ on the server. Browser support for MediaRecorder (Chrome/Edge/Firefox recommended for WebM).

## Quick Start (User Animation App)

Replace `SERVICE_ORIGIN` with where this service is running (e.g., `http://localhost:8080`).

```html
<div id="map" style="width:960px;height:540px"></div>
<script type="module">
  import { createPlayer } from 'SERVICE_ORIGIN/player/map-anim-player.js';

  (async () => {
    const player = await createPlayer({
      container: '#map',
      serverBase: 'SERVICE_ORIGIN'
    });

    // Option A: prompt -> program via the service
    const { program } = await player.resolve({ text: 'zoom to Spain and outline it' });

    // Option B: send your own program shape
    // const { program } = await player.resolve({ program: YOUR_PROGRAM });

    // Preview at full fidelity
    await player.play(program);

    // Render to WebM in the browser
    const blob = await player.record(program, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 8_000_000
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'map-animation.webm';
    a.click();
  })();
  </script>
```

Notes:
- The player auto‑loads MapLibre JS/CSS from a CDN.
- The player sets your container size to the program’s output `width`/`height` for fidelity.
- It uses the service’s `/style.json` by default, so your previews match server renders.

## Player API

- `createPlayer(opts)` -> `Promise<MapAnimPlayer>`
  - `opts.container`: CSS selector or HTMLElement for the map.
  - `opts.serverBase`: service origin, e.g. `http://localhost:8080`.
  - `opts.styleUrl` (optional): override style URL (defaults to `${serverBase}/style.json`).
  - `opts.maplibreUrl`, `opts.maplibreCssUrl` (optional): override CDN URLs.

- `player.resolve({ text? | program? })` -> `{ program }`
  - Calls the service `POST /api/resolve` and returns the fully‑augmented program.

- `player.play(program, opts?)` -> `Promise<void>`
  - Plays phases: `zoom`, `highlight`, `wait`, `trace`, `hold` (based on `program.animation.phases`).
  - Respects `program.output.waitForTiles` to wait for tile completion between frames for best visual quality.
  - `opts.waitForTiles` can override this per call.

- `player.record(program, opts?)` -> `Promise<Blob>`
  - Uses `canvas.captureStream()` + `MediaRecorder` to record as WebM.
  - `opts.mimeType`: default `video/webm;codecs=vp9`.
  - `opts.videoBitsPerSecond`: optional bitrate hint.
  - Recording runs `play()` under the hood and stops when the animation completes.

## Efficiency and Fidelity

- Full‑fidelity defaults: The player uses the service’s resolved style and program. It honors `waitForTiles` so frames are added only when the map is idle, matching server timing behavior.
- Pixel ratio: For maximum consistency with server renders, set `program.output.pixelRatio = 1` (server already caps by default unless configured). Client device pixel ratios vary and affect canvas size.
- Tile warm‑up: For very large areas, consider a brief pre‑roll to warm tiles (`animation.waitBeforeTraceMs`).
- Code size: The player loads MapLibre on demand and reuses shared animation helpers straight from this service (`/player/shared/*`) to stay in sync.

## Configuration (Service)

- `CORS_ORIGIN`: set to your app origin for cross‑site loading of the player and APIs.
- `MAP_STYLE_REMOTE*`: optional override of the base style; `/style.json` injects `MAPTILER_KEY` if present.
- `RENDER_*`: server‑side rendering flags (not used by the browser player), but use the same program fields for consistency (`output.fps`, `output.pixelRatio`, `output.waitForTiles`).

## 3D Tiles (Optional)

If you plan to preview Google 3D Tiles in the browser, you’ll need to load deck.gl and loaders.gl and add an overlay. The current player focuses on 2D/lines/fills parity with server output. If you need this, we can add a toggle that lazy‑loads deck.gl UMD bundles and draws the `Tile3DLayer` similar to the web preview.

## Troubleshooting

- “player not built” in `/player/map-anim-player.js`: run `npm run build` on the service so `dist/player.js` exists, then `npm start`.
- CORS issues: set `CORS_ORIGIN` on the service to your other app’s origin or `*` for development.
- No video or empty WebM: ensure the browser supports MediaRecorder WebM; Chrome/Edge/Firefox recommended.
- Visual mismatches: make sure you’re using the service’s `/style.json` and that `program.output.pixelRatio` is sane (1–2).

## Example: Minimal Controller in Your App

```ts
import { createPlayer } from 'SERVICE_ORIGIN/player/map-anim-player.js';

export async function runAnimation(text: string, container: HTMLElement) {
  const player = await createPlayer({ container, serverBase: 'SERVICE_ORIGIN' });
  const { program } = await player.resolve({ text });
  await player.play(program);
  const blob = await player.record(program);
  return blob; // Save or upload from your app
}
```

That’s it. Your app stays generic and delegates program resolution + shared logic to this service.

