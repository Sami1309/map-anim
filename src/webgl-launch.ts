import puppeteer, { Browser } from "puppeteer";

type Candidate = {
  name: string;
  // Use 'any' to avoid tight coupling to Puppeteer types across versions
  opts: any;
};

async function pageHasWebgl(page: import("puppeteer").Page) {
  return await page.evaluate(() => {
    try {
      const canvas = document.createElement("canvas");
      // Try WebGL2 first, then WebGL1. Preserve buffer for capture.
      const attrs = { preserveDrawingBuffer: true } as WebGLContextAttributes;
      const gl = (canvas.getContext("webgl2", attrs) || canvas.getContext("webgl", attrs)) as WebGLRenderingContext | WebGL2RenderingContext | null;
      if (!gl) return { ok: false, error: "no_context" };
      const info: any = {};
      try {
        info.VERSION = gl.getParameter(gl.VERSION);
        info.VENDOR = gl.getParameter(gl.VENDOR);
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          info.UNMASKED_VENDOR_WEBGL = gl.getParameter((ext as any).UNMASKED_VENDOR_WEBGL);
          info.UNMASKED_RENDERER_WEBGL = gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL);
        }
        info.supportedExtensions = gl.getSupportedExtensions();
      } catch (e: any) {
        info.extError = e?.message || String(e);
      }
      return { ok: true, info };
    } catch (e: any) {
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
    "--mute-audio",
    "--ignore-gpu-blocklist"
  ];

  const executablePath = process.env.CHROME_PATH || undefined;

  const candidates: Candidate[] = [
    {
      name: "gpu-egl-angle",
      opts: { headless: "new", executablePath, args: [...baseArgs, "--enable-gpu", "--disable-software-rasterizer", "--use-gl=egl", "--use-angle=gl"] }
    },
    {
      name: "egl",
      opts: { headless: "new", executablePath, args: [...baseArgs, "--use-gl=egl"] }
    },
    {
      name: "angle-gl",
      opts: { headless: "new", executablePath, args: [...baseArgs, "--use-gl=angle", "--use-angle=gl"] }
    },
    {
      name: "swiftshader-angle",
      opts: { headless: "new", executablePath, args: [...baseArgs, "--use-gl=swiftshader", "--use-angle=swiftshader"] }
    },
    {
      name: "swiftshader-angle-no-vulkan",
      opts: { headless: "new", executablePath, args: [...baseArgs, "--use-gl=swiftshader", "--use-angle=swiftshader", "--disable-vulkan"] }
    },
    {
      name: "default-headless",
      opts: { headless: "new", executablePath, args: [...baseArgs] }
    }
  ];

  const errors: { name: string; error: string; info?: any }[] = [];

  for (const cand of candidates) {
    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch(cand.opts);
      const page = await browser.newPage();
      await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
      await page.goto("about:blank");
      const result = await pageHasWebgl(page);
      if (result.ok) {
        return { browser, name: cand.name, info: result.info } as const;
      } else {
        errors.push({ name: cand.name, error: result.error });
      }
      await page.close();
      await browser.close();
    } catch (e: any) {
      errors.push({ name: cand.name, error: e?.message || String(e) });
      try { await browser?.close(); } catch {}
    }
  }

  const err = new Error("Failed to initialize WebGL with any candidate flags: " + JSON.stringify(errors));
  (err as any).details = errors;
  throw err;
}
