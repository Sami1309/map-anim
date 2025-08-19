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
  output: { width: number; height: number; fps: number; format: "webm"; background?: string };
};