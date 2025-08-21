# AWS Rendering Guide and Change Summary

This guide summarizes the new GPU-friendly rendering path, endpoints, and the exact changes added to support fast MP4 generation on AWS (NVENC/libx264). It also includes deployment notes and quick checks.

## Overview

- Adds a low-latency, GPU-accelerated pipeline that streams raw RGBA frames from headless Chrome → ffmpeg → MP4.
- Keeps existing WebM pipeline for compatibility, and adds a switch to request MP4 uploads to S3.
- Introduces a browser warm pool so the renderer starts faster under load, and supports running against a system Chrome (CHROME_PATH) to use the instance GPU.

## What Changed (Files)

- Updated: `src/webgl-launch.ts`
  - CHROME_PATH support; GPU-friendly flags (`--enable-gpu`, `--use-gl=egl`, `--disable-software-rasterizer`, `--ignore-gpu-blocklist`).
- Updated: `src/renderer-page.html`
  - New RGBA frame streaming path using `gl.readPixels` when Node exposes `__nodeDeliverFrameRGBA`.
  - Fallback to Hubble.gl WebM encoder if RGBA path is not available.
  - Safer pooled-page reuse (reset container before map init).
- Updated: `src/server.ts`
  - Adds `POST /api/render` that streams `video/mp4` using ffmpeg (NVENC/libx264); no S3 upload.
  - Extends `POST /api/animate` to optionally encode MP4 via NVENC and upload to S3.
  - Injects CDN scripts for MapLibre and Hubble.gl; optional deck.gl + loaders for Google 3D tiles.
- Updated: `src/storage.ts`
  - New `putVideoMp4()` S3 uploader alongside existing WebM uploader.
- Added: `src/ffmpeg-pipeline.ts`
  - Spawns ffmpeg for MP4 with `h264_nvenc` or `libx264`; fragmented MP4 for streaming.
- Added: `src/browser-pool.ts`
  - Warm pool (`BrowserPool`) of preloaded pages; prewarms MapLibre.
- Added: `AWS_TODO.md`
  - Exact infra steps: NVIDIA drivers, ffmpeg w/ NVENC, system Chrome, env vars.

## Endpoints

- `POST /api/render`
  - Input: `{ text?: string, program?: MapProgram }`
  - Output: streams `video/mp4` over HTTP (fragmented MP4) using ffmpeg.
  - Use when you want a direct MP4 response (no S3 upload), lowest latency.

- `POST /api/animate`
  - Input: `{ text?: string, program?: MapProgram, format?, encoder?, useNvenc? }`
  - Default: WebM encoding in page → S3 (`putVideoWebm`), returns `{ url, program }`.
  - MP4 switch (encode in Node → S3): any of
    - `format: "mp4"`
    - `encoder: "h264_nvenc"`
    - `useNvenc: true`
    - or set `RENDER_FORCE_MP4=true` (env) to default to MP4.

Other existing endpoints remain (LLM parse, geocode, templates), unchanged in behavior.

## Encoding Paths

- MP4 path (preferred on AWS for speed):
  1) Puppeteer renders MapLibre; page calls `__nodeDeliverFrameRGBA` per frame.
  2) Node pipes RGBA into ffmpeg → `h264_nvenc` (or `libx264`) with `-movflags +frag_keyframe+empty_moov+faststart`.
  3) `/api/render`: stream stdout to client. `/api/animate` (MP4 mode): buffer stdout and upload to S3 via `putVideoMp4`.

- WebM path (compatibility):
  1) Page uses Hubble.gl’s WebMEncoder to produce a Blob.
  2) Bytes sent to Node via `__nodeDeliverWebM` and uploaded to S3 via `putVideoWebm`.

## GPU + Browser

- System Chrome via `CHROME_PATH` enables GPU on AWS (e.g., `g5.xlarge`, `g6.xlarge`).
- Launcher tries several WebGL backends; GPU-first: `--enable-gpu`, `--use-gl=egl`, `--use-angle=gl`.
- Pooled pages prewarm MapLibre and optionally Deck/3D.

## Environment Variables

- Rendering and encoders
  - `CHROME_PATH` → path to system Chrome/Chromium (GPU).
  - `FFMPEG_PATH` → ffmpeg binary with `h264_nvenc` (optional; defaults to `ffmpeg`).
  - `RENDER_ENCODER` → `h264_nvenc` (GPU) or `libx264` (CPU fallback).
  - `RENDER_FORCE_MP4` → `true` to default `/api/animate` to MP4.
  - `BROWSER_POOL_SIZE` → pooled page count for `/api/render`.
  - Quality knobs: `RENDER_QUALITY` (`fast`|`high`), `RENDER_WAIT_FOR_TILES`, `RENDER_PIXEL_RATIO`, `RENDER_MAX_FPS`, `RENDER_MAX_WIDTH`, `RENDER_MAX_HEIGHT`.

- Map and storage
  - `MAPTILER_KEY` → substitutes `{key}` into style JSON (served as data URL to avoid CORS).
  - `AWS_S3_BUCKET`, `AWS_REGION` → S3 upload targets.
  - `CORS_ORIGIN` → allowed origin(s) for API.

- LLM and data
  - `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (default `gpt-4.1`).
  - `NOMINATIM_HOST`, `NOMINATIM_USER_AGENT`, `OVERPASS_URL` (optional overrides).

## AWS Setup (high level)

See `AWS_TODO.md` in the repo for exact commands. Summary:

1) Instance: `g5.xlarge` / `g6.xlarge`.
2) NVIDIA Drivers: `ubuntu-drivers autoinstall` → reboot → verify `nvidia-smi`.
3) ffmpeg with NVENC: ensure `h264_nvenc` appears in `ffmpeg -encoders`.
4) Chrome/Chromium: install and set `CHROME_PATH`.
5) Fonts: install DejaVu/Noto to avoid missing glyphs.
6) Env: export `FFMPEG_PATH`, `RENDER_ENCODER=h264_nvenc`, `BROWSER_POOL_SIZE=2`, `MAPTILER_KEY`, `AWS_*`.

## Quick Checks

- Health: `curl :8080/healthz` → `ok`.
- MP4 stream: `curl -X POST :8080/api/render -H 'content-type: application/json' -d '{"text":"fly over Spain"}' > out.mp4`.
- MP4 upload: `curl -X POST :8080/api/animate -H 'content-type: application/json' -d '{"text":"highlight France","format":"mp4"}'`.
- WebM upload (default): same as above without MP4 fields.

## Notes & Troubleshooting

- If MP4 is empty or ffmpeg exits non-zero:
  - Confirm `FFMPEG_PATH` points to a build with `h264_nvenc`.
  - Try `RENDER_ENCODER=libx264` as a CPU fallback.
- If WebGL fails:
  - Verify `CHROME_PATH` and that system Chrome runs headless on the instance.
  - Check `npm run test:webgl` and server logs for renderer info.
- If style tiles are blocked by CORS or require keys:
  - Set `MAPTILER_KEY`; styles are inlined as a data URL after key substitution.

---

This guide summarizes the AWS-related changes and how to run them. See `AWS_TODO.md` for exact infra commands and packages, and `README.md` for general project info.

