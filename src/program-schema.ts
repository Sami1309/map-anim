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
  /** Optional preset thickness selector; explicit strokeWidth overrides this */
  styleId: z.enum(["thin", "medium", "thick", "bold", "ultra"]).optional(),
  /** 2px..20px reasonable stroke width */
  strokeWidth: z.number().min(1).max(20).default(4),
  /** 0..1 opacity */
  opacity: z.number().min(0).max(1).default(1),
  /** outline color (CSS color) */
  color: z.string().default('#ffcc00').optional(),
  /** tracing edge color (CSS color) */
  traceColor: z.string().default('#ffffff').optional(),
  /** extra width of trace over base outline */
  traceWidthDelta: z.number().min(0).max(10).default(1).optional(),
  /** whether to show the static outline during the zoom */
  showDuringZoom: z.boolean().default(false).optional(),
  /** whether to show the static outline after tracing completes */
  showStaticAfterTrace: z.boolean().default(true).optional(),
  /** if true, animate a tracing stroke around the border after zoom-in */
  traceAfterZoom: z.boolean().default(true).optional(),
  /** ms to trace the full border path; used when traceAfterZoom is true */
  traceDurationMs: z.number().min(100).max(60000).default(3000).optional(),
  /** ms to hold the final frame after tracing completes */
  traceHoldMs: z.number().min(0).max(60000).default(2000).optional(),
  /** small offset to avoid flash at trace start (0..0.2) */
  traceStartOffset: z.number().min(0).max(0.2).default(0.03).optional()
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

export const LabelsSpec = z.object({
  /** restrict label rendering to within the selected country border */
  restrictToCountry: z.boolean().default(false).optional(),
  /** when to apply the restriction: 'always' or only at the 'final' zoomed-in phase */
  applyAt: z.enum(["always", "final"]).default("final").optional()
}).default({}).optional();

export const AnimationSpec = z.object({
  /** easing function for camera motion */
  easing: z.enum(["linear", "easeOutCubic", "easeInOutCubic", "easeOutQuad"]).default("easeOutCubic").optional(),
  /** ordered phase list to run */
  phases: z.array(z.enum(["zoom","wait","trace","hold"]))
    .default(["zoom","trace","hold"]).optional(),
  /** milliseconds to wait between zoom and trace phases */
  waitBeforeTraceMs: z.number().min(0).max(60000).default(0).optional(),
  /** auto-fit final camera to border bounds for ideal framing */
  fitFinalToBorder: z.boolean().default(true).optional(),
  /** padding in pixels when fitting final camera */
  fitPaddingPx: z.number().min(0).max(400).default(80).optional()
}).default({}).optional();

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
  /** Optional preset style ID to apply renderer defaults */
  styleId: z.string().optional(),
  /** Label behavior */
  labels: LabelsSpec,
  /** Camera animation behavior */
  animation: AnimationSpec,
  /**
   * How to encode the output
   */
  output: OutputSpec
});

export type MapProgram = z.infer<typeof MapProgram>;
