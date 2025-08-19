// Map settings management utilities

export function applyMapSettings(map, settings) {
  if (!map || !map.isStyleLoaded()) return;
  
  try {
    const style = map.getStyle();
    if (!style || !style.layers) return;

    // Apply label visibility
    if (typeof settings.labelsVisible === 'boolean') {
      style.layers.forEach(layer => {
        if (layer.type === 'symbol' && layer.layout && 
            (layer.layout['text-field'] || layer.layout['icon-image'])) {
          const visibility = settings.labelsVisible ? 'visible' : 'none';
          map.setLayoutProperty(layer.id, 'visibility', visibility);
        }
      });
    }

    // Apply label density (by filtering based on zoom and text size)
    if (settings.labelsDensity) {
      const densityMultiplier = {
        'low': 0.5,
        'normal': 1.0, 
        'high': 1.5
      }[settings.labelsDensity] || 1.0;

      style.layers.forEach(layer => {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
          try {
            const currentSize = layer.paint?.['text-size'] || 12;
            const newSize = Math.round(currentSize * densityMultiplier);
            map.setPaintProperty(layer.id, 'text-size', Math.max(8, Math.min(24, newSize)));
          } catch (e) {
            // Some layers might not support text-size changes
          }
        }
      });
    }

    // Apply terrain visibility
    if (typeof settings.terrainVisible === 'boolean') {
      style.layers.forEach(layer => {
        if (layer.id.includes('landcover') || layer.id.includes('landuse') || 
            layer.id.includes('natural') || layer.id.includes('park')) {
          const visibility = settings.terrainVisible ? 'visible' : 'none';
          map.setLayoutProperty(layer.id, 'visibility', visibility);
        }
      });
    }

    // Apply roads visibility
    if (typeof settings.roadsVisible === 'boolean') {
      style.layers.forEach(layer => {
        if (layer.id.includes('road') || layer.id.includes('highway') || 
            layer.id.includes('street') || layer.source === 'transportation') {
          const visibility = settings.roadsVisible ? 'visible' : 'none';
          map.setLayoutProperty(layer.id, 'visibility', visibility);
        }
      });
    }

  } catch (error) {
    console.error('Error applying map settings:', error);
  }
}

export function getDefaultMapSettings() {
  return {
    labelsVisible: true,
    labelsDensity: 'normal',
    terrainVisible: true,
    roadsVisible: true
  };
}

export function mergeAnimationSettings(program, animationSettings) {
  return {
    ...program,
    animation: {
      ...program.animation,
      fastMode: animationSettings.fastMode,
      traceDurationMs: animationSettings.traceDuration,
      traceFrameSkip: animationSettings.traceFrameSkip
    },
    border: {
      ...program.border,
      traceDurationMs: animationSettings.traceDuration
    }
  };
}