// Browser-compatible version of map setup functions

import { getBorderColor, getTraceColor, getTraceDelta } from './animation-core.js';

// Build linework from polygons for crisp outlines and tracing
export function polygonToLines(fc) {
  const out = { type: 'FeatureCollection', features: [] };
  for (const f of fc.features) {
    const g = f.geometry;
    const props = f.properties || {};
    if (!g) continue;
    if (g.type === 'Polygon') {
      for (const ring of g.coordinates) {
        out.features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: ring } });
      }
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        for (const ring of poly) {
          out.features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: ring } });
        }
      }
    }
  }
  return out;
}

// Filter border data by ISO3 code
export function filterBordersByISO3(borderData, ISO3) {
  const feats = borderData.features.filter(f => {
    const p = f.properties || {};
    return [p.ADM0_A3, p.ISO_A3, p["ISO3166-1-Alpha-3"], p.iso_a3]
      .map(x => (x || "").toString().toUpperCase())
      .includes(ISO3);
  });
  
  let matched = feats;
  if (!matched.length) {
    // Fallback: match by 'name' using a small ISO3->Name map (helps with world-atlas datasets)
    const isoToName = { 
      ESP: 'Spain', FRA: 'France', DEU: 'Germany', ITA: 'Italy', GBR: 'United Kingdom', 
      USA: 'United States of America', MEX: 'Mexico', CAN: 'Canada', BRA: 'Brazil', 
      AUS: 'Australia', JPN: 'Japan', CHN: 'China', IND: 'India', RUS: 'Russia' 
    };
    const target = (isoToName[ISO3] || '').toUpperCase();
    if (target) {
      matched = borderData.features.filter(f => ((f.properties?.name || '').toString().toUpperCase()) === target);
      if (!matched.length) {
        // Some datasets use NAME or NAME_EN
        matched = borderData.features.filter(f => {
          const p = f.properties || {};
          return [p.NAME, p.NAME_EN, p.name_long].map(x => (x||'').toString().toUpperCase()).includes(target);
        });
      }
      console.log(`[map-core] fallback name match for ${ISO3}=${target} features=${matched.length}`);
    }
  }
  console.log(`[map-core] border match iso3=${ISO3} features=${matched.length}`);
  
  return { type: "FeatureCollection", features: matched };
}

// Setup border layers on map
export async function setupBorderLayers(map, program, borderData) {
  const ISO3 = (program.border?.isoA3 || '').toString().toUpperCase();
  const highlight = filterBordersByISO3(borderData, ISO3);
  
  // Add border source
  if (map.getSource("border_src")) {
    map.getSource("border_src").setData(highlight);
  } else {
    map.addSource("border_src", { type: "geojson", data: highlight });
  }

  // Convert to lines for tracing
  const borderLines = polygonToLines(highlight);
  console.log(`[map-core] border polygons=${highlight.features.length}, lineFeatures=${borderLines.features.length}`);
  
  try {
    if (map.getSource("border_lines_src")) {
      map.getSource("border_lines_src").setData(borderLines);
    } else {
      map.addSource("border_lines_src", { type: 'geojson', data: borderLines, lineMetrics: true });
    }
  } catch (e) { 
    console.error('[map-core] addSource border_lines_src error', e?.message || e); 
  }

  // Setup border layers if they don't exist
  await setupBorderLinesLayer(map, program);
  await setupBorderDrawnLayer(map, program);
  await setupBorderTraceLayer(map, program);

  return highlight;
}

// Setup the main border line layer
async function setupBorderLinesLayer(map, program) {
  if (map.getLayer("border_line")) return;
  
  // Wait for style to load
  if (!map.isStyleLoaded()) {
    await new Promise(res => map.once("styledata", res));
  }
  
  const showDuringZoom = !!(program.border?.showDuringZoom);
  
  try { 
    map.addLayer({
      id: "border_line",
      type: "line",
      source: "border_lines_src",
      paint: {
        "line-color": getBorderColor(program),
        "line-width": program.border.strokeWidth ?? 4,
        "line-opacity": showDuringZoom ? (program.border?.opacity ?? 1) : 1, // Always visible for preview
        "line-blur": 0
      },
      layout: {
        "line-join": "round",
        "line-cap": "round"
      }
    }); 
    console.log('[map-core] added layer border_line with opacity:', showDuringZoom ? (program.border?.opacity ?? 1) : 1); 
  } catch (e) { 
    console.error('[map-core] addLayer border_line error', e?.message || e); 
  }

  // Disable transitions to avoid flashes
  try { map.setPaintProperty('border_line', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
}

// Setup the drawn border layer (for progressive reveal)
async function setupBorderDrawnLayer(map, program) {
  if (map.getLayer("border_drawn")) return;
  
  try { 
    map.addLayer({
      id: 'border_drawn',
      type: 'line',
      source: 'border_lines_src',
      paint: {
        'line-color': getBorderColor(program),
        'line-width': (program.border.strokeWidth ?? 4),
        'line-opacity': 0.0
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' }
    }); 
    console.log('[map-core] added layer border_drawn'); 
  } catch (e) { 
    console.error('[map-core] addLayer border_drawn error', e?.message || e); 
  }
  
  try { map.setPaintProperty('border_drawn', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
  try { map.setPaintProperty('border_drawn', 'line-gradient-transition', { duration: 0, delay: 0 }); } catch {}
}

// Setup the trace layer (animated moving highlight)
async function setupBorderTraceLayer(map, program) {
  if (map.getLayer("border_trace")) return;
  
  try { 
    map.addLayer({
      id: 'border_trace',
      type: 'line',
      source: 'border_lines_src',
      paint: {
        'line-color': getTraceColor(program),
        'line-width': (program.border.strokeWidth ?? 4) + getTraceDelta(program),
        'line-opacity': 0.0
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' }
    }); 
    console.log('[map-core] added layer border_trace'); 
  } catch (e) { 
    console.error('[map-core] addLayer border_trace error', e?.message || e); 
  }
  
  try { map.setPaintProperty('border_trace', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
  try { map.setPaintProperty('border_trace', 'line-gradient-transition', { duration: 0, delay: 0 }); } catch {}
}

// Update border properties (for live editing in web app)
export function updateBorderProperties(map, program) {
  if (!map.getLayer("border_line")) return;
  
  try {
    map.setPaintProperty('border_line', 'line-color', getBorderColor(program));
    map.setPaintProperty('border_line', 'line-width', program.border.strokeWidth ?? 4);
    map.setPaintProperty('border_line', 'line-opacity', program.border.opacity ?? 1);
    
    if (map.getLayer("border_drawn")) {
      map.setPaintProperty('border_drawn', 'line-color', getBorderColor(program));
      map.setPaintProperty('border_drawn', 'line-width', program.border.strokeWidth ?? 4);
    }
    
    if (map.getLayer("border_trace")) {
      map.setPaintProperty('border_trace', 'line-color', getTraceColor(program));
      map.setPaintProperty('border_trace', 'line-width', (program.border.strokeWidth ?? 4) + getTraceDelta(program));
    }
  } catch (e) {
    console.error('[map-core] updateBorderProperties error', e?.message || e);
  }
}

// Clean up border layers and sources
export function cleanupBorderLayers(map) {
  const layers = ['border_trace', 'border_drawn', 'border_line'];
  const sources = ['border_lines_src', 'border_src'];
  
  for (const layerId of layers) {
    if (map.getLayer(layerId)) {
      try { map.removeLayer(layerId); } catch (e) { console.warn('Failed to remove layer', layerId, e); }
    }
  }
  
  for (const sourceId of sources) {
    if (map.getSource(sourceId)) {
      try { map.removeSource(sourceId); } catch (e) { console.warn('Failed to remove source', sourceId, e); }
    }
  }
}