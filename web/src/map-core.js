// Browser-compatible version of map setup functions

import { getBorderColor, getTraceColor, getTraceDelta } from './animation-core.js';
import { polygonToLines, filterBordersByISO3 } from './shared/map-core.js';

// Setup border layers on map
export async function setupBorderLayers(map, program, borderData) {
  const ISO3 = (program.border?.isoA3 || '').toString().toUpperCase();
  const highlight = filterBordersByISO3(borderData, ISO3);
  
  // Wait for style to be loaded before adding sources/layers
  if (!map.isStyleLoaded()) {
    console.log('[map-core] waiting for style to load...');
    await new Promise(res => map.once("styledata", res));
  }
  
  // Add border source (country polygons for fallback fill)
  if (map.getSource("border_src")) { map.getSource("border_src").setData(highlight); }
  else { map.addSource("border_src", { type: "geojson", data: highlight }); }

  // Prefer boundaryGeoJSON for tracing/outline if provided
  let borderLines = null;
  if (program.boundaryGeoJSON && program.boundaryGeoJSON.type) {
    const gj = program.boundaryGeoJSON;
    if (gj.type === 'FeatureCollection') {
      const hasLine = (gj.features||[]).some(f => f.geometry?.type?.includes('Line'));
      borderLines = hasLine ? gj : polygonToLines(gj);
    } else borderLines = gj;
  } else {
    borderLines = polygonToLines(highlight);
  }
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
  
  // Verify all layers were created
  const layers = ['border_line', 'border_drawn', 'border_trace'];
  const missing = layers.filter(layerId => !map.getLayer(layerId));
  if (missing.length > 0) {
    console.error('[map-core] Failed to create layers:', missing);
  } else {
    console.log('[map-core] All border layers successfully created');
  }

  return highlight;
}

// Setup the main border line layer
async function setupBorderLinesLayer(map, program) {
  if (map.getLayer("border_line")) {
    console.log('[map-core] border_line layer already exists');
    return;
  }
  
  const showDuringZoom = !!(program.border?.showDuringZoom);
  
  try { 
    map.addLayer({
      id: "border_line",
      type: "line",
      source: "border_lines_src",
      paint: {
        "line-color": getBorderColor(program),
        "line-width": program.border?.strokeWidth ?? 4,
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
    throw e; // Re-throw to indicate failure
  }

  // Disable transitions to avoid flashes
  try { map.setPaintProperty('border_line', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
}

// Setup the drawn border layer (for progressive reveal)
async function setupBorderDrawnLayer(map, program) {
  if (map.getLayer("border_drawn")) {
    console.log('[map-core] border_drawn layer already exists');
    return;
  }
  
  try { 
    map.addLayer({
      id: 'border_drawn',
      type: 'line',
      source: 'border_lines_src',
      paint: {
        'line-color': getBorderColor(program),
        'line-width': (program.border?.strokeWidth ?? 4),
        'line-opacity': 0.0
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' }
    }); 
    console.log('[map-core] added layer border_drawn'); 
  } catch (e) { 
    console.error('[map-core] addLayer border_drawn error', e?.message || e); 
    throw e; // Re-throw to indicate failure
  }
  
  try { map.setPaintProperty('border_drawn', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
  try { map.setPaintProperty('border_drawn', 'line-gradient-transition', { duration: 0, delay: 0 }); } catch {}
}

// Setup the trace layer (animated moving highlight)
async function setupBorderTraceLayer(map, program) {
  if (map.getLayer("border_trace")) {
    console.log('[map-core] border_trace layer already exists');
    return;
  }
  
  try { 
    map.addLayer({
      id: 'border_trace',
      type: 'line',
      source: 'border_lines_src',
      paint: {
        'line-color': getTraceColor(program),
        'line-width': (program.border?.strokeWidth ?? 4) + getTraceDelta(program),
        'line-opacity': 0.0
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' }
    }); 
    console.log('[map-core] added layer border_trace'); 
  } catch (e) { 
    console.error('[map-core] addLayer border_trace error', e?.message || e); 
    throw e; // Re-throw to indicate failure
  }
  
  try { map.setPaintProperty('border_trace', 'line-opacity-transition', { duration: 0, delay: 0 }); } catch {}
  try { map.setPaintProperty('border_trace', 'line-gradient-transition', { duration: 0, delay: 0 }); } catch {}
}

// Update border properties (for live editing in web app)
export function updateBorderProperties(map, program) {
  if (!map.getLayer("border_line")) return;
  
  try {
    map.setPaintProperty('border_line', 'line-color', getBorderColor(program));
    map.setPaintProperty('border_line', 'line-width', program.border?.strokeWidth ?? 4);
    map.setPaintProperty('border_line', 'line-opacity', program.border.opacity ?? 1);
    
    if (map.getLayer("border_drawn")) {
      map.setPaintProperty('border_drawn', 'line-color', getBorderColor(program));
      map.setPaintProperty('border_drawn', 'line-width', program.border?.strokeWidth ?? 4);
    }
    
    if (map.getLayer("border_trace")) {
      map.setPaintProperty('border_trace', 'line-color', getTraceColor(program));
      map.setPaintProperty('border_trace', 'line-width', (program.border?.strokeWidth ?? 4) + getTraceDelta(program));
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
