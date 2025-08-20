export interface MapStyle {
  name: string;
  url: string;
  description?: string;
}

const API = (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:8080";

export const MAP_STYLES: MapStyle[] = [
  {
    name: "Default (MapLibre)",
    url: "https://demotiles.maplibre.org/style.json",
    description: "Basic tokenless style - always works"
  },
  {
    name: "Dark Matter (with MapTiler tiles)",
    url: `${API}/style.json`,
    description: "Dark theme using MapTiler vector tiles (requires key)"
  },
  {
    name: "Positron",
    url: "https://raw.githubusercontent.com/openmaptiles/positron-gl-style/master/style.json", 
    description: "Light theme with minimal styling"
  },
  {
    name: "OSM Bright",
    url: "https://raw.githubusercontent.com/openmaptiles/osm-bright-gl-style/master/style.json",
    description: "Colorful OpenStreetMap style"
  },
  {
    name: "Klokantech Basic",
    url: "https://raw.githubusercontent.com/openmaptiles/klokantech-basic-gl-style/master/style.json",
    description: "Clean basic style"
  },
  {
    name: "MapTiler Streets",
    url: "https://api.maptiler.com/maps/streets-v2/style.json?key={key}",
    description: "High-quality streets - backend rendering only"
  },
  {
    name: "MapTiler Satellite", 
    url: "https://api.maptiler.com/maps/satellite/style.json?key={key}",
    description: "Satellite imagery - backend rendering only"
  },
  {
    name: "3D Tiles (Preview)",
    url: "3D_TILES_PREVIEW",
    description: "Preview Google Photorealistic 3D Tiles in-app"
  }
];

export interface MapSetting {
  key: string;
  name: string;
  type: "boolean" | "select" | "number";
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue: any;
  description?: string;
}

export const MAP_SETTINGS: MapSetting[] = [
  {
    key: "labelsVisible",
    name: "Labels Visible",
    type: "boolean",
    defaultValue: true,
    description: "Show/hide text labels on the map"
  },
  {
    key: "labelsDensity",
    name: "Label Density",
    type: "select",
    options: [
      { value: "low", label: "Low" },
      { value: "normal", label: "Normal" },
      { value: "high", label: "High" }
    ],
    defaultValue: "normal",
    description: "Control density of visible labels"
  },
  {
    key: "terrainVisible",
    name: "Terrain Visible", 
    type: "boolean",
    defaultValue: true,
    description: "Show/hide terrain features"
  },
  {
    key: "roadsVisible",
    name: "Roads Visible",
    type: "boolean", 
    defaultValue: true,
    description: "Show/hide road network"
  }
];

export interface AnimationSettings {
  fastMode: boolean;
  traceDuration: number; // ms
  traceFrameSkip: number; // frames to skip for performance
}

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  fastMode: false,
  traceDuration: 3000, // 3 seconds
  traceFrameSkip: 1 // no skipping by default
};

export const FAST_ANIMATION_SETTINGS: AnimationSettings = {
  fastMode: true,
  traceDuration: 1500, // 1.5 seconds
  traceFrameSkip: 2 // skip every other frame
};
