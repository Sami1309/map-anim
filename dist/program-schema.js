import { z } from "zod";
/**
 * The LLM will produce this strict JSON.
 * Keep it small and deterministic so we can validate easily.
 */
export const CameraKeyframe = z.object({
    /** [lon, lat] in WGS84 */
    center: z.tuple([z.number(), z.number()]),
    zoom: z.number().min(0).max(22),
    bearing: z.number().default(0),
    pitch: z.number().min(0).max(85).default(0),
    /** time the keyframe should be reached (ms since animation start) */
    t: z.number().nonnegative()
});
export const BorderHighlight = z.object({
    /** ISO3 country code (e.g., 'ESP', 'USA'), case-insensitive */
    isoA3: z.string().length(3),
    /** 2px..20px reasonable stroke width */
    strokeWidth: z.number().min(1).max(20).default(4),
    /** 0..1 opacity */
    opacity: z.number().min(0).max(1).default(1)
});
export const OutputSpec = z.object({
    width: z.number().min(256).max(3840).default(1280),
    height: z.number().min(256).max(2160).default(720),
    fps: z.number().min(1).max(60).default(30),
    /** 'webm' for hubble.gl WebmEncoder */
    format: z.literal("webm").default("webm"),
    /** optional background color behind transparent areas */
    background: z.string().optional(),
    /** device pixel ratio used by MapLibre for crisper rendering (1..4) */
    pixelRatio: z.number().min(1).max(4).default(2).optional(),
    /** if true/omitted, wait for tiles each frame for max quality; set false for speed */
    waitForTiles: z.boolean().default(false).optional()
});
export const MapProgram = z.object({
    /**
     * Zoom/camera path described by keyframes; times must be monotonic.
     * We’ll spline-interpolate between frames in the page.
     */
    camera: z.object({
        keyframes: z.array(CameraKeyframe).min(1)
    }),
    /**
     * Which border(s) to highlight.
     * (Extend later to multiple or admin-1)
     */
    border: BorderHighlight,
    /**
     * Map style URL (default to MapLibre demo style if omitted).
     */
    style: z.string().url().optional(),
    /**
     * How to encode the output
     */
    output: OutputSpec
});
