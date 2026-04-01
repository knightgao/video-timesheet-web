import type {
  ColorKeyOptions,
  ColorSample,
  ExtractedFrame,
  KeyAlgorithm,
  ProcessedFrame,
  RGBColor,
} from '../types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function channelToHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function rgbToHex(rgb: RGBColor): string {
  return `#${channelToHex(rgb.r)}${channelToHex(rgb.g)}${channelToHex(rgb.b)}`;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getDominantChannel(sample: RGBColor): 'r' | 'g' | 'b' {
  if (sample.r >= sample.g && sample.r >= sample.b) {
    return 'r';
  }

  if (sample.g >= sample.r && sample.g >= sample.b) {
    return 'g';
  }

  return 'b';
}

export function computeColorDistance(
  pixel: RGBColor,
  sample: RGBColor,
  algorithm: KeyAlgorithm,
): number {
  const dr = pixel.r - sample.r;
  const dg = pixel.g - sample.g;
  const db = pixel.b - sample.b;

  if (algorithm === 'classic') {
    return Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
  }

  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
}

export function getOpacityForDistance(
  distance: number,
  tolerance: number,
  softness: number,
  algorithm: KeyAlgorithm,
  smoothing: boolean,
): number {
  const threshold = Math.max(0, tolerance);
  const feather = smoothing ? Math.max(0, softness) : 0;

  if (distance <= threshold) {
    return 0;
  }

  if (feather <= 0) {
    return 1;
  }

  if (distance >= threshold + feather) {
    return 1;
  }

  const progress = (distance - threshold) / feather;
  if (algorithm === 'classic') {
    return progress;
  }

  return progress * progress * (3 - 2 * progress);
}

export function applyDespill(
  pixel: RGBColor,
  sample: RGBColor,
  opacity: number,
  despill: number,
): RGBColor {
  const normalizedDespill = clamp(despill, 0, 100) / 100;
  const reductionFactor = (1 - opacity) * normalizedDespill;

  if (reductionFactor <= 0) {
    return pixel;
  }

  const dominant = getDominantChannel(sample);
  const output = { ...pixel };

  if (dominant === 'g' && output.g > Math.max(output.r, output.b)) {
    output.g -= (output.g - Math.max(output.r, output.b)) * reductionFactor;
  }

  if (dominant === 'r' && output.r > Math.max(output.g, output.b)) {
    output.r -= (output.r - Math.max(output.g, output.b)) * reductionFactor;
  }

  if (dominant === 'b' && output.b > Math.max(output.r, output.g)) {
    output.b -= (output.b - Math.max(output.r, output.g)) * reductionFactor;
  }

  return {
    r: clamp(Math.round(output.r), 0, 255),
    g: clamp(Math.round(output.g), 0, 255),
    b: clamp(Math.round(output.b), 0, 255),
  };
}

export function sampleCanvasColor(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
): ColorSample {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('无法读取参考帧像素数据。');
  }

  const clampedX = clamp(Math.round(x), 0, canvas.width - 1);
  const clampedY = clamp(Math.round(y), 0, canvas.height - 1);
  const sampleRadius = Math.max(0, Math.round(radius));
  const startX = clamp(clampedX - sampleRadius, 0, canvas.width - 1);
  const startY = clamp(clampedY - sampleRadius, 0, canvas.height - 1);
  const endX = clamp(clampedX + sampleRadius, 0, canvas.width - 1);
  const endY = clamp(clampedY + sampleRadius, 0, canvas.height - 1);
  const width = endX - startX + 1;
  const height = endY - startY + 1;
  const imageData = context.getImageData(startX, startY, width, height).data;

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let samples = 0;

  for (let index = 0; index < imageData.length; index += 4) {
    totalR += imageData[index];
    totalG += imageData[index + 1];
    totalB += imageData[index + 2];
    samples += 1;
  }

  const rgb = {
    r: Math.round(totalR / Math.max(samples, 1)),
    g: Math.round(totalG / Math.max(samples, 1)),
    b: Math.round(totalB / Math.max(samples, 1)),
  };

  return {
    x: clampedX,
    y: clampedY,
    hex: rgbToHex(rgb),
    rgb,
  };
}

export function applyColorKey(
  source: HTMLCanvasElement,
  options: ColorKeyOptions,
  fillHoles = false,
): {
  image: HTMLCanvasElement;
  mask: HTMLCanvasElement;
} {
  const sourceContext = source.getContext('2d');
  if (!sourceContext) {
    throw new Error('无法读取原始帧图像。');
  }

  const w = source.width;
  const h = source.height;
  const sourceImageData = sourceContext.getImageData(0, 0, w, h);
  const sourcePixels = sourceImageData.data;
  const outputCanvas = createCanvas(w, h);
  const maskCanvas = createCanvas(w, h);
  const outputContext = outputCanvas.getContext('2d');
  const maskContext = maskCanvas.getContext('2d');

  if (!outputContext || !maskContext) {
    throw new Error('无法创建抠像预览画布。');
  }

  const outputImageData = outputContext.createImageData(w, h);
  const maskImageData = maskContext.createImageData(w, h);
  const outputPixels = outputImageData.data;
  const maskPixels = maskImageData.data;

  for (let index = 0; index < sourcePixels.length; index += 4) {
    const pixel = {
      r: sourcePixels[index],
      g: sourcePixels[index + 1],
      b: sourcePixels[index + 2],
    };

    const distance = computeColorDistance(pixel, options.sample.rgb, options.algorithm);
    const opacity = getOpacityForDistance(
      distance,
      options.tolerance,
      options.softness,
      options.algorithm,
      options.smoothing,
    );
    const edgeWeight =
      options.edgeRadius <= 0
        ? 1
        : clamp((options.tolerance + options.edgeRadius - distance) / options.edgeRadius, 0, 1);
    const adjustedPixel =
      options.despillEnabled && options.despill > 0
        ? applyDespill(pixel, options.sample.rgb, opacity, options.despill * edgeWeight)
        : pixel;
    const alpha = Math.round(opacity * 255);

    outputPixels[index] = adjustedPixel.r;
    outputPixels[index + 1] = adjustedPixel.g;
    outputPixels[index + 2] = adjustedPixel.b;
    outputPixels[index + 3] = alpha;

    maskPixels[index] = alpha;
    maskPixels[index + 1] = alpha;
    maskPixels[index + 2] = alpha;
    maskPixels[index + 3] = 255;
  }

  if (fillHoles) {
    const pixelCount = w * h;
    const alpha = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) alpha[i] = outputPixels[i * 4 + 3];

    fillSilhouette(alpha, w, h);

    for (let i = 0; i < pixelCount; i++) {
      const v = alpha[i];
      const di = i * 4;
      if (v > outputPixels[di + 3]) {
        outputPixels[di] = sourcePixels[di];
        outputPixels[di + 1] = sourcePixels[di + 1];
        outputPixels[di + 2] = sourcePixels[di + 2];
      }
      outputPixels[di + 3] = v;
      maskPixels[di] = v;
      maskPixels[di + 1] = v;
      maskPixels[di + 2] = v;
    }
  }

  outputContext.putImageData(outputImageData, 0, 0);
  maskContext.putImageData(maskImageData, 0, 0);

  return {
    image: outputCanvas,
    mask: maskCanvas,
  };
}

export function processExtractedFrame(
  frame: ExtractedFrame,
  options: ColorKeyOptions,
  fillHoles = false,
): ProcessedFrame {
  const processed = applyColorKey(frame.image, options, fillHoles);

  return {
    ...frame,
    processedImage: processed.image,
    maskImage: processed.mask,
  };
}

/**
 * BFS flood-fill from border through transparent pixels (alpha < 16).
 * Interior pixels not reachable from the border are filled to 255.
 * Boundary pixels (8-adjacent to background) keep their original alpha.
 */
function fillSilhouette(alpha: Uint8Array, w: number, h: number): void {
  const total = w * h;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const BG_THRESHOLD = 16;

  const seed = (idx: number) => {
    if (alpha[idx] < BG_THRESHOLD && !visited[idx]) {
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
    ) continue;
    alpha[i] = 255;
  }
}
