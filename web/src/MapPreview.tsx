import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { MapProgram } from "./types";
import { runAnimationSequence } from "./animation-core.js";
import { setupBorderLayers, updateBorderProperties, cleanupBorderLayers } from "./map-core.js";
import { applyMapSettings } from "./map-settings.js";

const BORDER_GEOJSON =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson"; // via geojson.xyz CDN

export default function MapPreview({ 
  program, 
  aspectRatio = "flexible",
  mapSettings
}: { 
  program: MapProgram | null; 
  aspectRatio?: "flexible" | "16:9" | "9:16";
  mapSettings?: any;
}) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const borderDataRef = useRef<any>(null);

  // Calculate container styles based on aspect ratio
  const getContainerStyle = () => {
    const baseStyle: React.CSSProperties = { width: "100%", position: "relative" };
    // Prefer program aspect ratio to match final render framing
    if (program?.output?.width && program?.output?.height) {
      const pad = (program.output.height / program.output.width) * 100;
      return { ...baseStyle, paddingBottom: `${pad}%` };
    }
    if (aspectRatio === "16:9") {
      return { ...baseStyle, paddingBottom: "56.25%" }; // 9/16 * 100%
    } else if (aspectRatio === "9:16") {
      return { ...baseStyle, paddingBottom: "177.78%" }; // 16/9 * 100%
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
      style: "https://demotiles.maplibre.org/style.json", // tokenless starter
      center: [0, 0], zoom: 1, attributionControl: false, interactive: true
    });
    mapRef.current = map;
    return () => { 
      cleanupBorderLayers(map);
      map.remove(); 
      mapRef.current = null; 
    };
  }, []);

  // apply style change immediately when program style changes
  useEffect(() => {
    if (!mapRef.current) return;
    
    const styleUrl = program?.style || "https://demotiles.maplibre.org/style.json";
    
    // Always set style when it changes - MapLibre will handle if it's the same
    mapRef.current.setStyle(styleUrl);
  }, [program?.style]);

  // setup border layers and boundary fill when program changes
  useEffect(() => {
    if (!program || !mapRef.current) return;
    
    const setupBorders = async () => {
      const map = mapRef.current!;
      try {
        // Load country border data if missing, for ISO3 tracing fallback
        if (!borderDataRef.current) {
          const response = await fetch(BORDER_GEOJSON);
          borderDataRef.current = await response.json();
        }
        const countryHighlight = await setupBorderLayers(map, program, borderDataRef.current);
        // Add boundary fill/outline if boundaryGeoJSON is present (start invisible; highlight phase will fade in)
        if (program.boundaryGeoJSON) {
          if (!map.getSource('boundary-src')) map.addSource('boundary-src', { type: 'geojson', data: program.boundaryGeoJSON as any });
          else (map.getSource('boundary-src') as any).setData(program.boundaryGeoJSON);
          if (!map.getLayer('boundary-fill')) map.addLayer({ id: 'boundary-fill', type: 'fill', source: 'boundary-src', paint: { 'fill-color': program.boundaryFill || '#ffcc00', 'fill-opacity': 0 } });
          if (!map.getLayer('boundary-line')) map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary-src', paint: { 'line-color': program.boundaryLineColor || '#ffcc00', 'line-width': program.boundaryLineWidth || 2, 'line-opacity': 0 } });
        } else if (countryHighlight) {
          try {
            if (!map.getSource('country-fill-src')) map.addSource('country-fill-src', { type: 'geojson', data: countryHighlight as any });
            else (map.getSource('country-fill-src') as any).setData(countryHighlight);
            if (!map.getLayer('country-fill')) map.addLayer({ id:'country-fill', type:'fill', source:'country-fill-src', paint:{ 'fill-color': program.boundaryFill || '#ffcc00', 'fill-opacity': 0 } });
            if (!map.getLayer('country-outline')) map.addLayer({ id:'country-outline', type:'line', source:'country-fill-src', paint:{ 'line-color': program.boundaryLineColor || '#ffcc00', 'line-width': program.boundaryLineWidth || 2, 'line-opacity': 0 } });
          } catch (e) { console.warn('[web] add country fill failed', e); }
        }
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
  }, [program?.border.strokeWidth, program?.border.opacity]);

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
      
      // Small delay to ensure layers are ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify layers exist
      const hasTraceLayers = map.getLayer('border_trace') && map.getLayer('border_drawn') && map.getLayer('border_line');
      console.log("Border layers ready:", hasTraceLayers);
      
      if (!hasTraceLayers) {
        console.warn("Border layers not ready, but proceeding with animation");
      }
      
      await runAnimationSequence(map, program);
    } catch (e) {
      console.error("Animation playback error:", e);
    }
  };

  // expose on window for App to call
  (window as any).__playPreview = play;

  return (
    <div style={getContainerStyle()}>
      <div style={getMapStyle()} ref={containerRef} />
    </div>
  );
}
