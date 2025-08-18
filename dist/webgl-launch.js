import puppeteer from "puppeteer";
async function pageHasWebgl(page) {
    return await page.evaluate(() => {
        try {
            const canvas = document.createElement("canvas");
            // Try WebGL2 first, then WebGL1. Preserve buffer for capture.
            const attrs = { preserveDrawingBuffer: true };
            const gl = (canvas.getContext("webgl2", attrs) || canvas.getContext("webgl", attrs));
            if (!gl)
                return { ok: false, error: "no_context" };
            const info = {};
            try {
                info.VERSION = gl.getParameter(gl.VERSION);
                info.VENDOR = gl.getParameter(gl.VENDOR);
                const ext = gl.getExtension("WEBGL_debug_renderer_info");
                if (ext) {
                    info.UNMASKED_VENDOR_WEBGL = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
                    info.UNMASKED_RENDERER_WEBGL = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
                }
                info.supportedExtensions = gl.getSupportedExtensions();
            }
            catch (e) {
                info.extError = e?.message || String(e);
            }
            return { ok: true, info };
        }
        catch (e) {
            return { ok: false, error: e?.message || String(e) };
        }
    });
}
export async function launchBrowserWithWebGL() {
    const baseArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--hide-scrollbars",
        "--mute-audio"
    ];
    const candidates = [
        {
            name: "swiftshader-angle",
            opts: { headless: "new", args: [...baseArgs, "--use-gl=swiftshader", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] }
        },
        {
            name: "swiftshader-angle-no-vulkan",
            opts: { headless: "new", args: [...baseArgs, "--use-gl=swiftshader", "--use-angle=swiftshader", "--disable-vulkan", "--enable-webgl", "--ignore-gpu-blocklist"] }
        },
        {
            name: "angle-gl",
            opts: { headless: "new", args: [...baseArgs, "--use-gl=angle", "--use-angle=gl", "--enable-webgl", "--ignore-gpu-blocklist"] }
        },
        {
            name: "egl",
            opts: { headless: "new", args: [...baseArgs, "--use-gl=egl", "--enable-webgl", "--ignore-gpu-blocklist"] }
        },
        {
            name: "default-headless",
            opts: { headless: "new", args: [...baseArgs, "--enable-webgl", "--ignore-gpu-blocklist"] }
        }
    ];
    const errors = [];
    for (const cand of candidates) {
        let browser;
        try {
            browser = await puppeteer.launch(cand.opts);
            const page = await browser.newPage();
            await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
            await page.goto("about:blank");
            const result = await pageHasWebgl(page);
            if (result.ok) {
                return { browser, name: cand.name, info: result.info };
            }
            else {
                errors.push({ name: cand.name, error: result.error });
            }
            await page.close();
            await browser.close();
        }
        catch (e) {
            errors.push({ name: cand.name, error: e?.message || String(e) });
            try {
                await browser?.close();
            }
            catch { }
        }
    }
    const err = new Error("Failed to initialize WebGL with any candidate flags: " + JSON.stringify(errors));
    err.details = errors;
    throw err;
}
