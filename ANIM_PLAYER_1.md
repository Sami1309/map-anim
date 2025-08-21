# Animation Player Endpoint: LLM Integration Guide (v1)

This guide is for an LLM agent integrating with the Map Animation Service to preview and render animations entirely in the browser. The entrypoint that the LLM should use in the user’s web app is a single ESM module served by the service:

- Player module: `GET /player/map-anim-player.js`
- Resolve prompt → program: `POST /api/resolve`
- Style parity: `GET /style.json`

The player bundle includes the core animation primitives (zoom, highlight, wait, trace, hold) and exposes a small API for preview and recording.

## Capabilities

- Full‑fidelity preview in the browser using MapLibre.
- Program resolution via the service (`/api/resolve`) so the LLM does not re-implement program logic.
- Client‑side WebM recording via `MediaRecorder` + `canvas.captureStream()`.

## Player API (imported from /player/map-anim-player.js)

- `createPlayer(opts) -> Promise<MapAnimPlayer>`
  - `opts.container`: CSS selector or HTMLElement for the map canvas.
  - `opts.serverBase`: service origin (e.g., `http://localhost:8080`).
  - Optional: `styleUrl`, `maplibreUrl`, `maplibreCssUrl`.

- `player.resolve({ text? | program? }) -> Promise<{ program }>`
  - Calls the service `POST /api/resolve`. Always prefer this over composing your own program.

- `player.play(program, opts?) -> Promise<void>`
  - Runs phases in order (default: `['zoom','trace','hold']`).
  - Honors `program.output.waitForTiles` to wait for map to be idle between frames for best quality.

- `player.record(program, opts?) -> Promise<Blob>`
  - Records the animation to WebM in-browser and resolves with a `Blob`.
  - Options: `mimeType` (default `video/webm;codecs=vp9`), `videoBitsPerSecond`.

Exports are ESM; import like:

```js
import { createPlayer } from 'SERVICE_ORIGIN/player/map-anim-player.js';
```

## Minimal Flow for the LLM

1) Require a DOM container for the map canvas (e.g., `#map`).
2) Create the player:
```js
const player = await createPlayer({ container: '#map', serverBase: 'SERVICE_ORIGIN' });
```
3) Resolve prompt → program:
```js
const { program } = await player.resolve({ text: USER_TEXT });
```
4) Preview in browser at full fidelity:
```js
await player.play(program);
```
5) Record in browser (optional):
```js
const blob = await player.record(program, { videoBitsPerSecond: 8_000_000 });
// Upload or offer download in the host app
```

## Program Notes the LLM Should Respect

- Use `/api/resolve` to obtain an augmented program. Do not handcraft fields unless specifically required; the service will:
  - Geocode addresses and boundaries when present.
  - Select phases based on prompt intent.
  - Resolve map style and inject `MAPTILER_KEY` if configured.
  - Apply performance toggles (fps caps, waitForTiles, pixelRatio) for preview parity.

- The program includes:
  - `camera.keyframes`: array with `center [lon,lat]`, `zoom`, `bearing`, `pitch`, and `t` ms.
  - `animation.phases`: ordered subset of `zoom`, `highlight`, `wait`, `trace`, `hold`.
  - `output.width`, `output.height`, `output.fps`, `output.pixelRatio`, `output.waitForTiles`.
  - Optional `border` config and `boundaryGeoJSON` for fills/trace/outline.

- For multi-segment prompts, the service may return `program.segments` with per-segment camera and boundary data. The player handles this uniformly since phases are driven by the returned program and the same primitives.

## Error Handling Patterns for the LLM

- If `/api/resolve` responds with an error JSON `{ error }`, surface the message and optionally retry after clarifying input.
- If `createPlayer` throws:
  - Ensure the container exists and CORS is configured (`CORS_ORIGIN` on the service).
  - Confirm that the page is loaded in a modern browser (MapLibre + MediaRecorder support).
- If `record()` fails with `captureStream_not_supported` or MediaRecorder errors, fallback to preview only (or guide the user to a supported browser).

## Endpoint Behaviors to Rely On

- `/player/map-anim-player.js` ships with the animation core bundled. No need to fetch additional helpers.
- `/style.json` returns a complete MapLibre style (with MapTiler key substitution when configured) to ensure preview parity with server renders.
- `/api/resolve` is idempotent for the same input and stable for LLM use. Prefer `text` over composing `program` unless you are instructed otherwise.

## Example Snippet (LLM‑generated)

```html
<div id="map" style="width:960px;height:540px"></div>
<script type="module">
  import { createPlayer } from 'SERVICE_ORIGIN/player/map-anim-player.js';
  const player = await createPlayer({ container: '#map', serverBase: 'SERVICE_ORIGIN' });
  const { program } = await player.resolve({ text: 'fly to Madrid, highlight Spain, then trace the border' });
  await player.play(program);
  // Optional: const blob = await player.record(program);
</script>
```

## Configuration Expectations

- Service must expose CORS for your app’s origin (env `CORS_ORIGIN`).
- Recommended: set `MAPTILER_KEY` on the service so `/style.json` matches server renders.
- Client device pixel ratios vary; for stable visuals, target `output.pixelRatio = 1`.

This specification is stable for “v1” and designed to be simple for an LLM to follow: resolve → play → optionally record, using a single import from the service and a single DOM container.

