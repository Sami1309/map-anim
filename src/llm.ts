import OpenAI from "openai";
import { MapProgram, MapProgram as MapProgramSchema } from "./program-schema.js";

const SYSTEM = `You translate natural-language mapping animation requests
into a minimal JSON object called MapProgram. Focus on a single country
border highlight and a camera path. Only output JSON.

Rules:
- Use ISO3 (e.g., ESP for Spain) for 'border.isoA3'.
- Camera.keyframes: chronological, include t (ms), center [lon,lat], zoom, bearing, pitch.
- Output.format MUST be "webm".
- Prefer 1920x1080 @ 60fps for high quality unless the user asks otherwise.
- Also set output.pixelRatio to 2. Use output.waitForTiles=false by default for speed unless the user explicitly asks for maximum crispness.
- Default behavior: hide the border during the zoom, then trace it after the zoom completes; set border.showDuringZoom=false and border.traceAfterZoom=true, and finally reveal the static outline.
 - Default behavior: hide the border during the zoom, then trace it after the zoom completes, progressively revealing the border as it is drawn; set border.showDuringZoom=false, border.traceAfterZoom=true, border.traceDurationMs≈3000, border.traceHoldMs≈2000, and reveal the static outline at the end.
- If the user explicitly provides a style URL (e.g., a high-resolution satellite style), include it at 'style'. Otherwise omit it.

Animation styles:
- Choose a 'styleId' from: "cinematic_zoom", "documentary_focus", "tech_outline_trace", "fast_preview".
- cinematic_zoom: smooth ease-out zoom; labels restricted at the end; no tracing.
- documentary_focus: labels restricted throughout; moderate motion.
- tech_outline_trace: bold outline; trace border after zoom-in.
- fast_preview: faster render; no label restriction; lower quality.

Label control:
- You can set labels.restrictToCountry true and labels.applyAt ('final' or 'always').

Border tracing:
- You can set border.traceAfterZoom true and border.traceDurationMs (e.g., 1500).
 - If the user asks to “trace the border” or similar phrasing, set border.traceAfterZoom to true.

Border thickness:
- You can set border.styleId to one of: "thin", "medium", "thick", "bold", "ultra".
- Explicit border.strokeWidth (2..20) overrides border.styleId.

// Phase control and framing:
// - Provide an ordered list in 'animation.phases' among: ["zoom", "wait", "trace", "hold"]. Default to ["zoom","trace","hold"].
// - Use 'animation.waitBeforeTraceMs' to add a pause before tracing (default 0).
// - Set 'animation.fitFinalToBorder=true' so the final camera frames the country nicely; use 'animation.fitPaddingPx' (e.g., 80–120) for spacing.

// Defaults for “zoom in and trace the border of {country}”:
// - border.showDuringZoom=false; border.traceAfterZoom=true; border.traceDurationMs≈3000; border.traceHoldMs≈2000;
// - animation.phases=["zoom","trace","hold"]; animation.easing="easeOutCubic"; animation.fitFinalToBorder=true; animation.fitPaddingPx≈100.

`;

const FEW_SHOTS = [
  {
    user: "Zoom from Europe to Spain, 4 seconds, 30 fps, highlight Spain border bold.",
    json: {
      camera: {
        keyframes: [
          { center: [10, 50], zoom: 2.5, bearing: 0, pitch: 0, t: 0 },
          { center: [-3.7, 40.4], zoom: 5.5, bearing: 0, pitch: 40, t: 4000 }
        ]
      },
      border: { isoA3: "ESP", strokeWidth: 6, opacity: 1, showDuringZoom: false, traceAfterZoom: true, traceDurationMs: 3000, traceHoldMs: 2000, showStaticAfterTrace: true },
      labels: { restrictToCountry: true, applyAt: "final" },
      animation: { easing: "easeOutCubic" },
      output: { width: 1920, height: 1080, fps: 60, pixelRatio: 2, waitForTiles: false, format: "webm" },
      styleId: "cinematic_zoom"
    }
  }
];

export async function nlToProgram(natural: string): Promise<MapProgram> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined
  });

  const messages: any[] = [
    { role: "system", content: SYSTEM },
    ...FEW_SHOTS.flatMap(s => [
      { role: "user", content: s.user },
      { role: "assistant", content: JSON.stringify(s.json) }
    ]),
    { role: "user", content: natural }
  ];

  try {
    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" }
    });

    const text = resp.choices[0]?.message?.content ?? "{}";
    const parsed = MapProgramSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Error("LLM produced invalid MapProgram: " + parsed.error.message);
    }
    return parsed.data;
  } catch (e: any) {
    const status = e?.status || e?.response?.status;
    const code = e?.code || e?.response?.data?.error?.code;
    const detail = e?.response?.data?.error?.message || e?.message || String(e);
    throw new Error(`OpenAI request failed${status ? ` (status ${status})` : ""}${code ? ` [${code}]` : ""}: ${detail}`);
  }
}
