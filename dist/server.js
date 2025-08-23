import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowserWithWebGL } from "./webgl-launch.js";
import { nlToProgram } from "./llm.js";
import { MapProgram as MapProgramSchema } from "./program-schema.js";
import fetch from "node-fetch";
import * as topojson from "topojson-client";
import { putVideoWebm, putJsonTemplate, putVideoMp4 } from "./storage.js";
import { BrowserPool } from "./browser-pool.js";
import { spawnFfmpegNvenc } from "./ffmpeg-pipeline.js";
import pThrottle from "p-throttle";
import cors from "cors";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
const pool = new BrowserPool(Number(process.env.BROWSER_POOL_SIZE || 2));
const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin }));
// Serve local MapLibre styles from the repo's styles folder
const stylesDir = path.join(__dirname, "..", "styles");
app.use("/styles", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS")
        return res.sendStatus(204);
    next();
}, express.static(stylesDir));
app.get("/healthz", (_, res) => res.send("ok"));
// Serve browser player and shared helpers for in-browser rendering
// - /player/map-anim-player.js -> compiled player bundle (dist/player.js)
// - /player/shared/* -> reuse shared animation helpers used by web preview
{
    const distDir = path.join(__dirname);
    app.get("/player/map-anim-player.js", async (_req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        console.log("retrieving anim player");
        try {
            const fs = await import("node:fs/promises");
            const pathJsDist = path.join(distDir, "player.js"); // built output
            const pathTsSrc = path.join(__dirname, "player.ts"); // dev source
            // Prefer built JS
            try {
                const js = await fs.readFile(pathJsDist, "utf8");
                return res.send(js);
            }
            catch { }
            // Dev fallback: transpile TS on the fly
            try {
                const tsCode = await fs.readFile(pathTsSrc, "utf8");
                let jsCode = tsCode;
                try {
                    const ts = await import("typescript");
                    const out = ts.transpileModule(tsCode, { compilerOptions: { module: 99 /* ESNext */, target: 7 /* ES2020 */, sourceMap: false } });
                    jsCode = out.outputText || tsCode;
                }
                catch { }
                return res.send(jsCode);
            }
            catch (e2) {
                return res.status(404).send(`// player not available. Build with npm run build.\n// ${e2?.message || e2}`);
            }
        }
        catch (e) {
            return res.status(500).send(`// player route error\n// ${e?.message || e}`);
        }
    });
    const sharedDir = path.join(__dirname, "..", "web", "src", "shared");
    app.use("/player/shared", (req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");
        if (req.method === "OPTIONS")
            return res.sendStatus(204);
        next();
    }, express.static(sharedDir));
}
// Serve a patched style.json with MAPTILER_KEY injected for frontend preview usage
app.get("/style.json", async (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
        const isUrl = (s) => /^(https?:|data:)/i.test(s);
        const remote = process.env.MAP_STYLE_REMOTE || "https://github.com/openmaptiles/dark-matter-gl-style";
        let styleUrl = remote;
        if (!/\.json(\?|#|$)/i.test(remote)) {
            const m = remote.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/|$)/i);
            if (m) {
                const org = m[1];
                const repo = m[2];
                const branch = process.env.MAP_STYLE_REMOTE_BRANCH || "master";
                const pathInRepo = process.env.MAP_STYLE_REMOTE_PATH || "style.json";
                styleUrl = `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${pathInRepo}`;
            }
            else if (!isUrl(remote)) {
                return res.status(400).json({ error: "MAP_STYLE_REMOTE must be a URL or GitHub repo" });
            }
        }
        const r = await fetch(styleUrl);
        if (!r.ok)
            return res.status(r.status).send(await r.text());
        let txt = await r.text();
        const key = process.env.MAPTILER_KEY || "";
        if (key) {
            txt = txt.replace(/\{key\}/g, key).replace(/%7Bkey%7D/gi, encodeURIComponent(key)).replace(/\$\{key\}/g, key);
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.send(txt);
    }
    catch (e) {
        console.error("/style.json error", e);
        return res.status(500).json({ error: e?.message || String(e) });
    }
});
/**
 * POST /api/render
 * Streams MP4 over HTTP using NVENC/libx264.
 * body: { text?: string, program?: MapProgram }
 */
app.post("/api/render", async (req, res) => {
    let lease;
    let ffmpeg;
    try {
        const text = req.body?.text;
        const incomingProgram = req.body?.program;
        let program;
        if (incomingProgram) {
            const parsed = MapProgramSchema.safeParse?.(incomingProgram);
            if (!parsed?.success)
                return res.status(400).json({ error: "Invalid 'program' payload", details: parsed?.error?.message ?? parsed?.error });
            program = parsed.data;
        }
        else if (text) {
            program = await nlToProgram(text);
        }
        else {
            return res.status(400).json({ error: "Provide 'text' or 'program'" });
        }
        program = await augmentProgram(program, text);
        // Style resolution and MapTiler substitution (same as animate)
        const isUrl = (s) => /^(https?:|data:)/i.test(s);
        function resolveRemoteStyle() {
            const remote = process.env.MAP_STYLE_REMOTE || "https://github.com/openmaptiles/dark-matter-gl-style";
            if (!remote)
                return undefined;
            if (/\.json(\?|#|$)/i.test(remote))
                return remote;
            const m = remote.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/|$)/i);
            if (m) {
                const org = m[1];
                const repo = m[2];
                const branch = process.env.MAP_STYLE_REMOTE_BRANCH || "master";
                const pathInRepo = process.env.MAP_STYLE_REMOTE_PATH || "style.json";
                return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${pathInRepo}`;
            }
            return remote;
        }
        if (!program.style)
            program.style = resolveRemoteStyle();
        async function withMaptilerKey(styleUrl) {
            if (!styleUrl)
                return styleUrl;
            const key = process.env.MAPTILER_KEY;
            if (!key)
                return styleUrl;
            try {
                const r = await fetch(styleUrl);
                if (!r.ok)
                    return styleUrl;
                let txt = await r.text();
                txt = txt.replace(/\{key\}/g, key).replace(/%7Bkey%7D/gi, encodeURIComponent(key)).replace(/\$\{key\}/g, key);
                return "data:application/json;charset=utf-8;base64," + Buffer.from(txt, "utf8").toString("base64");
            }
            catch {
                return styleUrl;
            }
        }
        program.style = await withMaptilerKey(program.style);
        // Performance toggles
        function applyPerformanceToggles(p) {
            const quality = (process.env.RENDER_QUALITY || "fast").toLowerCase();
            const envWait = process.env.RENDER_WAIT_FOR_TILES;
            const envPxr = process.env.RENDER_PIXEL_RATIO;
            const envMaxFps = process.env.RENDER_MAX_FPS;
            if (!p.output)
                p.output = {};
            if (typeof envWait !== "undefined")
                p.output.waitForTiles = /^(1|true|yes)$/i.test(String(envWait));
            else if (typeof p.output.waitForTiles === "undefined")
                p.output.waitForTiles = quality === "high";
            if (typeof envPxr !== "undefined")
                p.output.pixelRatio = Math.max(1, Math.min(4, Number(envPxr) || 1));
            else {
                const cur = Number(p.output.pixelRatio);
                if (!cur || cur > 2)
                    p.output.pixelRatio = 1;
            }
            const cap = envMaxFps ? Number(envMaxFps) : (quality === "high" ? undefined : 30);
            if (cap && Number.isFinite(cap))
                p.output.fps = Math.min(p.output.fps || cap, cap);
            return p;
        }
        program = applyPerformanceToggles(program);
        const cssW = program.output.width;
        const cssH = program.output.height;
        const fps = program.output.fps || 30;
        const pxr = Math.max(1, Math.min(4, Number(program.output.pixelRatio) || 1));
        const capW = (cssW * pxr) | 0;
        const capH = (cssH * pxr) | 0;
        lease = await pool.lease();
        const page = lease.page;
        // Borders provider
        const fs = await import("node:fs/promises");
        await page.exposeFunction("__nodeGetBordersGeoJSON", async () => {
            const localPath = process.env.BORDERS_GEOJSON_PATH;
            const remoteUrl = process.env.BORDERS_GEOJSON_URL || "https://unpkg.com/world-atlas@2.0.2/countries-10m.json";
            try {
                if (localPath) {
                    const txt = await fs.readFile(localPath, "utf8");
                    return JSON.parse(txt);
                }
            }
            catch (e) {
                console.warn("[renderer] failed reading local borders file", localPath, e);
            }
            const r = await fetch(remoteUrl);
            if (!r.ok)
                throw new Error(`Failed to fetch borders: ${r.status}`);
            const data = await r.json();
            if (data && data.type === "Topology") {
                try {
                    const geo = topojson.feature(data, data.objects.countries);
                    return geo;
                }
                catch {
                    return data;
                }
            }
            return data;
        });
        // ffmpeg pipeline streaming to HTTP
        ffmpeg = spawnFfmpegNvenc({ width: capW, height: capH, fps, format: "mp4", encoder: process.env.RENDER_ENCODER || "h264_nvenc" });
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("X-Encoder", ffmpeg.encoderName);
        ffmpeg.proc.stdout.pipe(res);
        ffmpeg.proc.stderr.on("data", (d) => process.env.DEBUG_FFMPEG && console.error("[ffmpeg]", d.toString()));
        await page.exposeFunction("__nodeDeliverFrameRGBA", async (payload) => {
            function toBuffer(u8) {
                if (!u8)
                    throw new Error("empty_payload");
                if (typeof ArrayBuffer !== "undefined" && u8 instanceof ArrayBuffer)
                    return Buffer.from(new Uint8Array(u8));
                if (u8?.buffer instanceof ArrayBuffer && typeof u8.byteLength === "number")
                    return Buffer.from(new Uint8Array(u8.buffer, u8.byteOffset ?? 0, u8.byteLength));
                if (Array.isArray(u8?.data))
                    return Buffer.from(u8.data);
                if (Array.isArray(u8))
                    return Buffer.from(u8);
                if (typeof u8 === "object" && typeof u8.length === "number")
                    return Buffer.from(Array.from(u8));
                throw new Error("unsupported_payload_type:" + (typeof u8));
            }
            const buf = toBuffer(payload);
            if (!ffmpeg)
                throw new Error("ffmpeg not initialized");
            if (!ffmpeg.proc.stdin.write(buf)) {
                await new Promise((resolve) => ffmpeg.proc.stdin.once("drain", () => resolve()));
            }
            return true;
        });
        await page.exposeFunction("__nodeDeliverEnd", async () => {
            try {
                ffmpeg?.proc.stdin.end();
            }
            catch { }
            return true;
        });
        await page.setViewport({ width: cssW, height: cssH, deviceScaleFactor: 1 });
        await page.evaluate((p) => window.startRender(p), program);
        // finalize stream
        await new Promise((resolve) => ffmpeg?.proc.on("close", () => resolve()));
    }
    catch (e) {
        console.error("[/api/render] error", e);
        if (!res.headersSent)
            res.status(500).json({ error: e?.message || "render_failed" });
    }
    finally {
        try {
            lease?.release();
        }
        catch { }
    }
});
app.post("/api/llm/parse", async (req, res) => {
    try {
        const text = req.body?.text;
        if (!text)
            return res.status(400).json({ error: "Missing 'text'." });
        const program = await nlToProgram(text);
        res.json({ program });
    }
    catch (e) {
        res.status(500).json({ error: e.message || "llm_failed" });
    }
});
// --- Geocode (Nominatim) with throttle per usage policy
const NOM_HOST = process.env.NOMINATIM_HOST || "https://nominatim.openstreetmap.org";
const NOM_UA = process.env.NOMINATIM_USER_AGENT || "map-anim-service/unknown";
const geocodeThrottle = pThrottle({ limit: 1, interval: 1000 });
const geocodeRaw = async (q) => {
    const url = new URL("/search", NOM_HOST);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    const r = await fetch(url.toString(), { headers: { "User-Agent": NOM_UA, "Referer": "https://render.com" } });
    if (!r.ok)
        throw new Error(`nominatim_${r.status}`);
    const arr = (await r.json());
    if (!arr.length)
        throw new Error("not_found");
    const { lat, lon, boundingbox } = arr[0] || {};
    return { lat: Number(lat), lon: Number(lon), bbox: (boundingbox || []).map(Number) };
};
const geocode = geocodeThrottle(geocodeRaw);
app.get("/api/geocode", async (req, res) => {
    try {
        const q = String(req.query.q || "");
        if (!q)
            return res.status(400).json({ error: "missing q" });
        const data = await geocode(q);
        res.json(data);
    }
    catch (e) {
        res.status(502).json({ error: e?.message || String(e) });
    }
});
// --- Nominatim boundary polygon (preferred for fill/outline); throttle too
const boundaryThrottle = pThrottle({ limit: 1, interval: 1000 });
async function fetchNominatimBoundaryGeoJSON(name) {
    const url = new URL("/search", NOM_HOST);
    url.searchParams.set("q", name);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("polygon_geojson", "1");
    url.searchParams.set("polygon_threshold", "0.0");
    const r = await fetch(url.toString(), { headers: { "User-Agent": NOM_UA, "Referer": "https://render.com" } });
    if (!r.ok)
        throw new Error(`nominatim_${r.status}`);
    const arr = (await r.json());
    if (!arr.length)
        throw new Error("not_found");
    const first = arr[0];
    const gj = first?.geojson;
    if (!gj)
        throw new Error("no_geojson");
    const feature = { type: "Feature", properties: { name: first?.display_name }, geometry: gj };
    return { type: "FeatureCollection", features: [feature] };
}
const fetchNominatimBoundary = boundaryThrottle(fetchNominatimBoundaryGeoJSON);
// --- Overpass boundary endpoint (simple city/area relation lookup)
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
async function fetchBoundaryGeoJSON(name) {
    const q = `
[out:json][timeout:60];
rel["boundary"="administrative"]["name"="${name}"];
out ids; >; out geom;
`;
    const r = await fetch(OVERPASS, { method: "POST", body: q, headers: { "Content-Type": "text/plain" } });
    if (!r.ok)
        throw new Error(`overpass_${r.status}`);
    const data = (await r.json());
    const features = (data.elements || [])
        .filter((e) => e.type === "relation" && e.tags?.boundary === "administrative")
        .map((rel) => {
        const coords = (rel.members || [])
            .filter((m) => m.geometry)
            .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
        return { type: "Feature", properties: { id: rel.id, name: rel.tags?.name, admin_level: rel.tags?.admin_level }, geometry: { type: "MultiLineString", coordinates: coords } };
    });
    return { type: "FeatureCollection", features };
}
app.get("/api/osm/boundary", async (req, res) => {
    try {
        const name = String(req.query.name || "");
        if (!name)
            return res.status(400).json({ error: "missing name" });
        let gj;
        try {
            gj = await fetchNominatimBoundary(name);
        }
        catch (e) {
            console.warn('[boundary] nominatim failed; falling back to overpass', e?.message || e);
            gj = await fetchBoundaryGeoJSON(name);
        }
        res.json(gj);
    }
    catch (e) {
        res.status(502).json({ error: e?.message || String(e) });
    }
});
// Resolve: produce a fully-augmented program (geocode, boundary, 3D flags, style substitution)
app.post("/api/resolve", async (req, res) => {
    try {
        const text = req.body?.text;
        const incomingProgram = req.body?.program;
        const requestedDurationMs = (() => { const v = Number(req.body?.durationMs || req.body?.program?.output?.durationMs || req.body?.program?.animation?.durationMs); return Number.isFinite(v) && v > 0 ? v : undefined; })();
        let program;
        console.log("got", text, incomingProgram);
        if (incomingProgram) {
            const parsed = MapProgramSchema.safeParse?.(incomingProgram);
            if (!parsed?.success)
                return res.status(400).json({ error: "Invalid 'program' payload", details: parsed?.error?.message ?? parsed?.error });
            program = parsed.data;
        }
        else if (text) {
            program = await nlToProgram(text);
        }
        else {
            return res.status(400).json({ error: "Provide 'text' or 'program'" });
        }
        program = await augmentProgram(program, text);
        console.log("program is augemnted");
        console.log(program);
        // Resolve style and MapTiler key substitution (same path as animate)
        const isUrl = (s) => /^(https?:|data:)/i.test(s);
        function resolveRemoteStyle() {
            const remote = process.env.MAP_STYLE_REMOTE || "https://github.com/openmaptiles/dark-matter-gl-style";
            if (!remote)
                return undefined;
            if (/\.json(\?|#|$)/i.test(remote))
                return remote;
            const m = remote.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/|$)/i);
            if (m) {
                const org = m[1];
                const repo = m[2];
                const branch = process.env.MAP_STYLE_REMOTE_BRANCH || "master";
                const pathInRepo = process.env.MAP_STYLE_REMOTE_PATH || "style.json";
                return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${pathInRepo}`;
            }
            return remote;
        }
        if (!program.style) {
            const derived = resolveRemoteStyle();
            if (derived)
                program.style = derived;
        }
        if (process.env.MAPTILER_KEY) {
            program.style = (await (async (styleUrl) => {
                try {
                    const r = await fetch(styleUrl);
                    if (!r.ok)
                        return styleUrl;
                    let txt = await r.text();
                    const key = process.env.MAPTILER_KEY;
                    txt = txt.replace(/\{key\}/g, key).replace(/%7Bkey%7D/gi, encodeURIComponent(key)).replace(/\$\{key\}/g, key);
                    return "data:application/json;charset=utf-8;base64," + Buffer.from(txt, "utf8").toString("base64");
                }
                catch {
                    return styleUrl;
                }
            })(program.style));
        }
        // Apply performance toggles as in animate (so preview matches)
        program = (function applyPerformanceToggles(p) {
            const quality = (process.env.RENDER_QUALITY || 'fast').toLowerCase();
            const envWait = process.env.RENDER_WAIT_FOR_TILES;
            const envPxr = process.env.RENDER_PIXEL_RATIO;
            const envMaxFps = process.env.RENDER_MAX_FPS;
            if (!p.output)
                p.output = {};
            if (typeof envWait !== 'undefined')
                p.output.waitForTiles = /^(1|true|yes)$/i.test(String(envWait));
            else if (typeof p.output.waitForTiles === 'undefined')
                p.output.waitForTiles = quality === 'high' ? true : false;
            if (typeof envPxr !== 'undefined')
                p.output.pixelRatio = Math.max(1, Math.min(4, Number(envPxr) || 1));
            else if (quality !== 'high') {
                const cur = Number(p.output.pixelRatio);
                if (!cur || cur > 2)
                    p.output.pixelRatio = 1;
            }
            const cap = envMaxFps ? Number(envMaxFps) : (quality === 'high' ? undefined : 30);
            if (cap && Number.isFinite(cap))
                p.output.fps = Math.min(p.output.fps || cap, cap);
            return p;
        })(program);
        // Optional: scale camera keyframes to the requested duration for the zoom phase only
        try {
            if (requestedDurationMs && program?.camera?.keyframes?.length) {
                const kfs = program.camera.keyframes;
                const maxT = Math.max(...kfs.map((k) => Number(k.t) || 0), 0);
                if (maxT > 0 && Math.abs(maxT - requestedDurationMs) > 1) {
                    const s = requestedDurationMs / maxT;
                    program.camera.keyframes = kfs.map((k) => ({ ...k, t: Math.round((Number(k.t) || 0) * s) }));
                }
            }
            if (requestedDurationMs && Array.isArray(program?.segments)) {
                for (const seg of program.segments) {
                    const skfs = seg?.camera?.keyframes;
                    if (skfs && skfs.length) {
                        const maxT = Math.max(...skfs.map((k) => Number(k.t) || 0), 0);
                        if (maxT > 0 && Math.abs(maxT - requestedDurationMs) > 1) {
                            const s = requestedDurationMs / maxT;
                            seg.camera.keyframes = skfs.map((k) => ({ ...k, t: Math.round((Number(k.t) || 0) * s) }));
                        }
                    }
                }
            }
        }
        catch { }
        console.log("program is", program.camera.keyframes);
        res.json({ program });
    }
    catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});
// Augmentation pipeline: geocode, boundary, 3D flags; returns a new program copy
async function augmentProgram(prog, text) {
    const p = JSON.parse(JSON.stringify(prog));
    // 3D fly-through triggers
    const t = (text || '').toLowerCase();
    const want3d = !!(p.flags?.google3dApiKey || p.extras?.flyThrough || t.includes('fly through') || t.includes('3d tile'));
    if (want3d) {
        p.flags = { ...(p.flags || {}), terrain: true, sky: true };
        if (!p.flags.google3dApiKey && process.env.GOOGLE_TILE_API_KEY)
            p.flags.google3dApiKey = process.env.GOOGLE_TILE_API_KEY;
        if (p.camera?.keyframes?.length) {
            const last = p.camera.keyframes[p.camera.keyframes.length - 1];
            if (typeof last.pitch !== 'number' || last.pitch < 50)
                last.pitch = 55;
        }
    }
    // Address geocoding
    const looksLikeAddress = (s) => {
        const t = (s || '').toLowerCase();
        // Enhanced patterns for better address detection
        return /(\d+\s+[^,]+\s+(st|ave|blvd|rd|road|street|avenue|drive|dr|ln|lane|ct|court|parkway|pkwy|way|circle|cir|place|pl|plaza)\b)/i.test(t)
            || /(\d{1,5}\s+\w+.*?(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd))/i.test(t)
            || /(,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)/i.test(t)
            || /(\d+\s+[A-Za-z\s]+,\s*[A-Za-z\s]+)/i.test(t) // "123 Main Street, New York"
            || /([A-Za-z\s]+\d+[A-Za-z\s]*,\s*[A-Za-z\s]+)/i.test(t); // "Main Street 123, New York"
    };
    const extractAddressFromText = (s) => {
        if (!s)
            return null;
        // Try to extract the most complete address-looking string
        const patterns = [
            /(\d+\s+[^,\n]+\s+(st|ave|blvd|rd|road|street|avenue|drive|dr|ln|lane|ct|court|parkway|pkwy|way|circle|cir|place|pl|plaza)[^,\n]*(?:,\s*[^,\n]+)*)/i,
            /(\d{1,5}\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)[^,\n]*(?:,\s*[^,\n]+)*)/i,
            /(\d+\s+[A-Za-z\s]+,\s*[A-Za-z\s,]+)/i
        ];
        for (const pattern of patterns) {
            const match = s.match(pattern);
            if (match)
                return match[1].trim();
        }
        return null;
    };
    if (p.extras?.address || (text && looksLikeAddress(text))) {
        try {
            console.log("extracting address");
            // Prefer the LLM-extracted address, fallback to extracting from text
            let addr = p.extras?.address;
            if (!addr && text) {
                addr = extractAddressFromText(text) || text;
            }
            if (addr) {
                console.log(`[augment] geocoding address: "${addr}"`);
                const data = await geocode(addr);
                const lon = data.lon, lat = data.lat;
                // Validate coordinates are reasonable (not null/undefined/out of bounds)
                if (typeof lon !== 'number' || typeof lat !== 'number' ||
                    isNaN(lon) || isNaN(lat) ||
                    Math.abs(lon) > 180 || Math.abs(lat) > 90) {
                    console.error(`[augment] Invalid coordinates from geocoder: lat=${lat}, lon=${lon}`);
                    throw new Error('Invalid coordinates from geocoder');
                }
                console.log(`[augment] geocoded to: lat=${lat}, lon=${lon}`);
                console.log(`[augment] setting camera center to: [${lon}, ${lat}] (lon, lat order)`);
                console.log(`[augment] coordinate validation: lon range [-180,180]: ${lon}, lat range [-90,90]: ${lat}`);
                if (!p.camera)
                    p.camera = { keyframes: [] };
                if (!p.camera.keyframes?.length) {
                    // Create a nice zoom-in animation to the address
                    // Start from a regional view, then zoom to street level
                    p.camera.keyframes = [
                        { center: [lon, lat], zoom: 8, bearing: 0, pitch: 0, t: 0 },
                        { center: [lon, lat], zoom: 12, bearing: 0, pitch: 20, t: 2000 },
                        { center: [lon, lat], zoom: 17, bearing: 0, pitch: 50, t: 4000 }
                    ];
                }
                else {
                    // Update the final keyframe to center on the address
                    const last = p.camera.keyframes[p.camera.keyframes.length - 1];
                    last.center = [lon, lat];
                    if (typeof last.zoom !== 'number' || last.zoom < 15)
                        last.zoom = 17;
                    // Ensure we have some pitch for street-level viewing
                    if (typeof last.pitch !== 'number' || last.pitch < 30)
                        last.pitch = 50;
                }
                // Set the address in extras for future reference
                if (!p.extras)
                    p.extras = {};
                p.extras.address = addr;
                console.log(p.camera.keyframes[1]);
            }
        }
        catch (e) {
            console.warn('[augment] geocode failed', e);
        }
    }
    // Boundary (city/area) via Overpass
    if (p.extras?.boundaryName) {
        try {
            let gj;
            try {
                gj = await fetchNominatimBoundary(p.extras.boundaryName);
            }
            catch (e) {
                console.warn('[augment] nominatim boundary failed; using overpass', e?.message || e);
                gj = await fetchBoundaryGeoJSON(p.extras.boundaryName);
            }
            p.boundaryGeoJSON = gj;
            p.boundaryFill = p.boundaryFill || '#ffcc00';
            p.boundaryFillOpacity = (typeof p.boundaryFillOpacity === 'number') ? p.boundaryFillOpacity : 0.25;
            p.boundaryLineColor = p.boundaryLineColor || '#ffcc00';
            p.boundaryLineWidth = (typeof p.boundaryLineWidth === 'number') ? p.boundaryLineWidth : 2;
            // Keep default animation settings (boundary fitting disabled by default to preserve coordinates)
            p.animation = { ...(p.animation || {}), fitPaddingPx: (p.animation?.fitPaddingPx ?? 80) };
            // do not auto-add phases here; add based on explicit prompt below
        }
        catch (e) {
            console.warn('[augment] boundary fetch failed', e);
        }
    }
    // If segments exist, resolve their boundaries and stack default phases
    if (Array.isArray(p.segments) && p.segments.length) {
        const tLower = (text || '').toLowerCase();
        const wantHighlight = tLower.includes('highlight');
        const wantTrace = tLower.includes('trace');
        const boundaryList = [];
        for (const seg of p.segments) {
            try {
                const name = seg?.extras?.boundaryName;
                if (name) {
                    try {
                        seg.boundaryGeoJSON = await fetchNominatimBoundary(name);
                    }
                    catch (e) {
                        seg.boundaryGeoJSON = await fetchBoundaryGeoJSON(name);
                    }
                    if (seg.boundaryGeoJSON)
                        boundaryList.push(seg.boundaryGeoJSON);
                }
            }
            catch (e) {
                console.warn('[augment] segment boundary fetch failed', e);
            }
            // phases stacking default
            let phases = Array.isArray(seg.phases) ? [...seg.phases] : ['zoom'];
            if (wantHighlight && !phases.includes('highlight'))
                phases.push('highlight');
            if (wantTrace && !phases.includes('trace'))
                phases.push('trace');
            if (!phases.includes('hold'))
                phases.push('hold');
            seg.phases = phases;
        }
        if (boundaryList.length)
            p.boundaryGeoJSONs = boundaryList;
    }
    // Phase selection based on explicit prompt intent
    const phasesSet = new Set();
    const requested = Array.isArray(p.animation?.phases) ? p.animation.phases.map((s) => s.toLowerCase()) : [];
    // Always include zoom if we have keyframes
    if (p.camera?.keyframes?.length)
        phasesSet.add('zoom');
    const wantHighlight = requested.includes('highlight') || t.includes('highlight');
    const wantTrace = requested.includes('trace') || t.includes('trace') || t.includes('outline');
    if (wantHighlight)
        phasesSet.add('highlight');
    if (wantTrace)
        phasesSet.add('trace');
    if (requested.includes('wait'))
        phasesSet.add('wait');
    if (requested.includes('hold'))
        phasesSet.add('hold');
    // If user asked to highlight but not trace, keep only highlight
    // If user asked to trace but not highlight, keep only trace
    // If neither specified, default to just zoom (plus hold if provided)
    const ordered = ['zoom', 'highlight', 'trace', 'wait', 'hold'].filter(x => phasesSet.has(x));
    p.animation = { ...(p.animation || {}), phases: ordered.length ? ordered : ['zoom'] };
    // Multi-zoom detection: "zoom into X ... then zoom into Y"
    try {
        const targets = [];
        const re = /zoom\s+(?:into|to)\s+([^,.;]+?)(?=(?:,|\.|;|\band\s+then\b|\bthen\b|$))/gi;
        let m;
        const inText = (text || '');
        while ((m = re.exec(inText)) !== null) {
            const name = (m[1] || '').trim();
            if (name)
                targets.push(name);
        }
        if (targets.length >= 2) {
            // Geocode first two targets and build segments with hold between
            const pts = await Promise.all([geocode(targets[0]), geocode(targets[1])]);
            const dur = 4000;
            const hold = 1000;
            const startZoom = 6;
            const endZoom = 8.5;
            const segs = [];
            // Segment 1
            segs.push({
                camera: { keyframes: [
                        { center: [pts[0].lon, pts[0].lat], zoom: startZoom, bearing: 0, pitch: 0, t: 0 },
                        { center: [pts[0].lon, pts[0].lat], zoom: endZoom, bearing: 0, pitch: 0, t: dur }
                    ] },
                extras: { boundaryName: targets[0] },
                phases: ['zoom']
            });
            // Segment 2
            segs.push({
                camera: { keyframes: [
                        { center: [pts[0].lon, pts[0].lat], zoom: endZoom, bearing: 0, pitch: 0, t: 0 },
                        { center: [pts[1].lon, pts[1].lat], zoom: endZoom, bearing: 0, pitch: 0, t: dur }
                    ] },
                extras: { boundaryName: targets[1] },
                phases: ['zoom']
            });
            // If user asked to highlight/trace, include them in segment phases
            const tLower = (text || '').toLowerCase();
            const wantHighlight = tLower.includes('highlight');
            const wantTrace = tLower.includes('trace');
            segs.forEach((s) => {
                // Insert highlight/trace after zoom
                if (wantHighlight && !s.phases.includes('highlight'))
                    s.phases.push('highlight');
                if (wantTrace && !s.phases.includes('trace'))
                    s.phases.push('trace');
                // Always hold at end of each segment by default
                if (!s.phases.includes('hold'))
                    s.phases.push('hold');
            });
            // Fetch boundaries for segments
            for (const s of segs) {
                try {
                    const gj = await fetchNominatimBoundary(s.extras.boundaryName);
                    s.boundaryGeoJSON = gj;
                }
                catch (e) {
                    try {
                        s.boundaryGeoJSON = await fetchBoundaryGeoJSON(s.extras.boundaryName);
                    }
                    catch { }
                }
            }
            p.segments = segs;
            // Also set top-level camera as a concatenation for systems that ignore segments
            p.camera = { keyframes: [
                    { center: [pts[0].lon, pts[0].lat], zoom: startZoom, bearing: 0, pitch: 0, t: 0 },
                    { center: [pts[0].lon, pts[0].lat], zoom: endZoom, bearing: 0, pitch: 0, t: dur },
                    { center: [pts[1].lon, pts[1].lat], zoom: endZoom, bearing: 0, pitch: 0, t: dur + hold + dur }
                ] };
            if (!p.animation?.phases || p.animation.phases.length <= 1) {
                p.animation = { ...(p.animation || {}), phases: ['zoom', 'hold', 'zoom'] };
            }
        }
    }
    catch (e) {
        console.warn('[augment] multi-zoom detection failed', e?.message || e);
    }
    console.log("new is", p.camera.keyframes[1]);
    return p;
}
app.post("/api/templates", async (req, res) => {
    try {
        const body = req.body;
        if (!body?.name || !body?.program) {
            return res.status(400).json({ error: "Need {name, program}" });
        }
        const url = await putJsonTemplate(body.name, body.program);
        res.json({ url });
    }
    catch (e) {
        res.status(500).json({ error: e.message || "template_failed" });
    }
});
/**
 * POST /api/animate
 * body: { text: string }
 * returns: { url: string, program: MapProgram }
 */
app.post("/api/animate", async (req, res) => {
    try {
        // Accept either a natural-language `text` or a structured `program`
        const text = req.body?.text;
        const incomingProgram = req.body?.program;
        // 1) Natural language -> structured program (or validate provided program)
        let program;
        if (incomingProgram) {
            console.log("got incoming program");
            function pruneNulls(obj) {
                if (obj === null || typeof obj === 'undefined')
                    return undefined;
                if (Array.isArray(obj))
                    return obj.map(pruneNulls).filter(v => v !== undefined);
                if (typeof obj === 'object') {
                    const out = {};
                    for (const [k, v] of Object.entries(obj)) {
                        const pv = pruneNulls(v);
                        if (pv !== undefined)
                            out[k] = pv;
                    }
                    return out;
                }
                return obj;
            }
            const sanitized = pruneNulls(incomingProgram);
            // If border provided but missing isoA3, drop border to allow region-based flows
            if (sanitized?.border && !sanitized.border.isoA3) {
                delete sanitized.border;
            }
            const parsed = MapProgramSchema.safeParse?.(sanitized);
            if (!parsed?.success) {
                console.log("parse fail:", parsed?.error?.message, parsed?.error);
                return res.status(400).json({ error: "Invalid 'program' payload", details: parsed?.error?.message ?? parsed?.error });
            }
            program = parsed.data;
        }
        else {
            if (!text)
                return res.status(400).json({ error: "Missing 'text'. Or provide a structured 'program'." });
            program = await nlToProgram(text);
        }
        // Augment program based on extras/text (geocode, boundary, 3D)
        program = await augmentProgram(program, text);
        // If an env-provided style URL is set (e.g., high-res satellite), use it when not specified by program
        // Resolve style: prefer provided URL; otherwise derive from remote style source env
        const isUrl = (s) => /^(https?:|data:)/i.test(s);
        function resolveRemoteStyle() {
            // New env: MAP_STYLE_REMOTE can be a direct style.json URL, or a GitHub repo URL.
            const remote = process.env.MAP_STYLE_REMOTE || "https://github.com/openmaptiles/dark-matter-gl-style";
            if (!remote)
                return undefined;
            if (/\.json(\?|#|$)/i.test(remote))
                return remote;
            const m = remote.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/|$)/i);
            if (m) {
                const org = m[1];
                const repo = m[2];
                const branch = process.env.MAP_STYLE_REMOTE_BRANCH || "master";
                const pathInRepo = process.env.MAP_STYLE_REMOTE_PATH || "style.json";
                return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${pathInRepo}`;
            }
            // Fallback: treat as URL as-is
            return remote;
        }
        if (program.style) {
            // If user provided a non-URL, leave it as-is (MapLibre may still resolve relative paths)
            // but generally recommend full URLs for remote styles.
            if (!isUrl(program.style)) {
                console.log("Using provided style string (non-URL):", program.style);
            }
        }
        else {
            const derived = resolveRemoteStyle();
            if (derived) {
                program.style = derived;
            }
        }
        // If a MapTiler key is provided, prefetch the style JSON and substitute {key},
        // then serve via data URL to avoid CORS and cross-origin issues in headless.
        async function withMaptilerKey(styleUrl) {
            if (!styleUrl)
                return styleUrl;
            const key = process.env.MAPTILER_KEY;
            if (!key)
                return styleUrl;
            try {
                const r = await fetch(styleUrl);
                if (!r.ok) {
                    console.warn("[style] failed to fetch style for key substitution", styleUrl, r.status);
                    return styleUrl;
                }
                let txt = await r.text();
                // Replace common placeholders
                txt = txt.replace(/\{key\}/g, key).replace(/%7Bkey%7D/gi, encodeURIComponent(key)).replace(/\$\{key\}/g, key);
                const dataUrl = "data:application/json;charset=utf-8;base64," + Buffer.from(txt, "utf8").toString("base64");
                return dataUrl;
            }
            catch (e) {
                console.warn("[style] error during key substitution", e);
                return styleUrl;
            }
        }
        // Performance toggles: default to faster renders unless explicitly set to high
        function applyPerformanceToggles(p) {
            const quality = (process.env.RENDER_QUALITY || 'fast').toLowerCase();
            const envWait = process.env.RENDER_WAIT_FOR_TILES;
            const envPxr = process.env.RENDER_PIXEL_RATIO;
            const envMaxFps = process.env.RENDER_MAX_FPS;
            if (!p.output)
                p.output = {};
            // waitForTiles: env overrides; default fast sets to false if undefined
            if (typeof envWait !== 'undefined') {
                p.output.waitForTiles = /^(1|true|yes)$/i.test(String(envWait));
            }
            else if (typeof p.output.waitForTiles === 'undefined') {
                p.output.waitForTiles = quality === 'high' ? true : false;
            }
            // pixelRatio: env override; otherwise cap for fast mode
            if (typeof envPxr !== 'undefined') {
                const v = Math.max(1, Math.min(4, Number(envPxr) || 1));
                p.output.pixelRatio = v;
            }
            else if (quality !== 'high') {
                // Lower pixel ratio for speed if not explicitly set
                const cur = Number(p.output.pixelRatio);
                if (!cur || cur > 2)
                    p.output.pixelRatio = 1;
            }
            // fps: env max cap; otherwise cap to 30 for fast
            const cap = envMaxFps ? Number(envMaxFps) : (quality === 'high' ? undefined : 30);
            if (cap && Number.isFinite(cap)) {
                if (typeof p.output.fps === 'number')
                    p.output.fps = Math.min(p.output.fps, cap);
                else
                    p.output.fps = Math.min(30, cap);
            }
            return p;
        }
        program = applyPerformanceToggles(program);
        // Optional hard caps for output dimensions to avoid heavy readbacks
        function applyOutputCaps(p) {
            const mw = Number(process.env.RENDER_MAX_WIDTH || 0);
            const mh = Number(process.env.RENDER_MAX_HEIGHT || 0);
            if (p?.output) {
                if (mw && Number.isFinite(mw))
                    p.output.width = Math.min(p.output.width, mw);
                if (mh && Number.isFinite(mh))
                    p.output.height = Math.min(p.output.height, mh);
            }
            return p;
        }
        program = applyOutputCaps(program);
        program.style = await withMaptilerKey(program.style);
        // Capture dimensions and encoder preference
        const cssW = program.output.width;
        const cssH = program.output.height;
        const fps = program.output.fps || 30;
        const pxr = Math.max(1, Math.min(4, Number(program.output.pixelRatio) || 1));
        const capW = (cssW * pxr) | 0;
        const capH = (cssH * pxr) | 0;
        const wantMp4 = String(req.body?.format || "").toLowerCase() === "mp4" ||
            String(req.body?.encoder || "").toLowerCase() === "h264_nvenc" ||
            /^(1|true|yes)$/i.test(String(req.body?.useNvenc || "")) ||
            /^(1|true|yes)$/i.test(String(process.env.RENDER_FORCE_MP4 || ""));
        // 2) Launch headless Chrome (try multiple WebGL-friendly flag sets)
        const { browser, name, info } = await launchBrowserWithWebGL();
        console.log("WebGL initialized via", name, info);
        const page = await browser.newPage();
        page.on("console", (msg) => console.log("[renderer]", msg.text()));
        page.on("pageerror", (err) => console.error("[renderer:pageerror]", err));
        page.on("requestfailed", (req) => console.error("[renderer:requestfailed]", req.url(), req.failure()));
        page.on("response", async (res) => {
            try {
                const status = res.status();
                if (status >= 400) {
                    const url = res.url();
                    const headers = res.headers();
                    const ct = headers["content-type"] || headers["Content-Type"] || "";
                    let preview = "";
                    if (/json|text|javascript|css|xml/i.test(ct)) {
                        try {
                            preview = (await res.text()).slice(0, 500);
                        }
                        catch { }
                    }
                    console.error(`[renderer:response] ${status} ${url} ct=${ct} preview=${JSON.stringify(preview)}`);
                }
            }
            catch (e) {
                console.error("[renderer:response] error inspecting response", e);
            }
        });
        // 3) Serve the renderer page from memory
        const htmlPath = path.join(__dirname, "renderer-page.html");
        const fs = await import("node:fs/promises");
        const html = await fs.readFile(htmlPath, "utf8");
        // deviceScaleFactor doesn't affect the canvas capture; pixelRatio is handled in the renderer.
        await page.setViewport({ width: program.output.width, height: program.output.height, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: "load" });
        // Prefer local script files if provided, else allow configurable CDN URLs.
        async function injectScript(name, pathEnv, urlEnv, fallbackUrl) {
            const localPath = process.env[pathEnv];
            const cdnUrl = process.env[urlEnv];
            try {
                if (localPath) {
                    await page.addScriptTag({ path: localPath });
                    console.log(`[renderer] injected ${name} from path`, localPath);
                    return;
                }
            }
            catch (e) {
                console.warn(`[renderer] failed to inject ${name} from path`, localPath, e);
            }
            const url = cdnUrl || fallbackUrl;
            try {
                await page.addScriptTag({ url });
                console.log(`[renderer] injected ${name} from url`, url);
            }
            catch (e) {
                console.warn(`[renderer] url injection blocked for ${name}; fetching via Node and injecting content`, url, e);
                const resp = await fetch(url);
                if (!resp.ok)
                    throw new Error(`Failed to fetch ${name} from ${url}: HTTP ${resp.status}`);
                const code = await resp.text();
                // Add sourceURL for better stack traces
                await page.addScriptTag({ content: `${code}\n//# sourceURL=${url}` });
                console.log(`[renderer] injected ${name} via content from`, url);
            }
        }
        // Inject shared animation and map-core used by both preview and renderer
        try {
            const sharedAnim = path.join(__dirname, "..", "web", "src", "shared", "animation-core.js");
            const sharedMap = path.join(__dirname, "..", "web", "src", "shared", "map-core.js");
            await page.addScriptTag({ path: sharedAnim });
            await page.addScriptTag({ path: sharedMap });
            console.log('[renderer] injected shared animation-core and map-core');
        }
        catch (e) {
            console.warn('[renderer] failed to inject shared animation core', e);
        }
        await injectScript("maplibre-gl", "MAPLIBRE_JS_PATH", "MAPLIBRE_JS_URL", "https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js");
        await injectScript("hubble.gl", "HUBBLE_JS_PATH", "HUBBLE_JS_URL", "https://cdn.jsdelivr.net/npm/hubble.gl@1.4.0/dist.min.js");
        // Optional deck.gl and loaders for 3D tiles integration (inject only if requested to reduce overhead)
        if (program?.flags?.google3dApiKey) {
            await injectScript("deck.gl", "DECK_GL_PATH", "DECK_GL_URL", "https://unpkg.com/deck.gl@9.0.0/dist.min.js");
            await injectScript("loaders.gl core", "LOADERS_CORE_PATH", "LOADERS_CORE_URL", "https://unpkg.com/@loaders.gl/core@4.0.0/dist/dist.min.js");
            await injectScript("loaders.gl tiles", "LOADERS_TILES_PATH", "LOADERS_TILES_URL", "https://unpkg.com/@loaders.gl/tiles@4.0.0/dist/dist.min.js");
            await injectScript("loaders.gl 3d-tiles", "LOADERS_3DTILES_PATH", "LOADERS_3DTILES_URL", "https://unpkg.com/@loaders.gl/3d-tiles@4.0.0/dist/dist.min.js");
        }
        // 4) Bridge for the page to hand us encoded bytes (WebM) or raw RGBA frames for ffmpeg (MP4)
        const buffers = [];
        let totalBytes = 0;
        let deliverCalls = 0;
        const mp4Chunks = [];
        let ffmpeg;
        function toBuffer(u8) {
            if (!u8)
                throw new Error("empty_payload");
            if (typeof ArrayBuffer !== "undefined" && u8 instanceof ArrayBuffer)
                return Buffer.from(new Uint8Array(u8));
            if (u8?.buffer instanceof ArrayBuffer && typeof u8.byteLength === "number")
                return Buffer.from(new Uint8Array(u8.buffer, u8.byteOffset ?? 0, u8.byteLength));
            if (Array.isArray(u8?.data))
                return Buffer.from(u8.data);
            if (Array.isArray(u8))
                return Buffer.from(u8);
            if (typeof u8 === "object" && typeof u8.length === "number")
                return Buffer.from(Array.from(u8));
            throw new Error("unsupported_payload_type:" + (typeof u8));
        }
        // Provide borders GeoJSON via Node (local file or world-atlas TopoJSON -> GeoJSON)
        await page.exposeFunction("__nodeGetBordersGeoJSON", async () => {
            const localPath = process.env.BORDERS_GEOJSON_PATH;
            // Default to Natural Earth 10m Admin 0 countries (has ISO_A3 properties)
            const remoteUrl = process.env.BORDERS_GEOJSON_URL
                || "https://unpkg.com/world-atlas@2.0.2/countries-10m.json";
            try {
                if (localPath) {
                    const txt = await fs.readFile(localPath, "utf8");
                    return JSON.parse(txt);
                }
            }
            catch (e) {
                console.warn("[renderer] failed reading local borders file", localPath, e);
            }
            console.log("[renderer:borders] fetching", localPath ? `local:${localPath}` : remoteUrl);
            const res = await fetch(remoteUrl);
            if (!res.ok)
                throw new Error(`Failed to fetch borders: ${res.status}`);
            const data = await res.json();
            if (data && typeof data === 'object' && data.type === 'Topology') {
                try {
                    const geo = topojson.feature(data, data.objects.countries);
                    return geo;
                }
                catch (e) {
                    console.warn('[renderer:borders] Topology detected but conversion failed; returning raw', e);
                    return data;
                }
            }
            return data; // assume GeoJSON FeatureCollection
        });
        if (wantMp4) {
            ffmpeg = spawnFfmpegNvenc({ width: capW, height: capH, fps, format: "mp4", encoder: process.env.RENDER_ENCODER || "h264_nvenc" });
            ffmpeg.proc.stdout.on("data", (d) => mp4Chunks.push(Buffer.from(d)));
            ffmpeg.proc.stderr.on("data", (d) => process.env.DEBUG_FFMPEG && console.error("[ffmpeg]", d.toString()));
            // Frame delivery (RGBA)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.exposeFunction("__nodeDeliverFrameRGBA", async (payload) => {
                const buf = toBuffer(payload);
                if (!ffmpeg)
                    throw new Error("ffmpeg not initialized");
                if (!ffmpeg.proc.stdin.write(buf)) {
                    await new Promise((resolve) => ffmpeg.proc.stdin.once("drain", () => resolve()));
                }
                return true;
            });
            await page.exposeFunction("__nodeDeliverEnd", async () => {
                try {
                    ffmpeg?.proc.stdin.end();
                }
                catch { }
                return true;
            });
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.exposeFunction("__nodeDeliverWebM", async (payload) => {
                const buf = toBuffer(payload);
                buffers.push(buf);
                totalBytes += buf.length;
                deliverCalls += 1;
                console.log(`[server] received webm payload: call=${deliverCalls}, bytes=${buf.length}, total=${totalBytes}`);
            });
        }
        // Log the resolved style for debugging
        try {
            console.log("Using style URL:", program.style);
        }
        catch { }
        // 5) Kick off the render
        function redactStyleForLog(p) {
            try {
                const copy = JSON.parse(JSON.stringify(p));
                if (typeof copy.style === 'string' && copy.style.startsWith('data:')) {
                    copy.style = `(data-url length ${p.style.length})`;
                }
                return copy;
            }
            catch {
                return p;
            }
        }
        console.log('[server] renderer input program:', JSON.stringify(redactStyleForLog(program)));
        await page.evaluate(async (program) => {
            // @ts-ignore
            return window.startRender(program);
        }, program);
        // 6) Upload to S3
        let url;
        if (wantMp4) {
            await new Promise((resolve, reject) => {
                ffmpeg?.proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg_exit_" + code))));
                try {
                    ffmpeg?.proc.stdin.end();
                }
                catch { }
            });
            const videoBuf = Buffer.concat(mp4Chunks);
            if (!videoBuf?.length)
                throw new Error("no_video_bytes");
            console.log(`[server] uploading MP4 to S3 size=${videoBuf.length}`);
            url = await putVideoMp4(videoBuf);
        }
        else {
            const videoBuf = Buffer.concat(buffers);
            console.log(`[server] page.evaluate done. buffers=${buffers.length}, totalBytes=${totalBytes}`);
            if (!videoBuf?.length) {
                console.error('[server] no video bytes received; aborting upload');
                throw new Error('no_video_bytes');
            }
            console.log(`[server] uploading WebM to S3 size=${videoBuf.length}`);
            url = await putVideoWebm(videoBuf);
        }
        console.log(`[server] upload complete url=${url}`);
        await page.close();
        await browser.close();
        return res.json({ url, program });
    }
    catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message || "render_failed" });
    }
});
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log("listening on :" + port);
});
