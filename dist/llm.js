import OpenAI from "openai";
import { MapProgram as MapProgramSchema } from "./program-schema.js";
const SYSTEM = `You translate natural-language mapping animation requests
into a minimal JSON object called MapProgram. Focus on a single country
border highlight and a camera path. Only output JSON.

Rules:
- Use ISO3 (e.g., ESP for Spain) for 'border.isoA3'.
- Camera.keyframes: chronological, include t (ms), center [lon,lat], zoom, bearing, pitch.
- Output.format MUST be "webm".
- Prefer 1920x1080 @ 60fps for high quality unless the user asks otherwise.
- Also set output.pixelRatio to 2 and output.waitForTiles to true for maximum crispness.
- If the user explicitly provides a style URL (e.g., a high-resolution satellite style), include it at 'style'. Otherwise omit it.
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
            border: { isoA3: "ESP", strokeWidth: 6, opacity: 1 },
            output: { width: 1920, height: 1080, fps: 60, pixelRatio: 2, waitForTiles: true, format: "webm" }
        }
    }
];
export async function nlToProgram(natural) {
    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || undefined
    });
    const messages = [
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
    }
    catch (e) {
        const status = e?.status || e?.response?.status;
        const code = e?.code || e?.response?.data?.error?.code;
        const detail = e?.response?.data?.error?.message || e?.message || String(e);
        throw new Error(`OpenAI request failed${status ? ` (status ${status})` : ""}${code ? ` [${code}]` : ""}: ${detail}`);
    }
}
