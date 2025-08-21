export const STYLES = {
    cinematic_zoom: {
        id: "cinematic_zoom",
        description: "Smooth ease-out zoom, crisp labels at the end, subtle thick border.",
        llmHint: "cinematic zoom-in ending smoothly, labels limited to the target country at the end",
        defaults: {
            labels: { restrictToCountry: true, applyAt: "final" },
            border: { strokeWidth: 6, opacity: 1, color: '#ffcc00', traceColor: '#ffffff', traceWidthDelta: 1, traceAfterZoom: true, traceDurationMs: 3000, traceHoldMs: 2000, showDuringZoom: false, showStaticAfterTrace: true },
            animation: { phases: ["zoom", "trace", "hold"], fitFinalToBorder: true, fitPaddingPx: 100, easing: "easeOutCubic" }
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
            animation: { phases: ["zoom", "trace", "hold"], fitFinalToBorder: true, fitPaddingPx: 100, easing: "easeOutQuad" }
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
            animation: { phases: ["zoom", "trace", "hold"], fitFinalToBorder: true, fitPaddingPx: 80, easing: "linear" }
        }
    }
};
export function applyAnimationStyle(program) {
    const id = (program.styleId || "cinematic_zoom");
    const style = STYLES[id] || STYLES.cinematic_zoom;
    // Deep merge defaults into program (shallow for our small shape)
    const merged = {
        ...program,
        output: { ...style.defaults.output, ...program.output },
        border: { ...style.defaults.border, ...program.border },
        labels: { ...style.defaults.labels, ...program.labels },
        animation: { ...style.defaults.animation, ...program.animation }
    };
    // Apply border thickness styleId if strokeWidth not explicitly set
    const hasExplicitStroke = program.border && typeof program.border.strokeWidth === 'number';
    const thicknessId = program.border?.styleId;
    if (!hasExplicitStroke && thicknessId) {
        const map = { thin: 2, medium: 4, thick: 6, bold: 8, ultra: 12 };
        const sw = map[thicknessId] ?? merged.border?.strokeWidth ?? 4;
        merged.border.strokeWidth = sw;
    }
    return merged;
}
