import { launchBrowserWithWebGL } from "../src/webgl-launch.js";

async function main() {
  try {
    const { browser, name, info } = await launchBrowserWithWebGL();
    console.log(JSON.stringify({ ok: true, name, info }, null, 2));
    await browser.close();
    process.exit(0);
  } catch (e: any) {
    console.error(JSON.stringify({ ok: false, error: e?.message || String(e), details: e?.details }, null, 2));
    process.exit(1);
  }
}

main();

