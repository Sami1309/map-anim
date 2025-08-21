import { launchBrowserWithWebGL } from "./webgl-launch.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export class BrowserPool {
    size;
    browser;
    pages = [];
    inUse = new Set();
    started = false;
    constructor(size = 2) {
        this.size = size;
    }
    async start() {
        if (this.started)
            return;
        const { browser, name } = await launchBrowserWithWebGL();
        this.browser = browser;
        console.log(`[pool] browser ready (${name}); prewarming ${this.size} pages`);
        for (let i = 0; i < this.size; i++) {
            const page = await this.browser.newPage();
            await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
            const htmlPath = path.join(__dirname, "renderer-page.html");
            const fs = await import("node:fs/promises");
            const html = await fs.readFile(htmlPath, "utf8");
            await page.setContent(html, { waitUntil: "load" });
            try {
                await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js" });
                await page.evaluate(() => window.maplibregl?.prewarm?.());
                console.log("[pool] page prewarmed");
            }
            catch (e) {
                console.warn("[pool] prewarm failed", e);
            }
            this.pages.push(page);
        }
        this.started = true;
    }
    async lease() {
        if (!this.started)
            await this.start();
        while (true) {
            const idle = this.pages.find(p => !this.inUse.has(p));
            if (idle) {
                this.inUse.add(idle);
                return { page: idle, release: () => this.inUse.delete(idle) };
            }
            await new Promise(r => setTimeout(r, 10));
        }
    }
    async close() {
        try {
            await this.browser?.close();
        }
        catch { }
    }
}
