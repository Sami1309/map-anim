import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { MapProgram } from "./types";
import { runAnimationSequencePreview as runAnimationSequence } from "./shared/animation-core.js";
import { setupBorderLayers, updateBorderProperties, cleanupBorderLayers } from "./map-core.js";
import { applyMapSettings } from "./map-settings.js";

const BORDER_GEOJSON =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson";

// A nicer default basemap than the MapLibre demo tiles.
// Feel free to switch to Voyager/DarkMatter variants.
const POSITRON_NO_LABELS =
  "https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json";

export default function MapPreview({
  program,
  aspectRatio = "flexible",
  mapSettings,
  previewStyleUrl,
  google3dEnabled,
  google3dKey
}: {
  program: MapProgram | null;
  aspectRatio?: "flexible" | "16:9" | "9:16";
  mapSettings?: any;
  previewStyleUrl?: string;
  google3dEnabled?: boolean;
  google3dKey?: string;
}) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const borderDataRef = useRef<any>(null);
  const countryHighlightRef = useRef<any>(null);
  const deckOverlayRef = useRef<any>(null);

  // Calculate container styles based on aspect ratio
  const getContainerStyle = () => {
    const baseStyle: React.CSSProperties = { width: "100%", position: "relative" };
    if (program?.output?.width && program?.output?.height) {
      const pad = (program.output.height / program.output.width) * 100;
      return { ...baseStyle, paddingBottom: `${pad}%` };
    }
    if (aspectRatio === "16:9") {
      return { ...baseStyle, paddingBottom: "56.25%" };
    } else if (aspectRatio === "9:16") {
      return { ...baseStyle, paddingBottom: "177.78%" };
    } else {
      return { ...baseStyle, height: "100%" };
    }
  };

  const getMapStyle = (): React.CSSProperties => {
    if (aspectRatio === "flexible") {
      return { position: "absolute", inset: "0" };
    } else {
      return { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" };
    }
  };

  // Helper: choose a good basemap URL
  const resolveStyleUrl = () => {
    console.log("What is enabled", previewStyleUrl, google3dEnabled)
    console.log(previewStyleUrl, google3dEnabled)
    // If a preview override is provided, respect it.
    // If Google 3D is enabled, prefer a clean/no-labels style so the mesh stands out.
    if (google3dEnabled) return POSITRON_NO_LABELS;
    if (previewStyleUrl) return previewStyleUrl;

    // Else fall back to the program style or MapLibre demo style.
    return program?.style || "https://demotiles.maplibre.org/style.json";
  };

  // Load border data once
  useEffect(() => {
    const loadBorderData = async () => {
      try {
        const response = await fetch(BORDER_GEOJSON);
        borderDataRef.current = await response.json();
      } catch (e) {
        console.error("Failed to load border data:", e);
      }
    };
    loadBorderData();
  }, []);

  // init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolveStyleUrl(),
      center: [0, 0],
      zoom: 1,
      pitch: 45, // give some tilt so 3D tiles look 3D immediately
      bearing: 0,
      attributionControl: false, // we'll add it with custom attribution below
      interactive: true
    });

    // Make sure required attribution is shown (CARTO/OSM from style + Google for 3D tiles)
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "© Google"
      })
    );

    mapRef.current = map;

    return () => {
      try {
        if (deckOverlayRef.current?.finalize) deckOverlayRef.current.finalize();
      } catch {}
      cleanupBorderLayers(map);
      map.remove();
      deckOverlayRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply style change immediately when program style changes or preview override
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const url = resolveStyleUrl();
    if ((map as any).style?._loaded && (map as any).getStyle && (map as any).getStyle().sprite) {
      // Changing style preserves controls; deck overlay survives interleaved mode.
    }
    map.setStyle(url);
  }, [previewStyleUrl, program?.style, google3dEnabled]);

  // Optional: simple 3D tiles preview overlay using deck.gl CDN
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    async function ensureDeckAndLoaders() {
      function loadScript(src: string) {
        return new Promise<void>((res, rej) => {
          const s = document.createElement("script");
          s.src = src;
          s.async = true;
          s.onload = () => res();
          s.onerror = (e) => rej(e);
          document.head.appendChild(s);
        });
      }

      console.log('loading luders')
      // Load deck.gl + loaders.gl UMD bundles (versions aligned)
      if (!(window as any).deck) {
        await loadScript("https://unpkg.com/deck.gl@9.1.0/dist.min.js");
      }
      if (!(window as any).loaders) {
        await loadScript("https://unpkg.com/@loaders.gl/core@4.3.4/dist/dist.min.js");
      }
      // These two expose globals for tile management + 3D Tiles decoding
      if (!(window as any).loadersTiles) {
        await loadScript("https://unpkg.com/@loaders.gl/tiles@4.3.4/dist/dist.min.js");
      }
      if (!(window as any).loaders3dTiles) {
        await loadScript("https://unpkg.com/@loaders.gl/3d-tiles@4.3.4/dist/dist.min.js");
      }
    }

    async function addOrRemoveOverlay() {
      console.log("googoo")
      console.log(google3dEnabled)
      console.log("does key exist: ", google3dKey)
      if (!google3dEnabled || !google3dKey) {
        // Remove if present
        if (deckOverlayRef.current) {
          try {
            deckOverlayRef.current.setProps({ layers: [] });
            deckOverlayRef.current.finalize?.();
          } catch {}
          deckOverlayRef.current = null;
        }
        return;
      }

      console.log("google 3d is enabled")
      await ensureDeckAndLoaders();
      if (cancelled) return;

      console.log("getting deck")
      const deckNS: any = (window as any).deck;
      const loaders3d: any =
        (window as any).loaders3dTiles ||
        (window as any).loaders?._3dTiles || // safety fallback if UMD namespace differs
        (window as any).loaders;

      const Tiles3DLoader =
        loaders3d?.Tiles3DLoader || (loaders3d && loaders3d["Tiles3DLoader"]);
      if (!deckNS || !Tiles3DLoader) {
        console.warn("deck.gl or Tiles3DLoader not available yet");
        return;
      }

      // Compose the Google 3D Tiles root URL (renderer manages session under the hood)
      const root = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${google3dKey}`;

      // Build the 3D layer. Pass the loader explicitly (deck.gl 9+ requirement).
      const layer = new deckNS.Tile3DLayer({
        id: "google-3d",
        data: root,
        loader: Tiles3DLoader,
        opacity: 1,
        // Improve interaction/visuals in a preview context:
        pickable: false,
        loadOptions: {
          // Keep defaults; deck/loaders manage Google sessions from the root.json
        }
      });

      console.log("layer is", layer)

      // Create or update a MapboxOverlay (works with MapLibre) in interleaved mode.
      if (!deckOverlayRef.current) {
        deckOverlayRef.current = new deckNS.MapboxOverlay({
          interleaved: true, // correct occlusion with map labels/terrain
          layers: [layer]
        });
        map.addControl(deckOverlayRef.current as any);
      } else {
        deckOverlayRef.current.setProps({ layers: [layer] });
      }
    }
    console.log("adding overlay")

    addOrRemoveOverlay();

    return () => {
      cancelled = true;
    };
  }, [google3dEnabled, google3dKey]);

  // setup border layers and boundary fill when program changes
  useEffect(() => {
    if (!program || !mapRef.current) return;

    const setupBorders = async () => {
      const map = mapRef.current!;
      try {
        if (!borderDataRef.current) {
          const response = await fetch(BORDER_GEOJSON);
          borderDataRef.current = await response.json();
        }
        const countryHighlight = await setupBorderLayers(map, program, borderDataRef.current);
        countryHighlightRef.current = countryHighlight;

        if (program.boundaryGeoJSON) {
          if (!map.getSource("boundary-src"))
            map.addSource("boundary-src", { type: "geojson", data: program.boundaryGeoJSON as any });
          else (map.getSource("boundary-src") as any).setData(program.boundaryGeoJSON);
          if (!map.getLayer("boundary-fill"))
            map.addLayer({
              id: "boundary-fill",
              type: "fill",
              source: "boundary-src",
              paint: { "fill-color": program.boundaryFill || "#ffcc00", "fill-opacity": 0 }
            });
          if (!map.getLayer("boundary-line"))
            map.addLayer({
              id: "boundary-line",
              type: "line",
              source: "boundary-src",
              paint: {
                "line-color": program.boundaryLineColor || "#ffcc00",
                "line-width": program.boundaryLineWidth || 2,
                "line-opacity": 0
              }
            });
        } else if (countryHighlight) {
          try {
            if (!map.getSource("country-fill-src"))
              map.addSource("country-fill-src", { type: "geojson", data: countryHighlight as any });
            else (map.getSource("country-fill-src") as any).setData(countryHighlight);
            if (!map.getLayer("country-fill"))
              map.addLayer({
                id: "country-fill",
                type: "fill",
                source: "country-fill-src",
                paint: { "fill-color": program.boundaryFill || "#ffcc00", "fill-opacity": 0 }
              });
            if (!map.getLayer("country-outline"))
              map.addLayer({
                id: "country-outline",
                type: "line",
                source: "country-fill-src",
                paint: {
                  "line-color": program.boundaryLineColor || "#ffcc00",
                  "line-width": program.boundaryLineWidth || 2,
                  "line-opacity": 0
                }
              });
          } catch (e) {
            console.warn("[web] add country fill failed", e);
          }
        }

        try {
          if (map.getLayer("boundary-fill")) map.setPaintProperty("boundary-fill", "fill-opacity", 0);
          if (map.getLayer("boundary-line")) map.setPaintProperty("boundary-line", "line-opacity", 0);
          if (map.getLayer("country-fill")) map.setPaintProperty("country-fill", "fill-opacity", 0);
          if (map.getLayer("country-outline")) map.setPaintProperty("country-outline", "line-opacity", 0);
          if (map.getLayer("border_drawn")) map.setPaintProperty("border_drawn", "line-opacity", 0);
          if (map.getLayer("border_trace")) map.setPaintProperty("border_trace", "line-opacity", 0);
        } catch {}
      } catch (e) {
        console.error("Failed to setup border layers:", e);
      }
    };

    setupBorders();
  }, [program?.border?.isoA3, program?.style, JSON.stringify(program?.boundaryGeoJSON)]);

  // update border properties when they change
  useEffect(() => {
    if (!program || !mapRef.current) return;
    updateBorderProperties(mapRef.current, program);
  }, [program?.border?.strokeWidth, program?.border?.opacity]);

  // apply map settings when they change
  useEffect(() => {
    if (!mapRef.current || !mapSettings) return;
    const timeoutId = setTimeout(() => {
      applyMapSettings(mapRef.current!, mapSettings);
    }, 100); // Small delay to ensure style is loaded
    return () => clearTimeout(timeoutId);
  }, [mapSettings]);

  // Full animation playback using shared functions
  const play = async () => {
    if (!program || !mapRef.current || !borderDataRef.current) return;
    const map = mapRef.current;
    try {
      console.log("Starting animation sequence with program:", program);

      // Ensure border layers are set up before animation starts
      console.log("Setting up border layers before animation...");
      await setupBorderLayers(map, program, borderDataRef.current);

      await new Promise((resolve) => setTimeout(resolve, 100));

      try {
        if (map.getLayer("boundary-fill")) map.setPaintProperty("boundary-fill", "fill-opacity", 0);
        if (map.getLayer("boundary-line")) map.setPaintProperty("boundary-line", "line-opacity", 0);
        if (map.getLayer("country-fill")) map.setPaintProperty("country-fill", "fill-opacity", 0);
        if (map.getLayer("country-outline")) map.setPaintProperty("country-outline", "line-opacity", 0);
        if (map.getLayer("border_drawn")) map.setPaintProperty("border_drawn", "line-opacity", 0);
        if (map.getLayer("border_trace")) map.setPaintProperty("border_trace", "line-opacity", 0);
      } catch {}

      try {
        const fc =
          program.boundaryGeoJSON && program.boundaryGeoJSON.type === "FeatureCollection"
            ? program.boundaryGeoJSON
            : countryHighlightRef.current;
        const feat = fc?.features?.[0];
        
        // DISABLED BY DEFAULT: Only apply boundary fitting if explicitly enabled
        // This ensures the frontend always uses the exact program sent by the server
        // To enable boundary fitting, set animation.fitFinalToBorder = true
        const shouldFitToBoundary = feat?.geometry 
          && program.camera?.keyframes?.length 
          && (program.animation as any)?.fitFinalToBorder === true;  // Must be explicitly enabled
          
        if (shouldFitToBoundary) {
          console.log("[web] Fitting camera to boundary (explicitly enabled)");
          const geom = feat.geometry as any;
          const coords = geom.type === "Polygon" ? geom.coordinates.flat(1) : geom.coordinates.flat(2);
          const lons = coords.map((c: any) => c[0]);
          const lats = coords.map((c: any) => c[1]);
          const minLon = Math.min(...lons),
            maxLon = Math.max(...lons);
          const minLat = Math.min(...lats),
            maxLat = Math.max(...lats);
          const pad = Number((program.animation as any)?.fitPaddingPx ?? 80);
          const cam = map.cameraForBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat]
            ],
            { padding: pad }
          );
          if (cam) {
            const last = program.camera.keyframes[program.camera.keyframes.length - 1];
            if (cam.center) {
              // Handle different center formats from MapLibre
              if (Array.isArray(cam.center)) {
                last.center = [cam.center[0], cam.center[1]];
              } else if (typeof cam.center === 'object' && cam.center !== null) {
                const centerObj = cam.center as any;
                const lng = centerObj.lng ?? centerObj.lon ?? centerObj.longitude;
                const lat = centerObj.lat ?? centerObj.latitude;
                if (typeof lng === 'number' && typeof lat === 'number') {
                  last.center = [lng, lat];
                }
              }
            }
            if (typeof cam.zoom === "number" && isFinite(cam.zoom)) last.zoom = cam.zoom;
          }
        } else {
          console.log("[web] Preserving original program coordinates (boundary fitting disabled by default)");
        }
      } catch (e) {
        console.warn("[web] fit camera failed", (e as any)?.message || e);
      }

      const hasTraceLayers =
        map.getLayer("border_trace") && map.getLayer("border_drawn") && map.getLayer("border_line");
      console.log("Border layers ready:", hasTraceLayers);

      if (!hasTraceLayers) {
        console.warn("Border layers not ready, but proceeding with animation");
      }

      if (Array.isArray(program.segments) && program.segments.length) {
        for (const seg of program.segments) {
          // Set boundary sources for THIS segment only (just before running its animation)
          try {
            const segFC =
              seg.boundaryGeoJSON && (seg.boundaryGeoJSON as any).type === "FeatureCollection"
                ? seg.boundaryGeoJSON
                : null;
            if (segFC) {
              console.log(`[web] Setting boundary for segment: ${seg.extras?.boundaryName || 'unknown'}`);
              if (map.getSource("boundary-src")) (map.getSource("boundary-src") as any).setData(segFC);
              else map.addSource("boundary-src", { type: "geojson", data: segFC });
              const hasLine = (segFC.features || []).some((f: any) => f.geometry?.type?.includes("Line"));
              const borderLines = hasLine
                ? segFC
                : (await import("./map-core.js")).polygonToLines(segFC as any);
              if (map.getSource("border_lines_src"))
                (map.getSource("border_lines_src") as any).setData(borderLines as any);
              else map.addSource("border_lines_src", {
                type: "geojson",
                data: borderLines as any,
                lineMetrics: true
              });
            }
          } catch (e) {
            console.warn("[web] segment boundary set failed", (e as any)?.message || e);
          }

          // Reset all boundary visuals before starting this segment
          try {
            if (map.getLayer("boundary-fill")) map.setPaintProperty("boundary-fill", "fill-opacity", 0);
            if (map.getLayer("boundary-line")) map.setPaintProperty("boundary-line", "line-opacity", 0);
            if (map.getLayer("country-fill")) map.setPaintProperty("country-fill", "fill-opacity", 0);
            if (map.getLayer("country-outline")) map.setPaintProperty("country-outline", "line-opacity", 0);
            if (map.getLayer("border_drawn")) map.setPaintProperty("border_drawn", "line-opacity", 0);
            if (map.getLayer("border_trace")) map.setPaintProperty("border_trace", "line-opacity", 0);
          } catch {}

          // Run animation for this segment (uses the boundary we just set)
          await runAnimationSequence(map, { ...program, ...seg } as any);
        }
      } else {
        await runAnimationSequence(map, program);
      }
    } catch (e) {
      console.error("Animation playback error:", e);
    }
  };

  (window as any).__playPreview = play;

  return (
    <div style={getContainerStyle()}>
      <div style={getMapStyle()} ref={containerRef} />
    </div>
  );
}
