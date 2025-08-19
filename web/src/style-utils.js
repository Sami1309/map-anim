// Style utilities for handling MapTiler key substitution

export async function processStyleUrl(styleUrl) {
  // If it's not a maptiler URL, return as-is
  if (!styleUrl.includes('maptiler.com') && !styleUrl.includes('{key}')) {
    return styleUrl;
  }

  // For frontend, we need to fetch and process styles with keys client-side
  // This is a limitation - ideally the backend would handle this
  try {
    // First try to fetch the style directly
    const response = await fetch(styleUrl);
    if (response.ok) {
      return styleUrl; // If it works without key substitution, use it
    }

    // If it fails, we can't substitute the key client-side for security
    // Fall back to a working style
    console.warn('Style requires MapTiler key, falling back to default style');
    return "https://demotiles.maplibre.org/style.json";
    
  } catch (error) {
    console.warn('Failed to load style, falling back to default:', error);
    return "https://demotiles.maplibre.org/style.json";
  }
}

export function isMapTilerStyle(styleUrl) {
  return styleUrl && (styleUrl.includes('maptiler.com') || styleUrl.includes('{key}'));
}