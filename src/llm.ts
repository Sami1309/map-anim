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
  // NOTE: If user provides a street address (like "123 Main St, City, State"), set extras.address to that full string
}

Country vs region:
- If the request is country-level, set border.isoA3 to the ISO3 code (e.g., "USA", "ESP").
- If the request targets a state/region/city, set extras.boundaryName to that place name and DO NOT set border.isoA3.

Phases:
- Include phases only if requested (e.g., "highlight", "trace"/"outline", "hold", "wait"). Always include "zoom" if there are keyframes.
- The prompt may call for multiple phases. For example: "Zoom into Michigah, then hold, then zoom into Detroit and trace it" would translate to ["zoom", "hold", "zoom", "trace", "hold"]
- Pad the phases with holds of a reasonable size to balance out the video.

Formatting:
- Output MUST be a single JSON object matching the above shape. No markdown, no comments.
`;

const SYSTEM = `You translate natural‑language mapping animation requests into MapProgram JSON.
Follow the structure below and the rules exactly. Only output JSON.

Multi-part instructions:
- If the user specifies multiple steps (e.g., "zoom into A and trace, then zoom into B and trace"), emit a segments array where each segment has its own camera.keyframes and phases.
- For each segment, set extras.boundaryName to the region to highlight/trace (e.g., "Michigan", "Detroit").
- Default per-segment phases: include 'zoom'. If the user mentions 'highlight', add 'highlight'. If 'trace', add 'trace'. Always add 'hold' at the end of each segment sequence.
- Do not output raw boundary GeoJSON; the backend will resolve it.
- If the user specifies a street address, ALWAYS set extras.address to the full address string (e.g. "123 Main St, New York, NY"). The backend will geocode it and set the camera coordinates automatically.

SCHEMA
${SCHEMA_GUIDE}
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
      animation: { easing: "easeOutCubic", phases: ["zoom","trace","hold"] },
      output: { width: 1920, height: 1080, fps: 60, pixelRatio: 2, waitForTiles: false, format: "webm" },
      styleId: "cinematic_zoom"
    }
  },
  {
    user: "Zoom to 123 Main Street, New York, NY and hold for 3 seconds",
    json: {
      camera: {
        keyframes: [
          { center: [-74.0060, 40.7128], zoom: 8, bearing: 0, pitch: 0, t: 0 },
          { center: [-74.0060, 40.7128], zoom: 12, bearing: 0, pitch: 20, t: 2000 },
          { center: [-74.0060, 40.7128], zoom: 17, bearing: 0, pitch: 50, t: 3000 }
        ]
      },
      extras: { address: "123 Main Street, New York, NY" },
      animation: { phases: ["zoom", "hold"] },
      output: { width: 1920, height: 1080, fps: 30, format: "webm" }
    }
  },
  {
    user: "Zoom into Spain, trace its border, then zoom out to Europe",
    json: {
      camera: {
        keyframes: [
          { center: [10, 50], zoom: 2.5, bearing: 0, pitch: 0, t: 0 },
          { center: [-3.7, 40.4], zoom: 5.5, bearing: 0, pitch: 40, t: 4000 },
          { center: [10, 50], zoom: 2.5, bearing: 0, pitch: 0, t: 8000 }
        ]
      },
      segments: [
        {
          camera: {
            keyframes: [
              { center: [10, 50], zoom: 2.5, bearing: 0, pitch: 0, t: 0 },
              { center: [-3.7, 40.4], zoom: 5.5, bearing: 0, pitch: 40, t: 4000 }
            ]
          },
          extras: { boundaryName: "Spain" },
          phases: ["zoom", "trace", "hold"]
        },
        {
          camera: {
            keyframes: [
              { center: [-3.7, 40.4], zoom: 5.5, bearing: 0, pitch: 40, t: 0 },
              { center: [10, 50], zoom: 2.5, bearing: 0, pitch: 0, t: 4000 }
            ]
          },
          extras: { boundaryName: "Europe" },
          phases: ["zoom", "hold"]
        }
      ],
      animation: { phases: ["zoom", "trace", "hold", "zoom", "hold"] },
      output: { width: 1920, height: 1080, fps: 30, format: "webm" }
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

  console.log("here is schema")

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
      boundaryGeoJSON: { type: ["null"] },
      boundaryGeoJSONs: { type: ["array","null"], items: { type: "object", additionalProperties: false } },
      segments: { type: ["array","null"], items: {
        type: "object",
        additionalProperties: false,
        properties: {
          camera: { type: "object", additionalProperties: false, properties: {
            keyframes: { type: "array", items: {
              type: "object",
              additionalProperties: false,
              properties: {
                center: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                zoom: { type: "number" },
                bearing: { type: ["number","null"] },
                pitch: { type: ["number","null"] },
                t: { type: "number" }
              },
              required: ["center","zoom","bearing","pitch","t"]
            }, minItems: 1 }
          }, required: ["keyframes"] },
          border: { type: ["object","null"], additionalProperties: false, properties: {
            isoA3: { type: ["string","null"] }, strokeWidth: { type: ["number","null"] }, opacity: { type: ["number","null"] }
          }, required: ["isoA3","strokeWidth","opacity"] },
          extras: { type: ["object","null"], additionalProperties: false, properties: {
            boundaryName: { type: ["string","null"] }, address: { type: ["string","null"] }
          }, required: ["boundaryName","address"] },
          boundaryGeoJSON: { type: ["null"] },
          phases: { type: ["array","null"], items: { type: "string", enum: ["zoom","highlight","trace","hold","wait"] } }
        },
        required: ["camera","border","extras","boundaryGeoJSON","phases"]
      }}
    },
    required: ["camera", "border", "style", "output", "flags", "boundaryFill", "boundaryFillOpacity", "boundaryLineColor", "boundaryLineWidth", "animation", "extras", "boundaryGeoJSON", "boundaryGeoJSONs", "segments"]
  };

  try {
    const model = process.env.OPENAI_MODEL || "gpt-5";
    console.log("querying openai now")
    const resp = await client.chat.completions.create({
      model,
    //   temperature: 0,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: "map_program", schema: MAP_PROGRAM_JSON_SCHEMA, strict: true }
      }
    });
    const text = resp.choices[0]?.message?.content ?? "{}";
    const raw = JSON.parse(text);
    // prune nulls before Zod validation
    console.log("got raw text: ", raw)
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
    console.log("parsing now")
    const parsed = MapProgramSchema.safeParse(cleaned);
    if (!parsed.success) {
      throw new Error("LLM produced invalid MapProgram: " + parsed.error.message);
    }
    return parsed.data;
  } catch (e: any) {
    const status = e?.status || e?.response?.status;
    const code = e?.code || e?.response?.data?.error?.code;
    const detail = e?.response?.data?.error?.message || e?.message || String(e);
    console.log(detail)

    throw new Error(`OpenAI request failed${status ? ` (status ${status})` : ""}${code ? ` [${code}]` : ""}: ${detail}`);
  }
}
