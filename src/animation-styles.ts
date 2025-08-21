import { MapProgram } from "./program-schema.js";

export type AnimationStyleId =
  | "cinematic_zoom"
  | "documentary_focus"
  | "tech_outline_trace"
  | "fast_preview";

type PartialDeep<T> = {
  // Make properties optional, and if the property is an object (ignoring undefined),
  // recursively make its fields optional as well. This allows partial defaults like `border`.
  [K in keyof T]?: NonNullable<T[K]> extends object
    ? PartialDeep<NonNullable<T[K]>>
    : T[K];
};

type StyleDef = {
  id: AnimationStyleId;
  description: string;
  llmHint: string;
  defaults: PartialDeep<MapProgram>;
};

export const STYLES: Record<AnimationStyleId, StyleDef> = {
  cinematic_zoom: {
    id: "cinematic_zoom",
    description: "Smooth ease-out zoom, crisp labels at the end, subtle thick border.",
    llmHint: "cinematic zoom-in ending smoothly, labels limited to the target country at the end",
    defaults: {
      labels: { restrictToCountry: true, applyAt: "final" },
      border: { strokeWidth: 6, opacity: 1, color: '#ffcc00', traceColor: '#ffffff', traceWidthDelta: 1, traceAfterZoom: true, traceDurationMs: 3000, traceHoldMs: 2000, showDuringZoom: false, showStaticAfterTrace: true },
      animation: { phases: ["zoom","trace","hold"], fitFinalToBorder: true, fitPaddingPx: 100, easing: "easeOutCubic"  }
    }
  },
  documentary_focus: {
    id: "documentary_focus",
    description: "Emphasize the country with focused labels throughout and moderate motion.",
    llmHint: "documentary style with focused labels and moderate zoom",
    defaults: {
      animation: { easing: "easeInOutCubic" },
      labels: { restrictToCountry: true, applyAt: "always" },
      border: { strokeWidth: 5, opacity: 1, color: '#ffcc00', traceColor: '#ffffff', traceWidthDelta: 1, traceAfterZoom: true, traceDurationMs: 3000, traceHoldMs: 2000, showDuringZoom: false, showStaticAfterTrace: true },
      output: { fps: 30, pixelRatio: 2, waitForTiles: true }
    }
  },
  tech_outline_trace: {
    id: "tech_outline_trace",
    description: "Bold border with post-zoom tracing animation around the country outline.",
    llmHint: "tech style with animated border tracing after zoom",
    defaults: {
      labels: { restrictToCountry: true, applyAt: "final" },
      border: { strokeWidth: 8, opacity: 1, color: '#ffcc00', traceColor: '#ffffff', traceWidthDelta: 1, traceAfterZoom: true, traceDurationMs: 3000, traceHoldMs: 2000, showDuringZoom: false, showStaticAfterTrace: true },
      animation: { phases: ["zoom","trace","hold"], fitFinalToBorder: true, fitPaddingPx: 100, easing: "easeOutQuad" }
    }
  },
  fast_preview: {
    id: "fast_preview",
    description: "Quick render with fewer quality waits; useful for drafts.",
    llmHint: "fast preview with lower quality requirements",
    defaults: {
      output: { fps: 30, waitForTiles: false, pixelRatio: 1 },
      labels: { restrictToCountry: false, applyAt: "final" },
      border: { strokeWidth: 4, opacity: 1, color: '#ffcc00', traceColor: '#ffffff', traceWidthDelta: 1, traceAfterZoom: true, traceDurationMs: 2000, traceHoldMs: 1000, showDuringZoom: false, showStaticAfterTrace: true },
      animation: { phases: ["zoom","trace","hold"], fitFinalToBorder: true, fitPaddingPx: 80, easing: "linear" }
    }
  }
};

export function applyAnimationStyle(program: MapProgram): MapProgram {
  const id = (program.styleId || "cinematic_zoom") as AnimationStyleId;
  const style = STYLES[id as AnimationStyleId] || STYLES.cinematic_zoom;
  // Deep merge defaults into program (shallow for our small shape)
  const merged: MapProgram = {
    ...program,
    output: { ...style.defaults.output, ...program.output },
    border: { ...style.defaults.border, ...program.border },
    labels: { ...(style.defaults.labels as any), ...(program.labels as any) },
    animation: { ...(style.defaults.animation as any), ...(program.animation as any) }
  } as MapProgram;

  // Apply border thickness styleId if strokeWidth not explicitly set
  const hasExplicitStroke = program.border && typeof program.border.strokeWidth === 'number';
  const thicknessId = (program.border as any)?.styleId as string | undefined;
  if (!hasExplicitStroke && thicknessId) {
    const map: Record<string, number> = { thin: 2, medium: 4, thick: 6, bold: 8, ultra: 12 };
    const sw = map[thicknessId] ?? merged.border?.strokeWidth ?? 4;
    (merged.border as any).strokeWidth = sw;
  }
  return merged;
}

// Context injection for specialized animation patterns
export interface AnimationStyleExample {
  keywords: string[];
  description: string;
  example: any;
}

const ANIMATION_CONTEXT_EXAMPLES: AnimationStyleExample[] = [
  {
    keywords: ['swirl', 'spiral', 'circular', 'rotate', 'spinning', 'twirl'],
    description: 'A swirling zoom animation that rotates the camera while zooming in',
    example: {
      camera: {
        keyframes: [
          {
            center: [-122.4102, 37.7908],
            zoom: 8.5,
            bearing: 0,
            pitch: 25,
            t: 0
          },
          {
            center: [-122.4102, 37.7908],
            zoom: 11.5,
            bearing: 120,
            pitch: 40,
            t: 2000
          },
          {
            center: [-122.4102, 37.7908],
            zoom: 13.5,
            bearing: 240,
            pitch: 50,
            t: 4000
          },
          {
            center: [-122.4097472, 37.7898345],
            zoom: 17,
            bearing: 360,
            pitch: 50,
            t: 6000
          }
        ]
      },
      animation: { phases: ["zoom", "hold"], easing: "easeInOutCubic" },
      output: { width: 1920, height: 1080, fps: 30, format: "webm" }
    }
  },
  {
    keywords: ['fly through', 'flythrough', '3d', 'aerial', 'bird view', "bird's eye"],
    description: 'A cinematic fly-through animation with 3D terrain and buildings',
    example: {
      camera: {
        keyframes: [
          {
            center: [-122.4194, 37.7749],
            zoom: 8,
            bearing: 0,
            pitch: 0,
            t: 0
          },
          {
            center: [-122.4194, 37.7749],
            zoom: 12,
            bearing: 45,
            pitch: 60,
            t: 3000
          },
          {
            center: [-122.4097472, 37.7898345],
            zoom: 16,
            bearing: 90,
            pitch: 70,
            t: 6000
          }
        ]
      },
      flags: { terrain: true, sky: true, buildings: true, terrainExaggeration: 1.5 },
      animation: { phases: ["zoom", "hold"], easing: "easeOutCubic" },
      output: { width: 1920, height: 1080, fps: 30, format: "webm" }
    }
  },
  {
    keywords: ['cinematic', 'dramatic', 'movie', 'film'],
    description: 'A cinematic zoom with dramatic camera movements',
    example: {
      camera: {
        keyframes: [
          {
            center: [-122.4194, 37.7749],
            zoom: 6,
            bearing: 0,
            pitch: 0,
            t: 0
          },
          {
            center: [-122.4150, 37.7800],
            zoom: 10,
            bearing: 30,
            pitch: 45,
            t: 2500
          },
          {
            center: [-122.4097472, 37.7898345],
            zoom: 15,
            bearing: 0,
            pitch: 60,
            t: 5000
          }
        ]
      },
      animation: { phases: ["zoom", "hold"], easing: "easeInOutCubic" },
      output: { width: 1920, height: 1080, fps: 60, format: "webm", pixelRatio: 2 }
    }
  }
];

/**
 * Analyzes a user prompt and returns relevant animation style examples to inject into LLM context
 */
export function getAnimationStyleContext(prompt: string): AnimationStyleExample[] {
  const lowerPrompt = prompt.toLowerCase();
  const matchedStyles: AnimationStyleExample[] = [];

  for (const style of ANIMATION_CONTEXT_EXAMPLES) {
    const hasKeyword = style.keywords.some(keyword => 
      lowerPrompt.includes(keyword.toLowerCase())
    );
    
    if (hasKeyword) {
      matchedStyles.push(style);
    }
  }

  return matchedStyles;
}

/**
 * Generates additional context messages for the LLM based on detected animation styles
 */
export function generateStyleContextMessages(prompt: string): Array<{role: string, content: string}> {
  const matchedStyles = getAnimationStyleContext(prompt);
  
  if (matchedStyles.length === 0) {
    return [];
  }

  const contextMessages = [];
  
  for (const style of matchedStyles) {
    contextMessages.push({
      role: 'system',
      content: `User prompt contains "${style.keywords.join(', ')}" keywords. ${style.description}. Example structure: ${JSON.stringify(style.example, null, 2)}`
    });
  }

  return contextMessages;
}
