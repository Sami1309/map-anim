// Browser Player for in-page, full-fidelity preview and browser-side rendering
// ESM module served at /player/map-anim-player.js
// Usage (in your other app):
//   import { createPlayer } from "<SERVICE_ORIGIN>/player/map-anim-player.js";
//   const player = await createPlayer({ container: '#map', serverBase: '<SERVICE_ORIGIN>' });
//   const { program } = await player.resolve({ text: 'zoom to Spain and outline it' });
//   await player.play(program); // preview
//   const blob = await player.record(program); // browser-render to WebM

export type ResolvedProgram = any; // Keep flexible for cross-app use; validated by server

// Inline animation core so the frontend gets a single file with all helpers.
// Wrapped in an IIFE to avoid leaking top-level bindings.
const AnimationCore = (() => {
  // Math helpers
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  function lerpFrame(a: any, b: any, t: number) {
    return {
      center: [lerp(a.center[0], b.center[0], t), lerp(a.center[1], b.center[1], t)],
      zoom: lerp(a.zoom, b.zoom, t),
      bearing: lerp(a.bearing ?? 0, b.bearing ?? 0, t),
      pitch: lerp(a.pitch ?? 0, b.pitch ?? 0, t)
    };
  }
  const EASING = {
    linear: (x: number) => x,
    easeOutCubic: (x: number) => 1 - Math.pow(1 - x, 3),
    easeInOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    easeOutQuad: (x: number) => 1 - (1 - x) * (1 - x)
  };
  function findSpan(keyframes: any[], t: number) {
    let i = 0; while (i < keyframes.length - 1 && t > keyframes[i + 1].t) i++; return [i, Math.min(i + 1, keyframes.length - 1)];
  }
  // Color + util helpers
  function getBorderColor(p: any) { return (p?.border?.color) || '#ffcc00'; }
  function getTraceColor(p: any) { return (p?.border?.traceColor) || '#ffffff'; }
  function getTraceDelta(p: any) { return Math.max(0, Number(p?.border?.traceWidthDelta ?? 1)); }

  // Internal helpers for stepping frames
  async function waitForFrame(map: any, encoder: any, waitForTiles: any) {
    if (encoder && waitForTiles !== false) {
      try { console.log('[player] waitForFrame: waiting for map idle'); } catch {}
      await new Promise((res) => map.once('idle', () => { try { console.log('[player] waitForFrame: idle'); } catch {} res(undefined); }));
    } else {
      try { console.log('[player] waitForFrame: rAF'); } catch {}
      await new Promise((res) => requestAnimationFrame(() => res(undefined)));
    }
  }
  async function addFrame(map: any, encoder: any) { if (encoder) await encoder.add(map.getCanvas()); }

  async function runZoomPhase(map: any, program: any, fps: number, duration: number, frameCount: number, ease: (x:number)=>number, encoder?: any, signal?: AbortSignal) {
    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) return
      const p = i / Math.max(1, frameCount - 1);
      const t = ease(p) * duration;
      const [aIdx, bIdx] = findSpan(program.camera.keyframes, t);
      const a = program.camera.keyframes[aIdx]; const b = program.camera.keyframes[bIdx];
      const tt = a.t === b.t ? 0 : (t - a.t) / (b.t - a.t);
      const pose = lerpFrame(a, b, tt);
      map.jumpTo({ center: [pose.center[0], pose.center[1]], zoom: (function(){ const zBias = Number(program.animation?.zoomOffset ?? -0.5); return pose.zoom + zBias; })(), bearing: pose.bearing, pitch: pose.pitch });
      try { (map as any).triggerRepaint?.(); } catch {}
      if (signal?.aborted) return
      try { (map as any).triggerRepaint?.(); } catch {}
      if (i % Math.max(1, Math.floor(frameCount / 10)) === 0 || i === frameCount - 1) {
        try { const c = map.getCenter?.(); const z = map.getZoom?.(); console.log('[player] zoom frame', i+1,'/',frameCount,'center=', c ? [c.lng?.toFixed?.(2), c.lat?.toFixed?.(2)] : '[n/a]', 'zoom=', z); } catch {}
      }
      await waitForFrame(map, encoder, program.output?.waitForTiles);
      await addFrame(map, encoder);
    }
  }
  async function runWaitPhase(map: any, ms: number, fps: number, encoder?: any, signal?: AbortSignal) {
    const frames = Math.ceil((ms / 1000) * fps);
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) return;
      await new Promise(res => requestAnimationFrame(() => res(undefined)));
      await addFrame(map, encoder);
    }
  }
  async function runTracePhase(map: any, program: any, fps: number, encoder?: any, signal?: AbortSignal) {
    const traceMs = program.border?.traceDurationMs ?? 3000;
    const traceFrames = Math.max(1, Math.ceil((traceMs / 1000) * fps));
    const showDuringZoom = !!(program.border?.showDuringZoom);
    const borderOpacity = program.border?.opacity ?? 1;
    try { if (!showDuringZoom) { try { map.setPaintProperty('border_line', 'line-opacity', 0); } catch {} try { map.setPaintProperty('border_drawn', 'line-opacity', 0); } catch {} } } catch {}
    for (let j = 0; j < traceFrames; j++) {
      if (signal?.aborted) return
      const prog = j / Math.max(1, traceFrames - 1) + 0.03;
      const gradTrace = ['interpolate',['linear'],['line-progress'],0,'rgba(255,255,255,0.0)',Math.max(0, prog - 0.02),'rgba(255,255,255,0.0)',prog,'rgba(255,255,255,1.0)',Math.min(1, prog + 0.02),'rgba(255,255,255,0.0)',1,'rgba(255,255,255,0.0)'];
      const borderCol = getBorderColor(program);
      const gradDrawn = ['interpolate',['linear'],['line-progress'],0,borderCol,Math.max(0, prog),borderCol,Math.min(1, prog + 0.001),'rgba(255,204,0,0.0)',1,'rgba(255,204,0,0.0)'];
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
      await waitForFrame(map, encoder, program.output?.waitForTiles);
      await addFrame(map, encoder);
    }
    try { map.setPaintProperty('border_trace', 'line-opacity', 0.0); } catch {}
    const showAfter = (program.border?.showStaticAfterTrace !== false);
    if (showAfter) {
      try { map.setPaintProperty('border_drawn', 'line-gradient', undefined); map.setPaintProperty('border_drawn', 'line-color', getBorderColor(program)); map.setPaintProperty('border_drawn', 'line-opacity', program.border?.opacity ?? 1); } catch {}
    }
  }
  async function runHoldPhase(map: any, program: any, fps: number, encoder?: any, signal?: AbortSignal) {
    const holdMs = Math.max(0, Number(program.border?.traceHoldMs ?? 2000));
    const frames = Math.ceil((holdMs / 1000) * fps);
    for (let h = 0; h < frames; h++) {
      if (signal?.aborted) return;
      await new Promise(res => requestAnimationFrame(() => res(undefined)));
      await addFrame(map, encoder);
    }
  }
  async function runHighlightPhase(map: any, program: any, fps: number, encoder?: any, signal?: AbortSignal) {
    const ms = Math.max(500, Number(program.animation?.highlightDurationMs || 1200));
    const frames = Math.ceil((ms / 1000) * fps);
    const targetFill = (typeof program.boundaryFillOpacity === 'number') ? program.boundaryFillOpacity : 0.25;
    const targetLine = 1;
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) return;
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
      await new Promise(res => requestAnimationFrame(() => res(undefined)));
      await addFrame(map, encoder);
    }
  }
  return { lerp, lerpFrame, EASING, findSpan, getBorderColor, getTraceColor, getTraceDelta, runZoomPhase, runWaitPhase, runTracePhase, runHoldPhase, runHighlightPhase };
})();

export interface PlayerOptions {
  container: string | HTMLElement;
  serverBase?: string; // default: same-origin of the served script
  styleUrl?: string; // default: `${serverBase}/style.json`
  maplibreUrl?: string; // default CDN
  maplibreCssUrl?: string; // default CDN
  pixelRatio?: number; // default: from program.output.pixelRatio or device default
}

export interface PlayOptions {
  // If true, wait for map tiles between frames for highest visual fidelity
  waitForTiles?: boolean; // overrides program.output.waitForTiles when provided
}

export interface RecordOptions extends PlayOptions {
  mimeType?: string; // e.g. 'video/webm;codecs=vp9' or 'video/webm;codecs=vp8'
  videoBitsPerSecond?: number; // bitrate hint
}

type MapLibreNS = any; // maplibregl namespace type

// Robust style readiness helper: resolves on next 'styledata' or after timeout
async function waitStyleReady(map: any, timeoutMs = 800) {
  try { if (map?.isStyleLoaded?.()) return; } catch {}
  await new Promise<void>((resolve) => {
    let done = false;
    const onData = () => { if (done) return; done = true; try { map.off?.('styledata', onData); } catch {} resolve(); };
    try { map.on?.('styledata', onData); } catch {}
    setTimeout(() => { if (done) return; done = true; try { map.off?.('styledata', onData); } catch {} resolve(); }, Math.max(100, timeoutMs));
  });
}

function computeBaseFromCurrentScript(): string | undefined {
  try {
    const cur = document.currentScript as HTMLScriptElement | null;
    if (cur?.src) {
      const u = new URL(cur.src, window.location.href);
      return `${u.protocol}//${u.host}`;
    }
  } catch {}
  try {
    // Fallback to same origin
    return window.location.origin;
  } catch {}
  return undefined;
}

async function loadScriptOnce(src: string): Promise<void> {
  if (document.querySelector(`script[data-src="${src}"]`)) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.src = src;
    s.onload = () => resolve(); s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

function injectCssOnce(href: string) {
  if (document.querySelector(`link[data-href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.href = href;
  document.head.appendChild(l);
}

async function ensureMapLibre(maplibreUrl?: string, cssUrl?: string): Promise<MapLibreNS> {
  const JS = maplibreUrl || 'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js';
  const CSS = cssUrl || 'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.css';
  injectCssOnce(CSS);
  const g = (window as any).maplibregl;
  // Prefer v5+; if older present, still load desired version
  const ver: string | undefined = g?.version;
  if (g && /^5\./.test(ver || '')) return g;
  await loadScriptOnce(JS);
  return (window as any).maplibregl;
}

// Lightweight helpers ported for player usage
function toFeatureCollectionMaybe(data: any) {
  if (!data) return { type: 'FeatureCollection', features: [] };
  if (data.type === 'FeatureCollection') return data;
  if (data.type && data.coordinates) return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: data }] };
  return { type: 'FeatureCollection', features: [] };
}

function polygonToLines(fc: any) {
  const out = { type: 'FeatureCollection', features: [] as any[] };
  for (const f of (fc.features || [])) {
    const g = f.geometry; const props = f.properties || {};
    if (!g) continue;
    if (g.type === 'Polygon') {
      for (const ring of g.coordinates) out.features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: ring } });
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) for (const ring of poly) out.features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: ring } });
    }
  }
  return out;
}

// Color helpers are provided by AnimationCore

async function setupBorderLayers(map: any, program: any, worldBorders?: any, anim?: any) {
  try { console.log('[player] setupBorders: isStyleLoaded=', map.isStyleLoaded?.()); } catch {}
  // Choose geometry: prefer explicit boundaryGeoJSON; else try ISO3 from world borders
  let fallbackPolys = { type: 'FeatureCollection', features: [] as any[] };
  if (!program.boundaryGeoJSON && worldBorders && program?.border?.isoA3) {
    try {
      const iso = String(program.border.isoA3 || '').toUpperCase();
      const feats = (worldBorders.features || []).filter((f: any) => {
        const p = f.properties || {}; const candidates = [p.ADM0_A3, p.ISO_A3, p['ISO3166-1-Alpha-3'], p.iso_a3];
        return candidates.map((x: any) => (x || '').toString().toUpperCase()).includes(iso);
      });
      fallbackPolys = { type: 'FeatureCollection', features: feats } as any;
    } catch {}
  }
  const borderPolys = toFeatureCollectionMaybe(program.boundaryGeoJSON || fallbackPolys);
  const borderLines = polygonToLines(borderPolys);

  // Wait for style to be ready (tolerant with timeout)
  await waitStyleReady(map, 800);

  if (map.getSource('border_src')) { (map.getSource('border_src') as any).setData(borderPolys); try { console.log('[player] setupBorders: updated source border_src'); } catch {} }
  else { map.addSource('border_src', { type: 'geojson', data: borderPolys }); try { console.log('[player] setupBorders: added source border_src'); } catch {} }

  if (map.getSource('border_lines_src')) { (map.getSource('border_lines_src') as any).setData(borderLines); try { console.log('[player] setupBorders: updated source border_lines_src'); } catch {} }
  else { map.addSource('border_lines_src', { type: 'geojson', lineMetrics: true as any, data: borderLines }); try { console.log('[player] setupBorders: added source border_lines_src'); } catch {} }

  if (!map.getLayer('border_line')) {
    const borderColor = (anim || AnimationCore).getBorderColor(program);
    map.addLayer({ id: 'border_line', type: 'line', source: 'border_lines_src', paint: { 'line-color': borderColor, 'line-width': program.border?.strokeWidth ?? 4, 'line-opacity': program.border?.opacity ?? 1, 'line-blur': 0 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
    try { console.log('[player] setupBorders: added layer border_line'); } catch {}
    try { map.setPaintProperty('border_line', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
  }
  if (!map.getLayer('border_drawn')) {
    const borderColor = (anim || AnimationCore).getBorderColor(program);
    map.addLayer({ id: 'border_drawn', type: 'line', source: 'border_lines_src', paint: { 'line-color': borderColor, 'line-width': program.border?.strokeWidth ?? 4, 'line-opacity': 0.0 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
    try { console.log('[player] setupBorders: added layer border_drawn'); } catch {}
    try { map.setPaintProperty('border_drawn', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
    try { map.setPaintProperty('border_drawn', 'line-gradient-transition', { duration: 0, delay: 0 }); } catch {}
  }
  if (!map.getLayer('border_trace')) {
    const traceColor = (anim || AnimationCore).getTraceColor(program);
    const traceDelta = (anim || AnimationCore).getTraceDelta(program);
    map.addLayer({ id: 'border_trace', type: 'line', source: 'border_lines_src', paint: { 'line-color': traceColor, 'line-width': (program.border?.strokeWidth ?? 4) + traceDelta, 'line-opacity': 0.0 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
    try { console.log('[player] setupBorders: added layer border_trace'); } catch {}
    try { map.setPaintProperty('border_trace', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
    try { map.setPaintProperty('border_trace', 'line-gradient-transition', { duration: 0, delay: 0 }); } catch {}
  }
}

function setContainerFixedSize(el: HTMLElement, w: number, h: number) {
  el.style.width = `${w}px`; el.style.height = `${h}px`; el.style.position = el.style.position || 'relative';
}

export class MapAnimPlayer {
  private opts: PlayerOptions;
  private serverBase: string;
  private styleUrl: string;
  private container: HTMLElement;
  private map?: any;
  private worldBorders?: any;
  private lastStyleKey?: string;
  private lastSize?: { w: number; h: number };
  private deckOverlay?: any;
  private lastGoogle3dKey?: string;
  private lastProgram?: any;

  static async create(opts: PlayerOptions) {
    const p = new MapAnimPlayer(opts);
    await p.init();
    return p;
  }

  constructor(opts: PlayerOptions) {
    this.opts = opts;
    const base = opts.serverBase || computeBaseFromCurrentScript() || window.location.origin;
    this.serverBase = base.replace(/\/$/, '');
    this.styleUrl = opts.styleUrl || `${this.serverBase}/style.json`;
    const el = typeof opts.container === 'string' ? (document.querySelector(opts.container) as HTMLElement | null) : (opts.container as HTMLElement);
    if (!el) throw new Error('MapAnimPlayer: container not found');
    this.container = el;
  }

  async init() {
    const maplibre = await ensureMapLibre(this.opts.maplibreUrl, this.opts.maplibreCssUrl);
    // Create map container child to ensure fixed size control when recording
    let inner = this.container.querySelector('.mapanim-canvas') as HTMLElement | null;
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'mapanim-canvas';
      inner.style.position = 'absolute'; inner.style.inset = '0';
      this.container.appendChild(inner);
    }
    // Default size; will adjust for program on play/record
    if (!inner.style.width || !inner.style.height) setContainerFixedSize(this.container, 960, 540);

    this.map = new (maplibre as any).Map({ container: inner, style: this.styleUrl, center: [0,0], zoom: 1, pitch: 0, bearing: 0, attributionControl: true, interactive: false });

    // Lazy-load Natural Earth borders for ISO3 fallback (no await)
    try {
      const url = 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson';
      fetch(url).then(r=>r.json()).then(j=>{ this.worldBorders = j; }).catch(()=>{});
    } catch {}

    await new Promise(res => (this.map as any).once('load', res));
  }

  private async ensureDeckAndLoaders() {
    function loadScript(src: string) {
      return new Promise<void>((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.async = true; s.onload = () => res(); s.onerror = (e) => rej(e);
        document.head.appendChild(s);
      });
    }
    // Load deck.gl and loaders.gl UMD bundles lazily when needed
    if (!(window as any).deck) {
      await loadScript('https://unpkg.com/deck.gl@9.1.0/dist.min.js');
    }
    if (!(window as any).loaders) {
      await loadScript('https://unpkg.com/@loaders.gl/core@4.3.4/dist/dist.min.js');
    }
    if (!(window as any).loadersTiles) {
      await loadScript('https://unpkg.com/@loaders.gl/tiles@4.3.4/dist/dist.min.js');
    }
    if (!(window as any).loaders3dTiles) {
      await loadScript('https://unpkg.com/@loaders.gl/3d-tiles@4.3.4/dist/dist.min.js');
    }
  }

  private async updateGoogle3DOverlay(program: any) {
    const apiKey: string | undefined = program?.flags?.google3dApiKey;
    try { console.log('[player] google 3d overlay: key present?', !!apiKey); } catch {}
    if (!this.map) return;
    if (!apiKey) {
      if (this.deckOverlay) {
        try { this.deckOverlay.setProps({ layers: [] }); this.deckOverlay.finalize?.(); } catch {}
        this.deckOverlay = null; this.lastGoogle3dKey = undefined;
      }
      return;
    }
    if (this.lastGoogle3dKey === apiKey && this.deckOverlay) return;
    await this.ensureDeckAndLoaders();
    const deckNS: any = (window as any).deck;
    const loaders3d: any = (window as any).loaders3dTiles || (window as any).loaders?._3dTiles || (window as any).loaders;
    const Tiles3DLoader = loaders3d?.Tiles3DLoader || (loaders3d && loaders3d['Tiles3DLoader']);
    if (!deckNS || !Tiles3DLoader) { try { console.warn('[player] deck.gl not available for 3D overlay'); } catch {} return; }
    const root = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${apiKey}`;
    const layer = new deckNS.Tile3DLayer({
      id: 'google-3d',
      data: root,
      loader: Tiles3DLoader,
      // Nudge quality higher: request finer LOD by lowering screen-space error
      loadOptions: { '3d-tiles': { maximumScreenSpaceError: 1.5 } },
      opacity: (typeof program?.flags?.google3dOpacity === 'number' ? program.flags.google3dOpacity : 1),
      pickable: false
    });
    if (!this.deckOverlay) {
      this.deckOverlay = new deckNS.MapboxOverlay({ interleaved: true, layers: [layer] });
      try { this.map.addControl(this.deckOverlay as any); } catch {}
    } else {
      this.deckOverlay.setProps({ layers: [layer] });
    }
    this.lastGoogle3dKey = apiKey;
  }

  async resolve(payload: { text?: string; program?: any }) {
    const r = await fetch(`${this.serverBase}/api/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`resolve_failed_${r.status}`);
    return await r.json(); // { program }
  }

  private async prepareForProgram(program: any) {
    this.lastProgram = program;
    if (!this.map) throw new Error('player_not_initialized');
    const anim = AnimationCore;
    // Ensure fixed canvas size for fidelity
    const w = Number(program?.output?.width || 960);
    const h = Number(program?.output?.height || 540);
    setContainerFixedSize(this.container, w, h);
    try {
      if (!this.lastSize || this.lastSize.w !== w || this.lastSize.h !== h) {
        this.lastSize = { w, h };
        this.map.resize?.();
        try { console.log('[player] resize after size change', w, 'x', h); } catch {}
      }
    } catch {}
    // Apply style override if provided in program
    const style = program?.style || this.styleUrl;
    try { console.log('[player] prepare: target style:', typeof style === 'string' ? (style.slice(0,80) + (style.length>80?'...':'')) : '[object]'); } catch {}
    try { console.log('[player] prepare: current style name:', (this.map as any).getStyle?.()?.name); } catch {}
    // MapLibre accepts a style URL string or a JS object. Decode data:application/json to an object.
    let styleInput: any = style;
    if (typeof style === 'string' && /^data:application\/json/i.test(style)) {
      try {
        const idx = style.indexOf(',');
        const raw = idx >= 0 ? style.slice(idx+1) : '';
        const jsonStr = /^data:.*;base64,/i.test(style) ? atob(raw) : decodeURIComponent(raw);
        styleInput = JSON.parse(jsonStr);
      } catch {
        styleInput = this.styleUrl;
      }
    }
    // Only setStyle if changed (avoid repeated full style reloads that can race)
    let nextStyleKey = '';
    try { nextStyleKey = typeof styleInput === 'string' ? `str:${styleInput}` : `obj:${JSON.stringify(styleInput)}` } catch { nextStyleKey = 'obj'; }
    if (this.lastStyleKey !== nextStyleKey) {
      try { (this.map as any).setStyle(styleInput); } catch {}
      try { (this.map as any).triggerRepaint?.(); } catch {}
      await waitStyleReady(this.map, 800);
      this.lastStyleKey = nextStyleKey;
      try { console.log('[player] style ready after setStyle:', (this.map as any).isStyleLoaded?.()); } catch {}
    } else {
      try { console.log('[player] style unchanged; skipping setStyle'); } catch {}
    }

    await setupBorderLayers(this.map, program, this.worldBorders, anim);
    // Optional: Google 3D Tiles overlay (preview)
    await this.updateGoogle3DOverlay(program);

    // Optional: fit end keyframe to boundary if explicitly set
    try {
      const feat = (program.boundaryGeoJSON?.features || [])[0];
      const shouldFit = !!(program.animation?.fitFinalToBorder === true && feat?.geometry);
      if (shouldFit && program.camera?.keyframes?.length) {
        const coords = (feat.geometry.type === 'Polygon' ? feat.geometry.coordinates.flat(1) : feat.geometry.coordinates.flat(2));
        const lons = coords.map((c: any) => c[0]); const lats = coords.map((c: any) => c[1]);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons); const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const pad = Number(program.animation?.fitPaddingPx ?? 80);
        const cam = (this.map as any).cameraForBounds([[minLon, minLat],[maxLon, maxLat]], { padding: pad });
        if (cam) {
          const last = program.camera.keyframes[program.camera.keyframes.length - 1];
          if (cam.center) {
            if (Array.isArray(cam.center)) last.center = [cam.center[0], cam.center[1]];
            else if (cam.center && typeof cam.center === 'object') { const lng = (cam.center as any).lng ?? (cam.center as any).lon ?? (cam.center as any).longitude; const lat = (cam.center as any).lat ?? (cam.center as any).latitude; if (isFinite(lng) && isFinite(lat)) last.center = [lng, lat]; }
          }
          if (typeof cam.zoom === 'number' && isFinite(cam.zoom)) last.zoom = cam.zoom;
        }
      }
    } catch {}
  }

  async play(program: ResolvedProgram, opts?: PlayOptions & { onPhaseStart?: (name: string)=>void; onPhaseEnd?: (name: string)=>void; signal?: AbortSignal }) {
    if (!this.map) throw new Error('player_not_initialized');
    try { (this.map as any).stop?.(); } catch {}
    await this.prepareForProgram(program);

    // Access shared animation helpers imported at module load
    const anim = AnimationCore;

    const phases: string[] = (program.animation?.phases && program.animation.phases.length) ? program.animation.phases : ['zoom','trace','hold'];
    const duration: number = program.camera?.keyframes?.at(-1)?.t || 0;
    const easeName: string = program.animation?.easing || 'easeOutCubic';
    const ease = (anim as any).EASING?.[easeName] || (anim as any).EASING.easeOutCubic;
    const fps: number = Number(program.output?.fps || 30);
    const frameCount = Math.ceil((duration / 1000) * fps);
    try { console.log('[player] play: phases=', phases, 'duration(ms)=', duration, 'fps=', fps, 'frames=', frameCount, 'ease=', easeName); } catch {}

    // To enforce tile-complete frames, pass a dummy encoder to shared helpers
    // Only wait when explicitly requested (opts or program flag strictly true)
    const waitForTiles = typeof opts?.waitForTiles === 'boolean' ? opts!.waitForTiles : (program.output?.waitForTiles === true);
    const encoder = waitForTiles ? { add: async () => {} } : undefined;

    for (const phase of phases) {
      try { opts?.onPhaseStart?.(phase); console.log('[player] phase start:', phase); } catch {}
      if (phase === 'zoom') await (anim as any).runZoomPhase(this.map, program, fps, duration, frameCount, ease, encoder, opts?.signal);
      else if (phase === 'highlight') await (anim as any).runHighlightPhase(this.map, program, fps, encoder, opts?.signal);
      else if (phase === 'wait') await (anim as any).runWaitPhase(this.map, Number(program.animation?.waitBeforeTraceMs || 0), fps, encoder, opts?.signal);
      else if (phase === 'trace') await (anim as any).runTracePhase(this.map, program, fps, encoder, opts?.signal);
      else if (phase === 'hold') await (anim as any).runHoldPhase(this.map, program, fps, encoder, opts?.signal);
      try { opts?.onPhaseEnd?.(phase); console.log('[player] phase end:', phase); } catch {}
    }
  }

  // Compute total timeline duration across declared phases
  getDuration(program: any): number {
    if (!program) return 3000
    const phases: string[] = (program?.animation?.phases && program.animation.phases.length) ? program.animation.phases : ['zoom','trace','hold'];
    const duration: number = program?.camera?.keyframes?.at?.(-1)?.t || 0;
    const waitMs = Math.max(0, Number(program.animation?.waitBeforeTraceMs || 0));
    const traceMs = Math.max(0, Number(program.border?.traceDurationMs ?? 3000));
    const holdMs = Math.max(0, Number(program.border?.traceHoldMs ?? 2000));
    const highlightMs = Math.max(500, Number(program.animation?.highlightDurationMs || 1200));
    let total = 0;
    for (const ph of phases) {
      if (ph === 'zoom') total += duration;
      else if (ph === 'wait') total += waitMs;
      else if (ph === 'trace') total += traceMs;
      else if (ph === 'hold') total += holdMs;
      else if (ph === 'highlight') total += highlightMs;
    }
    return total || duration || 3000;
  }

  // Move visual state to a specific time (ms) on the full timeline
  async seek(program: any, tMs: number) {
    if (!this.map) throw new Error('player_not_initialized');
    if (!program) return;
    this.lastProgram = program;
    await waitStyleReady(this.map, 400);
    const anim = AnimationCore as any;
    const phases: string[] = (program?.animation?.phases && program.animation.phases.length) ? program.animation.phases : ['zoom','trace','hold'];
    const duration: number = program?.camera?.keyframes?.at?.(-1)?.t || 0;
    const waitMs = Math.max(0, Number(program.animation?.waitBeforeTraceMs || 0));
    const traceMs = Math.max(0, Number(program.border?.traceDurationMs ?? 3000));
    const holdMs = Math.max(0, Number(program.border?.traceHoldMs ?? 2000));
    const highlightMs = Math.max(500, Number(program.animation?.highlightDurationMs || 1200));
    const easeName: string = program.animation?.easing || 'easeOutCubic';
    const ease = anim.EASING?.[easeName] || anim.EASING.easeOutCubic;

    const segs: Array<{ name: string; dur: number }> = [];
    for (const ph of phases) {
      if (ph === 'zoom') segs.push({ name: 'zoom', dur: duration });
      else if (ph === 'wait') segs.push({ name: 'wait', dur: waitMs });
      else if (ph === 'trace') segs.push({ name: 'trace', dur: traceMs });
      else if (ph === 'hold') segs.push({ name: 'hold', dur: holdMs });
      else if (ph === 'highlight') segs.push({ name: 'highlight', dur: highlightMs });
    }
    const total = segs.reduce((a, s) => a + s.dur, 0) || duration;
    let t = Math.max(0, Math.min(tMs, total));

    // Baseline paints
    try {
      const borderOpacity = program.border?.opacity ?? 1;
      this.map.setPaintProperty('border_trace', 'line-opacity', 0.0);
      this.map.setPaintProperty('border_drawn', 'line-opacity', borderOpacity);
      this.map.setPaintProperty('border_drawn', 'line-gradient', undefined);
    } catch {}

    let idx = 0; let acc = 0;
    for (; idx < segs.length; idx++) { const d = segs[idx].dur; if (t <= acc + d) break; acc += d; }
    const cur = segs[idx] || { name: 'zoom', dur: duration };
    const local = cur.dur ? Math.max(0, Math.min(cur.dur, t - acc)) : 0;

    if (cur.name === 'zoom') {
      const tt = cur.dur > 0 ? ease(local / cur.dur) * duration : 0;
      const [aIdx, bIdx] = anim.findSpan(program.camera.keyframes, tt);
      const a = program.camera.keyframes[aIdx]; const b = program.camera.keyframes[bIdx];
      const spanT = a.t === b.t ? 0 : (tt - a.t) / (b.t - a.t);
      const pose = anim.lerpFrame(a, b, spanT);
      try { this.map.jumpTo({ center: [pose.center[0], pose.center[1]], zoom: (function(){ const zBias = Number(program.animation?.zoomOffset ?? -0.5); return pose.zoom + zBias; })(), bearing: pose.bearing, pitch: pose.pitch }); } catch {}
      try { if (!program.border?.showDuringZoom) { this.map.setPaintProperty('border_line', 'line-opacity', 0.0); this.map.setPaintProperty('border_drawn', 'line-opacity', 0.0); } } catch {}
    } else if (cur.name === 'wait') {
      try { if (!program.border?.showDuringZoom) { this.map.setPaintProperty('border_line', 'line-opacity', 0.0); this.map.setPaintProperty('border_drawn', 'line-opacity', 0.0); } } catch {}
    } else if (cur.name === 'highlight') {
      const p = cur.dur > 0 ? local / cur.dur : 1;
      const v = anim.EASING.easeOutCubic(p);
      try {
        if (this.map.getLayer('boundary-fill')) {
          const targetFill = (typeof program.boundaryFillOpacity === 'number') ? program.boundaryFillOpacity : 0.25;
          this.map.setPaintProperty('boundary-fill', 'fill-opacity', targetFill * v);
          if (this.map.getLayer('boundary-line')) this.map.setPaintProperty('boundary-line', 'line-opacity', 1 * v);
        }
      } catch {}
    } else if (cur.name === 'trace') {
      const prog = cur.dur > 0 ? (local / cur.dur) + 0.03 : 1.0;
      const borderCol = anim.getBorderColor(program);
      const gradTrace = ['interpolate',['linear'],['line-progress'],0,'rgba(255,255,255,0.0)',Math.max(0, prog - 0.02),'rgba(255,255,255,0.0)',prog,'rgba(255,255,255,1.0)',Math.min(1, prog + 0.02),'rgba(255,255,255,0.0)',1,'rgba(255,255,255,0.0)'];
      const gradDrawn = ['interpolate',['linear'],['line-progress'],0,borderCol,Math.max(0, prog),borderCol,Math.min(1, prog + 0.001),'rgba(255,204,0,0.0)',1,'rgba(255,204,0,0.0)'];
      try {
        this.map.setPaintProperty('border_trace', 'line-gradient', gradTrace);
        this.map.setPaintProperty('border_trace', 'line-color', anim.getTraceColor(program));
        this.map.setPaintProperty('border_trace', 'line-opacity', 1.0);
        this.map.setPaintProperty('border_drawn', 'line-gradient', gradDrawn);
        this.map.setPaintProperty('border_drawn', 'line-opacity', program.border?.opacity ?? 1);
      } catch (e) {
        try {
          this.map.setPaintProperty('border_trace', 'line-gradient', undefined);
          this.map.setPaintProperty('border_trace', 'line-color', anim.getTraceColor(program));
          this.map.setPaintProperty('border_trace', 'line-opacity', 1.0);
          this.map.setPaintProperty('border_drawn', 'line-gradient', undefined);
          this.map.setPaintProperty('border_drawn', 'line-color', borderCol);
          this.map.setPaintProperty('border_drawn', 'line-opacity', program.border?.opacity ?? 1);
        } catch {}
      }
    } else if (cur.name === 'hold') {
      try {
        this.map.setPaintProperty('border_trace', 'line-opacity', 0.0);
        this.map.setPaintProperty('border_drawn', 'line-gradient', undefined);
        this.map.setPaintProperty('border_drawn', 'line-color', (AnimationCore as any).getBorderColor(program));
        this.map.setPaintProperty('border_drawn', 'line-opacity', program.border?.opacity ?? 1);
      } catch {}
    }
    try { (this.map as any).triggerRepaint?.(); } catch {}
  }

  // Faster, synchronous preview that does not wait on style events. Uses last prepared program if not supplied.
  preview(opts: { program?: any; timeMs: number }) {
    if (!this.map) throw new Error('player_not_initialized');
    const program = opts.program || this.lastProgram;
    if (!program) return;
    const tMs = Math.max(0, Number(opts.timeMs) || 0);
    const anim = AnimationCore as any;
    const phases: string[] = (program?.animation?.phases && program.animation.phases.length) ? program.animation.phases : ['zoom','trace','hold'];
    const duration: number = program?.camera?.keyframes?.at?.(-1)?.t || 0;
    const waitMs = Math.max(0, Number(program.animation?.waitBeforeTraceMs || 0));
    const traceMs = Math.max(0, Number(program.border?.traceDurationMs ?? 3000));
    const holdMs = Math.max(0, Number(program.border?.traceHoldMs ?? 2000));
    const highlightMs = Math.max(500, Number(program.animation?.highlightDurationMs || 1200));
    const easeName: string = program.animation?.easing || 'easeOutCubic';
    const ease = anim.EASING?.[easeName] || anim.EASING.easeOutCubic;

    const segs: Array<{ name: string; dur: number }> = [];
    for (const ph of phases) {
      if (ph === 'zoom') segs.push({ name: 'zoom', dur: duration });
      else if (ph === 'wait') segs.push({ name: 'wait', dur: waitMs });
      else if (ph === 'trace') segs.push({ name: 'trace', dur: traceMs });
      else if (ph === 'hold') segs.push({ name: 'hold', dur: holdMs });
      else if (ph === 'highlight') segs.push({ name: 'highlight', dur: highlightMs });
    }
    const total = segs.reduce((a, s) => a + s.dur, 0) || duration;
    const t = Math.max(0, Math.min(tMs, total));

    try {
      const borderOpacity = program.border?.opacity ?? 1;
      this.map.setPaintProperty('border_trace', 'line-opacity', 0.0);
      this.map.setPaintProperty('border_drawn', 'line-opacity', borderOpacity);
      this.map.setPaintProperty('border_drawn', 'line-gradient', undefined);
    } catch {}

    let idx = 0; let acc = 0;
    for (; idx < segs.length; idx++) { const d = segs[idx].dur; if (t <= acc + d) break; acc += d; }
    const cur = segs[idx] || { name: 'zoom', dur: duration };
    const local = cur.dur ? Math.max(0, Math.min(cur.dur, t - acc)) : 0;

    if (cur.name === 'zoom') {
      const tt = cur.dur > 0 ? ease(local / cur.dur) * duration : 0;
      const [aIdx, bIdx] = anim.findSpan(program.camera.keyframes, tt);
      const a = program.camera.keyframes[aIdx]; const b = program.camera.keyframes[bIdx];
      const spanT = a.t === b.t ? 0 : (tt - a.t) / (b.t - a.t);
      const pose = anim.lerpFrame(a, b, spanT);
      try { this.map.jumpTo({ center: [pose.center[0], pose.center[1]], zoom: (function(){ const zBias = Number(program.animation?.zoomOffset ?? -0.5); return pose.zoom + zBias; })(), bearing: pose.bearing, pitch: pose.pitch }); } catch {}
      try { if (!program.border?.showDuringZoom) { this.map.setPaintProperty('border_line', 'line-opacity', 0.0); this.map.setPaintProperty('border_drawn', 'line-opacity', 0.0); } } catch {}
    } else if (cur.name === 'wait') {
      try { if (!program.border?.showDuringZoom) { this.map.setPaintProperty('border_line', 'line-opacity', 0.0); this.map.setPaintProperty('border_drawn', 'line-opacity', 0.0); } } catch {}
    } else if (cur.name === 'highlight') {
      const p = cur.dur > 0 ? local / cur.dur : 1;
      const v = anim.EASING.easeOutCubic(p);
      try {
        if (this.map.getLayer('boundary-fill')) {
          const targetFill = (typeof program.boundaryFillOpacity === 'number') ? program.boundaryFillOpacity : 0.25;
          this.map.setPaintProperty('boundary-fill', 'fill-opacity', targetFill * v);
          if (this.map.getLayer('boundary-line')) this.map.setPaintProperty('boundary-line', 'line-opacity', 1 * v);
        }
      } catch {}
    } else if (cur.name === 'trace') {
      const prog = cur.dur > 0 ? (local / cur.dur) + 0.03 : 1.0;
      const borderCol = anim.getBorderColor(program);
      const gradTrace = ['interpolate',['linear'],['line-progress'],0,'rgba(255,255,255,0.0)',Math.max(0, prog - 0.02),'rgba(255,255,255,0.0)',prog,'rgba(255,255,255,1.0)',Math.min(1, prog + 0.02),'rgba(255,255,255,0.0)',1,'rgba(255,255,255,0.0)'];
      const gradDrawn = ['interpolate',['linear'],['line-progress'],0,borderCol,Math.max(0, prog),borderCol,Math.min(1, prog + 0.001),'rgba(255,204,0,0.0)',1,'rgba(255,204,0,0.0)'];
      try {
        this.map.setPaintProperty('border_trace', 'line-gradient', gradTrace);
        this.map.setPaintProperty('border_trace', 'line-color', anim.getTraceColor(program));
        this.map.setPaintProperty('border_trace', 'line-opacity', 1.0);
        this.map.setPaintProperty('border_drawn', 'line-gradient', gradDrawn);
        this.map.setPaintProperty('border_drawn', 'line-opacity', program.border?.opacity ?? 1);
      } catch (e) {
        try {
          this.map.setPaintProperty('border_trace', 'line-gradient', undefined);
          this.map.setPaintProperty('border_trace', 'line-color', anim.getTraceColor(program));
          this.map.setPaintProperty('border_trace', 'line-opacity', 1.0);
          this.map.setPaintProperty('border_drawn', 'line-gradient', undefined);
          this.map.setPaintProperty('border_drawn', 'line-color', borderCol);
          this.map.setPaintProperty('border_drawn', 'line-opacity', program.border?.opacity ?? 1);
        } catch {}
      }
    } else if (cur.name === 'hold') {
      try {
        this.map.setPaintProperty('border_trace', 'line-opacity', 0.0);
        this.map.setPaintProperty('border_drawn', 'line-gradient', undefined);
        this.map.setPaintProperty('border_drawn', 'line-color', (AnimationCore as any).getBorderColor(program));
        this.map.setPaintProperty('border_drawn', 'line-opacity', program.border?.opacity ?? 1);
      } catch {}
    }
    try { (this.map as any).triggerRepaint?.(); } catch {}
  }

  setTime(ms: number) {
    return this.preview({ timeMs: ms })
  }

  setProgress(p: number) {
    const prog = this.lastProgram;
    if (!prog) return;
    const total = this.getDuration(prog);
    const ms = Math.max(0, Math.min(1, Number(p) || 0)) * total;
    return this.preview({ timeMs: ms })
  }
  async record(program: ResolvedProgram, opts?: RecordOptions & { signal?: AbortSignal }): Promise<Blob> {
    if (!this.map) throw new Error('player_not_initialized');
    await this.prepareForProgram(program);
    // Ensure first frame is rendered before starting recording
    await this.seek(program, 0);
    await new Promise(res => requestAnimationFrame(() => res(undefined)));

    const canvas: HTMLCanvasElement = this.map.getCanvas();
    const fps = Number(program.output?.fps || 30);
    const stream = (canvas as any).captureStream ? (canvas as any).captureStream(fps) : (canvas as any).captureStream?.();
    if (!stream) throw new Error('captureStream_not_supported');

    const chunks: BlobPart[] = [];
    const mime = opts?.mimeType || 'video/webm;codecs=vp9';
    const rec: MediaRecorder = new (window as any).MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts?.videoBitsPerSecond || 8_000_000 });
    await new Promise<void>((resolve, reject) => {
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve();
      rec.onerror = (e) => reject((e as any)?.error || e);
      rec.start(Math.round(1000 / fps)); // timeslice flush
      // High-fidelity playback while recording by default
      const playOpts: any = { ...(opts || {}), waitForTiles: opts?.waitForTiles !== false };
      this.play(program, playOpts).then(() => rec.stop()).catch((e) => { try { rec.stop(); } catch {} reject(e); });
    });
    return new Blob(chunks, { type: mime });
  }
}


export async function createPlayer(opts: PlayerOptions) {
  return await MapAnimPlayer.create(opts);
}

// Also attach to window for non-ESM script tag usage
try { (window as any).MapAnimPlayer = MapAnimPlayer; (window as any).createMapAnimPlayer = createPlayer; } catch {}

// Re-export phase helpers so consumers can call them directly from this module
// without importing animation-core separately. These are thin forwarders.
export const EASING: any = (AnimationCore as any).EASING;
export function lerp(...args: any[]) { return (AnimationCore as any).lerp(...args); }
export function lerpFrame(...args: any[]) { return (AnimationCore as any).lerpFrame(...args); }
export function findSpan(...args: any[]) { return (AnimationCore as any).findSpan(...args); }

export function getBorderColor(program: any) { return (AnimationCore as any).getBorderColor(program); }
export function getTraceColor(program: any) { return (AnimationCore as any).getTraceColor(program); }
export function getTraceDelta(program: any) { return (AnimationCore as any).getTraceDelta(program); }

export function runZoomPhase(...args: any[]) { return (AnimationCore as any).runZoomPhase(...args); }
export function runWaitPhase(...args: any[]) { return (AnimationCore as any).runWaitPhase(...args); }
export function runTracePhase(...args: any[]) { return (AnimationCore as any).runTracePhase(...args); }
export function runHoldPhase(...args: any[]) { return (AnimationCore as any).runHoldPhase(...args); }
export function runHighlightPhase(...args: any[]) { return (AnimationCore as any).runHighlightPhase(...args); }
