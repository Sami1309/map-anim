import OpenAI from "openai";
import { MapProgram, MapProgram as MapProgramSchema } from "./program-schema.js";

// Guidance text included in the system prompt to align LLM output to MapProgramSchema
const SCHEMA_GUIDE = `
Produce strict JSON matching this structure (no extra fields):
{
  "camera": { "keyframes": [
    { "center": [lon:number, lat:number], "zoom": number, "bearing"?: number, "pitch"?: number, "t": number }
  ]},
  "border"?: { "isoA3": string(ISO3), "strokeWidth"?: number(1..20), "opacity"?: number(0..1) },
  "style"?: string(url),
  "output": { "width": number(256..3840), "height": number(256..2160), "fps": number(1..60), "format": "webm", "pixelRatio"?: number(1..4), "waitForTiles"?: boolean },
  "flags"?: { "terrain"?: boolean, "terrainExaggeration"?: number, "sky"?: boolean, "buildings"?: boolean, "google3dApiKey"?: string, "google3dOpacity"?: number },
  "boundaryGeoJSON"?: never, // do NOT include raw geometry; backend resolves it
  "boundaryFill"?: string, "boundaryFillOpacity"?: number(0..1), "boundaryLineColor"?: string, "boundaryLineWidth"?: number(0..20),
  "animation"?: { "phases"?: ["zoom"|"highlight"|"trace"|"hold"|"wait"], "waitBeforeTraceMs"?: number, "highlightDurationMs"?: number, "easing"?: string },
  "extras"?: { "address"?: string, "boundaryName"?: string, "boundaryAdminLevel"?: string, "flyThrough"?: boolean }
}

Country vs region:
- If the request is country-level, set border.isoA3 to the ISO3 code (e.g., "USA", "ESP").
- If the request targets a state/region/city, set extras.boundaryName to that place name and DO NOT set border.isoA3.

Phases:
- Include phases only if requested (e.g., "highlight", "trace"/"outline", "hold", "wait"). Always include "zoom" if there are keyframes.

Formatting:
- Output MUST be a single JSON object matching the above shape. No markdown, no comments.
`;

const SYSTEM = `You translate natural‑language mapping animation requests into MapProgram JSON.
Follow the structure below and the rules exactly. Only output JSON.\n\nSCHEMA\n${SCHEMA_GUIDE}\n`;

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
      animation: { easing: "easeOutCubic", phases: ["zoom","trace","hold"] },
      output: { width: 1920, height: 1080, fps: 60, pixelRatio: 2, waitForTiles: false, format: "webm" },
      styleId: "cinematic_zoom"
    }
  }
];

export async function nlToProgram(natural: string): Promise<MapProgram> {
    console.log("nl to program")
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

  // OpenAI Structured Outputs: supply a JSON Schema compatible with their subset
  const MAP_PROGRAM_JSON_SCHEMA: any = {
    type: "object",
    additionalProperties: false,
    properties: {
      camera: {
        type: "object",
        additionalProperties: false,
        properties: {
          keyframes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                center: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                zoom: { type: "number" },
                bearing: { type: ["number","null"] },
                pitch: { type: ["number","null"] },
                t: { type: "number" }
              },
              required: ["center", "zoom", "bearing", "pitch", "t"]
            },
            minItems: 1
          }
        },
        required: ["keyframes"]
      },
      border: {
        type: ["object","null"],
        additionalProperties: false,
        properties: {
          isoA3: { type: ["string","null"] },
          strokeWidth: { type: ["number","null"] },
          opacity: { type: ["number","null"] }
        },
        required: ["isoA3","strokeWidth","opacity"]
      },
      style: { type: ["string","null"] },
      output: {
        type: "object",
        additionalProperties: false,
        properties: {
          width: { type: "number" },
          height: { type: "number" },
          fps: { type: "number" },
          format: { type: "string", enum: ["webm"] },
          background: { type: ["string","null"] },
          pixelRatio: { type: ["number","null"] },
          waitForTiles: { type: ["boolean","null"] }
        },
        required: ["width", "height", "fps", "format", "background", "pixelRatio", "waitForTiles"]
      },
      flags: {
        type: ["object","null"],
        additionalProperties: false,
        properties: {
          terrain: { type: ["boolean","null"] },
          terrainExaggeration: { type: ["number","null"] },
          sky: { type: ["boolean","null"] },
          buildings: { type: ["boolean","null"] },
          google3dApiKey: { type: ["string","null"] },
          google3dOpacity: { type: ["number","null"] }
        },
        required: ["terrain","terrainExaggeration","sky","buildings","google3dApiKey","google3dOpacity"]
      },
      boundaryFill: { type: ["string","null"] },
      boundaryFillOpacity: { type: ["number","null"] },
      boundaryLineColor: { type: ["string","null"] },
      boundaryLineWidth: { type: ["number","null"] },
      animation: {
        type: ["object","null"],
        additionalProperties: false,
        properties: {
          phases: { type: ["array","null"], items: { type: "string", enum: ["zoom","highlight","trace","hold","wait"] } },
          waitBeforeTraceMs: { type: ["number","null"] },
          highlightDurationMs: { type: ["number","null"] },
          easing: { type: ["string","null"] }
        },
        required: ["phases","waitBeforeTraceMs","highlightDurationMs","easing"]
      },
      extras: {
        type: ["object","null"],
        additionalProperties: false,
        properties: {
          address: { type: ["string","null"] },
          boundaryName: { type: ["string","null"] },
          boundaryAdminLevel: { type: ["string","null"] },
          flyThrough: { type: ["boolean","null"] }
        },
        required: ["address","boundaryName","boundaryAdminLevel","flyThrough"]
      },
      boundaryGeoJSON: { type: ["null"] }
    },
    required: ["camera", "border", "style", "output", "flags", "boundaryFill", "boundaryFillOpacity", "boundaryLineColor", "boundaryLineWidth", "animation", "extras", "boundaryGeoJSON"]
  };

  try {
    const model = process.env.OPENAI_MODEL || "gpt-4o-2024-08-06";
    const resp = await client.chat.completions.create({
      model,
      temperature: 0,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: "map_program", schema: MAP_PROGRAM_JSON_SCHEMA, strict: true }
      }
    });
    const text = resp.choices[0]?.message?.content ?? "{}";
    const raw = JSON.parse(text);
    // prune nulls before Zod validation
    function pruneNulls(obj: any): any {
      if (obj === null) return undefined;
      if (Array.isArray(obj)) return obj.map(pruneNulls).filter((v) => v !== undefined);
      if (typeof obj === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(obj)) {
          const pv = pruneNulls(v);
          if (pv !== undefined) out[k] = pv;
        }
        return out;
      }
      return obj;
    }
    const cleaned = pruneNulls(raw);
    const parsed = MapProgramSchema.safeParse(cleaned);
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
