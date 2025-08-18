#!/usr/bin/env bash
# Sample curl commands to exercise different animation styles and options
# Requires jq for pretty-print; remove | jq . if not installed.

set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:8080}

post() {
  local desc="$1"; shift
  echo "\n=== $desc ==="
  curl -sS -X POST "$BASE_URL/api/animate" -H 'Content-Type: application/json' -d "$1" | jq .
}

# 1) Legacy text example
post "Legacy text prompt" '{
  "text": "Zoom from Europe to Spain over 4 seconds, slow down on approach, pitch to 40, highlight Spain border 6px, 1280x720 @30fps"
}'

# 2) Styles via text
post "Cinematic zoom (text)" '{
  "text": "Cinematic zoom into Spain with labels restricted in the final shot; use styleId cinematic_zoom; 1920x1080 at 60 fps"
}'
post "Documentary focus (text)" '{
  "text": "Documentary style focus on Spain, keep labels within the country throughout; use styleId documentary_focus"
}'
post "Tech outline trace (text)" '{
  "text": "Tech outline trace style for Spain; after zoom completes, trace the border; 1920x1080 @60fps"
}'
post "Fast preview (text)" '{
  "text": "Fast preview into Spain; quick render without waiting for tiles; use styleId fast_preview"
}'

# Camera path helper (reused below)
CAMERA='{"keyframes":[{"center":[10,50],"zoom":2.5,"bearing":0,"pitch":0,"t":0},{"center":[-3.7,40.4],"zoom":5.6,"bearing":0,"pitch":40,"t":4000}]}'

# 3) Border thickness presets and explicit width
post "Border thickness via styleId=ultra" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\",\"styleId\":\"ultra\"},\"output\":{\"width\":1280,\"height\":720,\"fps\":30,\"waitForTiles\":false}}}"
post "Border explicit strokeWidth=12 overrides styleId" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\",\"styleId\":\"thin\",\"strokeWidth\":12},\"output\":{\"width\":1280,\"height\":720,\"fps\":30}}}"

# 4) Label restriction modes
post "Labels restricted at final" "{\"program\":{\"camera\":$CAMERA,\"labels\":{\"restrictToCountry\":true,\"applyAt\":\"final\"},\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"
post "Labels restricted always" "{\"program\":{\"camera\":$CAMERA,\"labels\":{\"restrictToCountry\":true,\"applyAt\":\"always\"},\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"

# 5) Tracing controls
post "Default tracing (hidden during zoom, trace after, reveal static)" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\",\"traceAfterZoom\":true,\"showDuringZoom\":false,\"showStaticAfterTrace\":true},\"output\":{\"width\":1280,\"height\":720}}}"
post "Show border during zoom, then trace" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\",\"showDuringZoom\":true,\"traceAfterZoom\":true},\"output\":{\"width\":1280,\"height\":720}}}"
post "Only trace (no static after)" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\",\"showDuringZoom\":false,\"traceAfterZoom\":true,\"showStaticAfterTrace\":false},\"output\":{\"width\":1280,\"height\":720}}}"

# 5b) Tracing speed and hold controls
post "Slower trace (5s) + longer hold (3s)" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\",\"traceAfterZoom\":true,\"traceDurationMs\":5000,\"traceHoldMs\":3000},\"output\":{\"width\":1280,\"height\":720}}}"
post "No trace (static during zoom)" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\",\"showDuringZoom\":true,\"traceAfterZoom\":false},\"output\":{\"width\":1280,\"height\":720}}}"

# 6) Animation easing variants
post "Easing: easeOutCubic" "{\"program\":{\"camera\":$CAMERA,\"animation\":{\"easing\":\"easeOutCubic\"},\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"
post "Easing: easeInOutCubic" "{\"program\":{\"camera\":$CAMERA,\"animation\":{\"easing\":\"easeInOutCubic\"},\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"
post "Easing: easeOutQuad" "{\"program\":{\"camera\":$CAMERA,\"animation\":{\"easing\":\"easeOutQuad\"},\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"
post "Easing: linear" "{\"program\":{\"camera\":$CAMERA,\"animation\":{\"easing\":\"linear\"},\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"

# 7) Quality/performance toggles
post "High quality (waitForTiles=true, pixelRatio=2, 60fps)" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1920,\"height\":1080,\"fps\":60,\"pixelRatio\":2,\"waitForTiles\":true}}}"
post "Fast render (waitForTiles=false, pixelRatio=1, 24fps)" "{\"program\":{\"camera\":$CAMERA,\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720,\"fps\":24,\"pixelRatio\":1,\"waitForTiles\":false}}}"

# 8) Style presets via program.styleId
post "Style preset: cinematic_zoom" "{\"program\":{\"camera\":$CAMERA,\"styleId\":\"cinematic_zoom\",\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"
post "Style preset: documentary_focus" "{\"program\":{\"camera\":$CAMERA,\"styleId\":\"documentary_focus\",\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"
post "Style preset: tech_outline_trace" "{\"program\":{\"camera\":$CAMERA,\"styleId\":\"tech_outline_trace\",\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"
post "Style preset: fast_preview" "{\"program\":{\"camera\":$CAMERA,\"styleId\":\"fast_preview\",\"border\":{\"isoA3\":\"ESP\"},\"output\":{\"width\":1280,\"height\":720}}}"

echo "\nAll sample submissions complete. Set BASE_URL to override target (default http://localhost:8080)."
