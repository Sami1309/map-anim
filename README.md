High-quality map animation tweaks

- Style: Set `MAP_STYLE_URL` to a high-resolution satellite style JSON (MapLibre-compatible). Examples:
  - MapTiler Satellite: `https://api.maptiler.com/maps/satellite/style.json?key=YOUR_KEY`
  - MapTiler Satellite Hybrid (labels): `https://api.maptiler.com/maps/hybrid/style.json?key=YOUR_KEY`
  - Or host your own style JSON. If unset, it falls back to MapLibre demo style.

- Output quality parameters (from the LLM-generated program):
  - `output.width` and `output.height`: increase for higher resolution (e.g., 1920x1080, 3840x2160).
  - `output.fps`: 60 for smoother motion.
  - `output.pixelRatio`: 2–4 for crisper lines/labels (default 2).
  - `output.waitForTiles`: keep `true` to wait for tiles each frame (max quality; slower). Set `false` for speed.

- Border quality:
  - The renderer uses Natural Earth 10m admin boundaries for high-detail borders and rounded joins/caps for smooth outlines.
  - Control border thickness via `border.strokeWidth`.

- How to request satellite terrain in natural language:
  - Include phrasing like “use high-resolution satellite terrain” in your prompt. The LLM defaults were tuned to produce 1080p/60fps with pixelRatio=2 and `waitForTiles=true`.

Animation styles

- Choose a style by name in your prompt (the LLM will set `styleId`), or pass a `program.styleId` directly:
  - `cinematic_zoom`: smooth ease-out zoom; restrict labels at end; no tracing.
  - `documentary_focus`: restrict labels throughout; moderate motion.
  - `tech_outline_trace`: bold outline; traces the border after zoom-in.
  - `fast_preview`: quicker renders; no label restriction; lower quality waits.

Label control

- `labels.restrictToCountry: true` limits symbol labels to within the selected country polygon.
- `labels.applyAt: 'final' | 'always'` controls whether restriction applies only after the zoom completes or for the whole animation.

Border tracing

- `border.traceAfterZoom: true` draws a white trace around the country border after the zoom ends.
- `border.traceDurationMs` controls how long the trace takes (e.g., 1500).

Performance toggles

- Default behavior now prefers faster renders. You can override via env vars:
  - `RENDER_QUALITY=high` keeps quality defaults; omit or set `fast` for speed.
  - `RENDER_WAIT_FOR_TILES=0|1` force waiting for tiles per frame.
  - `RENDER_PIXEL_RATIO=1..4` force MapLibre pixel ratio.
  - `RENDER_MAX_FPS=number` cap frames per second (e.g., 30).
- The renderer logs progress every ~10% or 30 frames, and during border tracing.

API usage

- POST `/api/animate` with either:
  - `text`: natural language request, e.g. `{ "text": "Zoom from Europe to Spain over 4 seconds, slow down on approach, pitch to 40°, highlight Spain border 6px, 1280x720 @30fps" }`
  - `program`: structured MapProgram JSON (bypasses LLM) matching `src/program-schema.ts`.
- Example `program` request:
  - `curl -X POST http://localhost:8080/api/animate -H 'Content-Type: application/json' -d '{
    "program": {
      "camera": { "keyframes": [
        { "center": [10,50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
        { "center": [-3.7,40.4], "zoom": 5.5, "bearing": 0, "pitch": 40, "t": 4000 }
      ]},
      "border": { "isoA3": "ESP", "strokeWidth": 6, "opacity": 1 },
      "output": { "width": 1280, "height": 720, "fps": 30, "format": "webm", "pixelRatio": 2, "waitForTiles": true }
    }
  }'`

Troubleshooting

- OpenAI errors: If the response contains `OpenAI request failed ... Unexpected token '<'`, the server likely received an HTML error page from a proxy/firewall while the OpenAI SDK expected JSON. Check `OPENAI_API_KEY`, outbound network access, and optionally set `OPENAI_BASE_URL`/`OPENAI_MODEL`.
- CDN blocks (403) or parser-blocking warnings: The renderer no longer relies on `<script src>` tags. Configure one of the following to load libraries without cross-site fetches:
  - `MAPLIBRE_JS_PATH` and `HUBBLE_JS_PATH`: absolute paths to local JS bundles (recommended for restricted networks).
  - `MAPLIBRE_JS_URL` and `HUBBLE_JS_URL`: custom CDN or self-hosted URLs (defaults use jsDelivr).
  - Borders data: set `BORDERS_GEOJSON_PATH` to a local Natural Earth `ne_10m_admin_0_countries.geojson`, or `BORDERS_GEOJSON_URL` to a reachable URL. Otherwise it falls back to a common CloudFront mirror.

Remote style resolution

- The server derives the MapLibre style URL from `MAP_STYLE_REMOTE`.
  - If it points directly to a `.json`, that URL is used as-is.
  - If it points to a GitHub repo (e.g., `https://github.com/openmaptiles/dark-matter-gl-style`), it resolves to `https://raw.githubusercontent.com/<org>/<repo>/<branch>/<path>` using:
    - `MAP_STYLE_REMOTE_BRANCH` (default `master`)
    - `MAP_STYLE_REMOTE_PATH` (default `style.json`)
- Default if unset: `MAP_STYLE_REMOTE=https://github.com/openmaptiles/dark-matter-gl-style`.
- You can still override per-request by setting `program.style` to a full URL.

MapTiler key injection

- If `MAPTILER_KEY` is set in your environment, the server will prefetch the resolved style JSON, substitute any `{key}` placeholders (including URL-encoded `%7Bkey%7D`), and pass the style to the renderer as a data URL.
- This ensures all embedded URLs (sprite, glyphs, tiles/tiles.json) that contain `{key}` are usable without 403s from MapTiler.
- Example `.env`:
  - `MAPTILER_KEY=pk.your_maptiler_api_key`

Example env for restricted networks

```
MAPLIBRE_JS_PATH=/absolute/path/to/maplibre-gl.js
HUBBLE_JS_PATH=/absolute/path/to/hubble.gl.dist.min.js
BORDERS_GEOJSON_PATH=/absolute/path/to/ne_10m_admin_0_countries.geojson
# Optionally, supply a self-hosted map style JSON
MAP_STYLE_URL=https://your-host/style.json
```
