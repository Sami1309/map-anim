export type CameraKeyframe = {
  center: [number, number];
  zoom: number;
  bearing?: number;
  pitch?: number;
  t: number;
};

export type MapProgram = {
  camera: { keyframes: CameraKeyframe[] };
  border: { isoA3: string; strokeWidth?: number; opacity?: number };
  style?: string;
  output: { width: number; height: number; fps: number; format: "webm"; background?: string; pixelRatio?: number; waitForTiles?: boolean };
  // Optional fields resolved by backend
  flags?: {
    terrain?: boolean;
    terrainExaggeration?: number;
    sky?: boolean;
    buildings?: boolean;
    google3dApiKey?: string;
    google3dOpacity?: number;
  };
  boundaryGeoJSON?: any;
  boundaryFill?: string;
  boundaryFillOpacity?: number;
  boundaryLineColor?: string;
  boundaryLineWidth?: number;
  animation?: {
    phases?: Array<'zoom'|'highlight'|'trace'|'hold'|'wait'>;
    waitBeforeTraceMs?: number;
    highlightDurationMs?: number;
    easing?: string;
    fastMode?: boolean;
    traceFrameSkip?: number;
  };
};
