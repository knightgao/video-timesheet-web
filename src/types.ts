export type VideoMeta = {
  duration: number;
  width: number;
  height: number;
  name: string;
};

export type ExtractionOptions = {
  frameCount: number;
  includeTimestamps: boolean;
};

export type SheetOptions = {
  columns: number;
  gap: number;
  backgroundColor: string;
};

export type RenderResult = {
  blob: Blob;
  objectUrl: string;
  outputWidth: number;
  outputHeight: number;
};

export type ExtractedFrame = {
  image: HTMLCanvasElement;
  time: number;
  label: string;
};

export type LayoutMetrics = {
  rows: number;
  canvasWidth: number;
  canvasHeight: number;
  frameWidth: number;
  frameHeight: number;
  labelBlockHeight: number;
};

