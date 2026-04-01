import { pipeline, RawImage, env } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/ormbg-ONNX';

// Disable multi-threading: without Cross-Origin-Isolation headers (COOP + COEP)
// the browser blocks SharedArrayBuffer, and the threaded ONNX WASM will hang
// indefinitely at initialisation.  Single-threaded mode works everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env.backends as any).onnx.wasm.numThreads = 1;

export type BiRefNetProgressCallback = (message: string) => void;

export interface RawMaskData {
  alpha: Uint8Array;
  width: number;
  height: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let segmenter: any = null;
let loadPromise: Promise<void> | null = null;

// Serial inference queue: ONNX sessions cannot handle concurrent calls.
let inferenceQueue: Promise<void> = Promise.resolve();

export function isBiRefNetReady(): boolean {
  return segmenter !== null;
}

export async function ensureBiRefNet(onProgress?: BiRefNetProgressCallback): Promise<void> {
  if (isBiRefNetReady()) return;

  if (loadPromise) {
    await loadPromise;
    return;
  }

  const fileProgress: Record<string, number> = {};

  const progressCallback = (info: { status: string; file?: string; progress?: number }) => {
    if (info.status === 'progress') {
      const key = info.file ?? 'model';
      fileProgress[key] = info.progress ?? 0;
      const values = Object.values(fileProgress);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      onProgress?.(`正在下载背景移除模型 ${Math.round(avg)}%...`);
    } else if (info.status === 'initiate') {
      onProgress?.('正在下载背景移除模型文件...');
    } else if (info.status === 'done') {
      onProgress?.('模型文件下载完成，正在初始化 ONNX 运行时...');
    } else if (info.status === 'ready') {
      onProgress?.('背景移除模型已就绪。');
    }
  };

  loadPromise = (async () => {
    onProgress?.('正在加载背景移除模型（首次使用需下载约 44 MB，之后浏览器缓存）...');

    segmenter = await pipeline('background-removal', MODEL_ID, {
      dtype: 'q8',
      progress_callback: progressCallback,
    });
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

/**
 * Run the model and return the raw alpha channel (no threshold applied).
 * This is the expensive ONNX call — cache the result and re-use it when
 * only the threshold changes.
 */
export async function inferBiRefNet(source: HTMLCanvasElement): Promise<RawMaskData> {
  if (!segmenter) {
    throw new Error('背景移除模型未就绪，请等待模型加载完成。');
  }

  let done!: () => void;
  const gate = inferenceQueue;
  inferenceQueue = new Promise<void>((r) => { done = r; });
  await gate;

  try {
    const blob = await canvasToBlob(source);
    const rawImage = await RawImage.fromBlob(blob);

    const output = await segmenter(rawImage);
    const result: RawImage = Array.isArray(output) ? output[0] : output;

    const w = source.width;
    const h = source.height;
    const pixelCount = w * h;

    const sized = (result.width !== w || result.height !== h)
      ? await result.resize(w, h)
      : result;

    const ch = (sized.channels ?? 4) as number;
    const alpha = new Uint8Array(pixelCount);

    if (ch >= 4) {
      for (let i = 0; i < pixelCount; i++) alpha[i] = sized.data[i * ch + 3];
    } else if (ch === 1) {
      for (let i = 0; i < pixelCount; i++) alpha[i] = sized.data[i];
    } else {
      throw new Error(`不支持的输出格式：${ch} 通道`);
    }

    return { alpha, width: w, height: h };
  } finally {
    done();
  }
}

/**
 * Apply a threshold to a raw mask and composite with the source image.
 * Pure & synchronous — safe to call on every slider tick.
 *
 * When `fillHoles` is true, a flood-fill from the image edges identifies all
 * background pixels connected to the border.  Any transparent pixel that is
 * NOT connected to the border is treated as an interior hole and filled opaque.
 */
export function buildMaskResult(
  source: HTMLCanvasElement,
  raw: RawMaskData,
  threshold: number,
  fillHoles = false,
): { image: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const { alpha: rawAlpha, width: w, height: h } = raw;
  const pixelCount = w * h;

  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) throw new Error('无法获取画布上下文。');
  const srcData = sourceCtx.getImageData(0, 0, w, h);

  const margin = 15;
  const lo = Math.max(0, threshold - margin);
  const hi = Math.min(255, threshold + margin);
  const range = hi - lo || 1;
  const scale = 255 / range;

  const sharp = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const a = rawAlpha[i];
    sharp[i] = a <= lo ? 0 : a >= hi ? 255 : Math.round((a - lo) * scale);
  }

  if (fillHoles) fillInteriorHoles(sharp, rawAlpha, threshold, w, h);

  const outputData = new Uint8ClampedArray(pixelCount * 4);
  const maskData = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const v = sharp[i];
    const di = i * 4;

    outputData[di] = srcData.data[di];
    outputData[di + 1] = srcData.data[di + 1];
    outputData[di + 2] = srcData.data[di + 2];
    outputData[di + 3] = v;

    maskData[di] = v;
    maskData[di + 1] = v;
    maskData[di + 2] = v;
    maskData[di + 3] = 255;
  }

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = w;
  outputCanvas.height = h;
  outputCanvas.getContext('2d')!.putImageData(
    new ImageData(outputData, w, h),
    0,
    0,
  );

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  maskCanvas.getContext('2d')!.putImageData(
    new ImageData(maskData, w, h),
    0,
    0,
  );

  return { image: outputCanvas, mask: maskCanvas };
}

/**
 * Convenience: inference + threshold in one call (used for batch processing).
 */
export async function applyBiRefNet(
  source: HTMLCanvasElement,
  threshold = 128,
  fillHoles = false,
): Promise<{ image: HTMLCanvasElement; mask: HTMLCanvasElement }> {
  const raw = await inferBiRefNet(source);
  return buildMaskResult(source, raw, threshold, fillHoles);
}

/**
 * BFS flood-fill from border pixels to find edge-connected background.
 * Connectivity is tested against the RAW model alpha (not the sharpened mask)
 * so that the contrast-stretch doesn't create false paths through foreground
 * edges.  Any low-alpha pixel not reachable from the border is an interior
 * hole and gets filled to fully opaque.
 */
function fillInteriorHoles(
  mask: Uint8Array,
  rawAlpha: Uint8Array,
  threshold: number,
  w: number,
  h: number,
): void {
  const total = w * h;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const seed = (idx: number) => {
    if (rawAlpha[idx] < threshold && !visited[idx]) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0)     seed(idx - 1);
    if (x < w - 1) seed(idx + 1);
    if (y > 0)     seed(idx - w);
    if (y < h - 1) seed(idx + w);
  }

  // Only fill interior pixels that don't touch the background.
  // Pixels on the silhouette boundary keep their original alpha (anti-aliasing).
  for (let i = 0; i < total; i++) {
    if (visited[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (
      (x > 0     && visited[i - 1]) ||
      (x < w - 1 && visited[i + 1]) ||
      (y > 0     && visited[i - w]) ||
      (y < h - 1 && visited[i + w]) ||
      (x > 0     && y > 0     && visited[i - w - 1]) ||
      (x < w - 1 && y > 0     && visited[i - w + 1]) ||
      (x > 0     && y < h - 1 && visited[i + w - 1]) ||
      (x < w - 1 && y < h - 1 && visited[i + w + 1])
    ) continue; // edge pixel — keep original sharp value
    mask[i] = 255;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('画布转图像失败。'));
      }
    }, 'image/png');
  });
}
