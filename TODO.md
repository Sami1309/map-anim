Roadmap / TODO

- Single animation core
  - Move animation helpers (zoom, wait, highlight, trace, hold) to one shared file and wire both the web app and the renderer page to consume it. This keeps logic in one place and guarantees behavior parity without duplication.

- Web UI controls
  - Address input: add a field that sets `extras.address` and calls `/api/resolve` (without relying on LLM detection).
  - 3D toggles: add UI toggles for terrain/sky and a Google Photorealistic 3D Tiles API key (stored in localStorage); pass these through to `/api/resolve` and use them in the renderer.
  - Phases picker: expose a list to choose phases explicitly from [zoom, highlight, trace, hold, wait]; prompts still work, but this provides control for non‑LLM users.

- Implementation notes
  - Consolidate the animation core and update both preview and renderer to use the shared module.
  - Add address/region UI and 3D toggles so `/api/resolve` doesn’t have to infer intent only from prompt text.

