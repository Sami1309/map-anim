Commands to test the map animation API (copy/paste to your shell)

Set the base URL (optional):

BASE_URL=http://localhost:8080

1) Legacy text prompt

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "text": "Zoom from Europe to Spain over 4 seconds, slow down on approach, pitch to 40, highlight Spain border 6px, 1280x720 @30fps"
}'

2) Styles via text

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "text": "Cinematic zoom into Spain with labels restricted in the final shot; use styleId cinematic_zoom; 1920x1080 at 60 fps"
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "text": "Documentary style focus on Spain, keep labels within the country throughout; use styleId documentary_focus"
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "text": "Tech outline trace style for Spain; after zoom completes, trace the border; 1920x1080 @60fps"
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "text": "Fast preview into Spain; quick render without waiting for tiles; use styleId fast_preview"
}'

3) Border thickness presets and explicit width (program JSON)

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP", "styleId": "ultra" },
    "output": { "width": 1280, "height": 720, "fps": 30, "waitForTiles": false }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP", "styleId": "thin", "strokeWidth": 12 },
    "output": { "width": 1280, "height": 720, "fps": 30 }
  }
}'

4) Label restriction modes

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "labels": { "restrictToCountry": true, "applyAt": "final" },
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "labels": { "restrictToCountry": true, "applyAt": "always" },
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

5) Tracing controls

# Default tracing (hidden during zoom, then trace, reveal static)
curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP", "traceAfterZoom": true, "showDuringZoom": false, "showStaticAfterTrace": true },
    "output": { "width": 1280, "height": 720 }
  }
}'

# Show border during zoom, then trace
curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP", "showDuringZoom": true, "traceAfterZoom": true },
    "output": { "width": 1280, "height": 720 }
  }
}'

# Only trace (no static border after)
curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP", "showDuringZoom": false, "traceAfterZoom": true, "showStaticAfterTrace": false },
    "output": { "width": 1280, "height": 720 }
  }
}'

# No trace (static border during zoom)
curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP", "showDuringZoom": true, "traceAfterZoom": false },
    "output": { "width": 1280, "height": 720 }
  }
}'

6) Animation easing variants

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "animation": { "easing": "easeOutCubic" },
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "animation": { "easing": "easeInOutCubic" },
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "animation": { "easing": "easeOutQuad" },
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "animation": { "easing": "linear" },
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

7) Quality/performance presets

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP" },
    "output": { "width": 1920, "height": 1080, "fps": 60, "pixelRatio": 2, "waitForTiles": true }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720, "fps": 24, "pixelRatio": 1, "waitForTiles": false }
  }
}'

8) Style presets via program.styleId

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "styleId": "cinematic_zoom",
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "styleId": "documentary_focus",
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "styleId": "tech_outline_trace",
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'

curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "styleId": "fast_preview",
    "border": { "isoA3": "ESP" },
    "output": { "width": 1280, "height": 720 }
  }
}'
# Tracing speed and hold controls (slower trace + longer hold)
curl -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d '{
  "program": {
    "camera": { "keyframes": [
      { "center": [10, 50], "zoom": 2.5, "bearing": 0, "pitch": 0, "t": 0 },
      { "center": [-3.7, 40.4], "zoom": 5.6, "bearing": 0, "pitch": 40, "t": 4000 }
    ]},
    "border": { "isoA3": "ESP", "traceAfterZoom": true, "traceDurationMs": 5000, "traceHoldMs": 3000 },
    "output": { "width": 1280, "height": 720 }
  }
}'
