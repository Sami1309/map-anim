// Shared animation core used by web preview and renderer page

// Math helpers
export function lerp(a, b, t) { return a + (b - a) * t; }
export function lerpFrame(a, b, t) {
  return {
    center: [lerp(a.center[0], b.center[0], t), lerp(a.center[1], b.center[1], t)],
    zoom: lerp(a.zoom, b.zoom, t),
    bearing: lerp(a.bearing ?? 0, b.bearing ?? 0, t),
    pitch: lerp(a.pitch ?? 0, b.pitch ?? 0, t)
  };
}

export const EASING = {
  linear: (x) => x,
  easeOutCubic: (x) => 1 - Math.pow(1 - x, 3),
  easeInOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  easeOutQuad: (x) => 1 - (1 - x) * (1 - x)
};

export function findSpan(keyframes, t) {
  let i = 0;
  while (i < keyframes.length - 1 && t > keyframes[i + 1].t) i++;
  return [i, Math.min(i + 1, keyframes.length - 1)];
}

// Color + util helpers
export function getBorderColor(p) { return (p?.border?.color) || '#ffcc00'; }
export function getTraceColor(p) { return (p?.border?.traceColor) || '#ffffff'; }
export function getTraceDelta(p) { return Math.max(0, Number(p?.border?.traceWidthDelta ?? 1)); }
export function toLngLatArray(c) {
  if (!c) return undefined;
  if (Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1])) return [Number(c[0]), Number(c[1])];
  if (typeof c === 'object' && c !== null) {
    const lng = c.lng ?? c.lon ?? c.longitude;
    const lat = c.lat ?? c.latitude;
    if (isFinite(lng) && isFinite(lat)) return [Number(lng), Number(lat)];
  }
  return undefined;
}

// Internal helpers for stepping frames
async function waitForFrame(map, encoder, waitForTiles) {
  if (encoder && waitForTiles !== false) {
    await new Promise(res => map.once('idle', res));
  } else {
    await new Promise(res => requestAnimationFrame(res));
  }
}

async function addFrame(map, encoder) {
  if (encoder) await encoder.add(map.getCanvas());
}

export async function runZoomPhase(map, program, fps, duration, frameCount, ease, encoder) {
  for (let i = 0; i < frameCount; i++) {
    const p = i / Math.max(1, frameCount - 1);
    const t = ease(p) * duration;
    const [aIdx, bIdx] = findSpan(program.camera.keyframes, t);
    const a = program.camera.keyframes[aIdx];
    const b = program.camera.keyframes[bIdx];
    const tt = a.t === b.t ? 0 : (t - a.t) / (b.t - a.t);
    const pose = lerpFrame(a, b, tt);
    map.jumpTo({ center: [pose.center[0], pose.center[1]], zoom: pose.zoom, bearing: pose.bearing, pitch: pose.pitch });
    await waitForFrame(map, encoder, program.output.waitForTiles);
    await addFrame(map, encoder);
  }
}

export async function runWaitPhase(map, ms, fps, encoder) {
  const frames = Math.ceil((ms / 1000) * fps);
  for (let i = 0; i < frames; i++) {
    await new Promise(res => requestAnimationFrame(res));
    await addFrame(map, encoder);
  }
}

export async function runTracePhase(map, program, fps, encoder) {
  const traceMs = program.border?.traceDurationMs ?? 3000;
  const traceFrames = Math.max(1, Math.ceil((traceMs / 1000) * fps));
  const showDuringZoom = !!(program.border?.showDuringZoom);
  const borderOpacity = program.border?.opacity ?? 1;

  if (!showDuringZoom) {
    try { map.setPaintProperty('border_line', 'line-opacity', 0); } catch {}
    try { map.setPaintProperty('border_drawn', 'line-opacity', 0); } catch {}
  }

  for (let j = 0; j < traceFrames; j++) {
    const prog = j / Math.max(1, traceFrames - 1) + 0.03;
    const gradTrace = [ 'interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0.0)', Math.max(0, prog - 0.02), 'rgba(255,255,255,0.0)', prog, 'rgba(255,255,255,1.0)', Math.min(1, prog + 0.02), 'rgba(255,255,255,0.0)', 1, 'rgba(255,255,255,0.0)' ];
    const borderCol = getBorderColor(program);
    const gradDrawn = [ 'interpolate', ['linear'], ['line-progress'], 0, borderCol, Math.max(0, prog), borderCol, Math.min(1, prog + 0.001), 'rgba(255,204,0,0.0)', 1, 'rgba(255,204,0,0.0)' ];
    try {
      map.setPaintProperty('border_trace', 'line-gradient', gradTrace);
      map.setPaintProperty('border_trace', 'line-color', getTraceColor(program));
      map.setPaintProperty('border_trace', 'line-opacity', 1.0);
      map.setPaintProperty('border_drawn', 'line-gradient', gradDrawn);
      map.setPaintProperty('border_drawn', 'line-opacity', borderOpacity);
    } catch (e) {
      try {
        map.setPaintProperty('border_trace', 'line-gradient', undefined);
        map.setPaintProperty('border_trace', 'line-color', getTraceColor(program));
        map.setPaintProperty('border_trace', 'line-opacity', 1.0);
        map.setPaintProperty('border_drawn', 'line-gradient', undefined);
        map.setPaintProperty('border_drawn', 'line-color', borderCol);
        map.setPaintProperty('border_drawn', 'line-opacity', borderOpacity);
      } catch {}
    }
    await waitForFrame(map, encoder, program.output.waitForTiles);
    await addFrame(map, encoder);
  }
  try { map.setPaintProperty('border_trace', 'line-opacity', 0.0); } catch {}
  const showAfter = (program.border?.showStaticAfterTrace !== false);
  if (showAfter) {
    try {
      map.setPaintProperty('border_drawn', 'line-gradient', undefined);
      map.setPaintProperty('border_drawn', 'line-color', getBorderColor(program));
      map.setPaintProperty('border_drawn', 'line-opacity', program.border?.opacity ?? 1);
    } catch {}
  }
}

export async function runHoldPhase(map, program, fps, encoder) {
  const holdMs = Math.max(0, Number(program.border?.traceHoldMs ?? 2000));
  const frames = Math.ceil((holdMs / 1000) * fps);
  for (let h = 0; h < frames; h++) {
    await new Promise(res => requestAnimationFrame(res));
    await addFrame(map, encoder);
  }
}

export async function runHighlightPhase(map, program, fps, encoder) {
  const ms = Math.max(500, Number(program.animation?.highlightDurationMs || 1200));
  const frames = Math.ceil((ms / 1000) * fps);
  const targetFill = (typeof program.boundaryFillOpacity === 'number') ? program.boundaryFillOpacity : 0.25;
  const targetLine = 1;
  for (let i = 0; i < frames; i++) {
    const p = i / Math.max(1, frames - 1);
    const v = EASING.easeOutCubic(p);
    try {
      if (map.getLayer('boundary-fill')) {
        map.setPaintProperty('boundary-fill', 'fill-opacity', targetFill * v);
        if (map.getLayer('boundary-line')) map.setPaintProperty('boundary-line', 'line-opacity', targetLine * v);
      } else {
        if (map.getLayer('country-fill')) map.setPaintProperty('country-fill', 'fill-opacity', targetFill * v);
        if (map.getLayer('country-outline')) map.setPaintProperty('country-outline', 'line-opacity', targetLine * v);
      }
    } catch {}
    await new Promise(res => requestAnimationFrame(res));
    await addFrame(map, encoder);
  }
}

// Preview-only runner (no encoder)
export async function runAnimationSequencePreview(map, program) {
  if (!program?.camera?.keyframes || program.camera.keyframes.length === 0) return;
  const phases = (program.animation?.phases && program.animation.phases.length) ? program.animation.phases : ['zoom','trace','hold'];
  const duration = program.camera.keyframes.at(-1).t;
  const easeName = program.animation?.easing || 'easeOutCubic';
  const ease = EASING[easeName] || EASING.easeOutCubic;
  const fps = 30;
  const frameCount = Math.ceil((duration / 1000) * fps);
  for (const phase of phases) {
    if (phase === 'zoom') await runZoomPhase(map, program, fps, duration, frameCount, ease, undefined);
    else if (phase === 'highlight') await runHighlightPhase(map, program, fps, undefined);
    else if (phase === 'wait') await runWaitPhase(map, Number(program.animation?.waitBeforeTraceMs || 0), fps, undefined);
    else if (phase === 'trace') await runTracePhase(map, program, fps, undefined);
    else if (phase === 'hold') await runHoldPhase(map, program, fps, undefined);
  }
}

// Expose on window for renderer-page.html usage
try {
  if (typeof window !== 'undefined') {
    window.AnimationCore = {
      lerp, lerpFrame, EASING, findSpan, getBorderColor, getTraceColor, getTraceDelta, toLngLatArray,
      runZoomPhase, runWaitPhase, runTracePhase, runHoldPhase, runHighlightPhase, runAnimationSequencePreview
    };
  }
} catch {}

