// Shared geometry helpers

export function polygonToLines(fc) {
  const out = { type: 'FeatureCollection', features: [] };
  for (const f of fc.features || []) {
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

export function filterBordersByISO3(borderData, ISO3) {
  const feats = (borderData.features || []).filter(f => {
    const p = f.properties || {};
    return [p.ADM0_A3, p.ISO_A3, p["ISO3166-1-Alpha-3"], p.iso_a3]
      .map(x => (x || "").toString().toUpperCase())
      .includes(ISO3);
  });
  let matched = feats;
  if (!matched.length) {
    const isoToName = { ESP:'Spain', FRA:'France', DEU:'Germany', ITA:'Italy', GBR:'United Kingdom', USA:'United States of America', MEX:'Mexico', CAN:'Canada', BRA:'Brazil', AUS:'Australia', JPN:'Japan', CHN:'China', IND:'India', RUS:'Russia' };
    const target = (isoToName[ISO3] || '').toUpperCase();
    if (target) {
      matched = (borderData.features || []).filter(f => ((f.properties?.name || '').toString().toUpperCase()) === target);
      if (!matched.length) {
        matched = (borderData.features || []).filter(f => {
          const p = f.properties || {};
          return [p.NAME, p.NAME_EN, p.name_long].map(x => (x||'').toString().toUpperCase()).includes(target);
        });
      }
    }
  }
  return { type: 'FeatureCollection', features: matched };
}

try { if (typeof window !== 'undefined') window.MapCore = { polygonToLines, filterBordersByISO3 }; } catch {}

