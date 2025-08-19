import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowserWithWebGL } from "./webgl-launch.js";
import { nlToProgram } from "./llm.js";
import { MapProgram as MapProgramSchema } from "./program-schema.js";
import fetch from "node-fetch";
import * as topojson from "topojson-client";
import { putVideoWebm } from "./storage.js";
import { applyAnimationStyle } from "./animation-styles.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
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
            const parsed = MapProgramSchema.safeParse?.(incomingProgram);
            if (!parsed?.success) {
                return res.status(400).json({ error: "Invalid 'program' payload", details: parsed?.error?.message ?? parsed?.error });
            }
            program = parsed.data;
        }
        else {
            if (!text)
                return res.status(400).json({ error: "Missing 'text'. Or provide a structured 'program'." });
            program = await nlToProgram(text);
        }
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
        // Apply animation style defaults before rendering
        program = applyAnimationStyle(program);
        // Heuristic: if user text hints to "trace the border", enable it
        if (typeof text === 'string') {
            const lowered = text.toLowerCase();
            if (lowered.includes('trace') && lowered.includes('border')) {
                try {
                    program.border = { traceAfterZoom: true, ...program.border };
                }
                catch { }
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
        program.style = await withMaptilerKey(program.style);
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
        await injectScript("maplibre-gl", "MAPLIBRE_JS_PATH", "MAPLIBRE_JS_URL", "https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js");
        await injectScript("hubble.gl", "HUBBLE_JS_PATH", "HUBBLE_JS_URL", "https://cdn.jsdelivr.net/npm/hubble.gl@1.4.0/dist.min.js");
        // 4) Bridge for the page to hand us the encoded bytes
        const buffers = [];
        let totalBytes = 0;
        let deliverCalls = 0;
        // Normalize assorted payload shapes from the page into a Node Buffer
        function toBuffer(u8) {
            try {
                if (!u8)
                    throw new Error("empty_payload");
                // ArrayBuffer
                if (typeof ArrayBuffer !== "undefined" && u8 instanceof ArrayBuffer) {
                    return Buffer.from(new Uint8Array(u8));
                }
                // TypedArray view
                if (u8?.buffer instanceof ArrayBuffer && typeof u8.byteLength === "number") {
                    return Buffer.from(new Uint8Array(u8.buffer, u8.byteOffset ?? 0, u8.byteLength));
                }
                // Node Buffer-like {type:'Buffer', data:[..]} or {data:[..]}
                if (Array.isArray(u8?.data)) {
                    return Buffer.from(u8.data);
                }
                // Plain array of numbers
                if (Array.isArray(u8)) {
                    return Buffer.from(u8);
                }
                // Array-like object with length and numeric indices
                if (typeof u8 === "object" && typeof u8.length === "number") {
                    return Buffer.from(Array.from(u8));
                }
                throw new Error("unsupported_payload_type:" + (typeof u8));
            }
            catch (err) {
                console.error("[nodeDeliverWebM] payload error", err);
                throw err;
            }
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.exposeFunction("__nodeDeliverWebM", async (payload) => {
            const buf = toBuffer(payload);
            buffers.push(buf);
            totalBytes += buf.length;
            deliverCalls += 1;
            console.log(`[server] received webm payload: call=${deliverCalls}, bytes=${buf.length}, total=${totalBytes}`);
        });
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
        // 6) Upload to S3 (or Render disk)
        const videoBuf = Buffer.concat(buffers);
        console.log(`[server] page.evaluate done. buffers=${buffers.length}, totalBytes=${totalBytes}`);
        if (!videoBuf?.length) {
            console.error('[server] no video bytes received; aborting upload');
            throw new Error('no_video_bytes');
        }
        console.log(`[server] uploading to S3 size=${videoBuf.length}`);
        const url = await putVideoWebm(videoBuf);
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
