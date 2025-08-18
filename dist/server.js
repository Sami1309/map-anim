import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowserWithWebGL } from "./webgl-launch.js";
import { nlToProgram } from "./llm.js";
import { MapProgram as MapProgramSchema } from "./program-schema.js";
import { putVideoWebm } from "./storage.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
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
        const envStyle = process.env.MAP_STYLE_URL;
        if (envStyle && !program.style) {
            // @ts-expect-error allow mutation before validation by page
            program.style = envStyle;
        }
        // 2) Launch headless Chrome (try multiple WebGL-friendly flag sets)
        const { browser, name, info } = await launchBrowserWithWebGL();
        console.log("WebGL initialized via", name, info);
        const page = await browser.newPage();
        page.on("console", (msg) => console.log("[renderer]", msg.text()));
        page.on("pageerror", (err) => console.error("[renderer:error]", err));
        page.on("requestfailed", (req) => console.error("[renderer:requestfailed]", req.url(), req.failure()));
        // 3) Serve the renderer page from memory
        const htmlPath = path.join(__dirname, "renderer-page.html");
        const html = await import("node:fs/promises").then(fs => fs.readFile(htmlPath, "utf8"));
        // deviceScaleFactor doesn't affect the canvas capture; pixelRatio is handled in the renderer.
        await page.setViewport({ width: program.output.width, height: program.output.height, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: "load" });
        // 4) Bridge for the page to hand us the encoded bytes
        const buffers = [];
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.exposeFunction("__nodeDeliverWebM", async (payload) => {
            const buf = toBuffer(payload);
            buffers.push(buf);
        });
        // 5) Kick off the render
        await page.evaluate(async (program) => {
            // @ts-ignore
            return window.startRender(program);
        }, program);
        // 6) Upload to S3 (or Render disk)
        const videoBuf = Buffer.concat(buffers);
        const url = await putVideoWebm(videoBuf);
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
