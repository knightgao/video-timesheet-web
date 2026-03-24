import type {
  ExtractedFrame,
  LayoutMetrics,
  RenderResult,
  SheetAppearance,
  SheetOptions,
  VideoMeta,
} from '../types';

const MAX_FRAME_WIDTH = 320;
const LABEL_FONT_SIZE = 16;
const LABEL_BLOCK_HEIGHT = 30;
const CARD_PADDING = 10;

export function getLayoutMetrics(
  meta: VideoMeta,
  frameCount: number,
  sheetOptions: SheetOptions,
  includeTimestamps: boolean,
): LayoutMetrics {
  const rows = Math.max(1, Math.ceil(frameCount / sheetOptions.columns));
  const frameWidth = Math.min(MAX_FRAME_WIDTH, meta.width);
  const frameHeight = Math.round((meta.height / meta.width) * frameWidth);
  const labelBlockHeight = includeTimestamps ? LABEL_BLOCK_HEIGHT : 0;
  const cardHeight = frameHeight + labelBlockHeight + CARD_PADDING * 2;
  const canvasWidth =
    sheetOptions.columns * frameWidth + (sheetOptions.columns + 1) * sheetOptions.gap;
  const canvasHeight = rows * cardHeight + (rows + 1) * sheetOptions.gap;

  return {
    rows,
    canvasWidth,
    canvasHeight,
    frameWidth,
    frameHeight,
    labelBlockHeight,
  };
}

export function getSheetAppearance(transparent: boolean): SheetAppearance {
  return transparent
    ? {
        transparentBackground: true,
        showCardBackground: false,
      }
    : {
        transparentBackground: false,
        showCardBackground: true,
      };
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
  context.fill();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('图片导出失败，请稍后再试。'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });
}

export async function renderFrameSheet(
  frames: ExtractedFrame[],
  meta: VideoMeta,
  sheetOptions: SheetOptions,
  includeTimestamps: boolean,
  appearance: SheetAppearance = getSheetAppearance(false),
): Promise<RenderResult> {
  const metrics = getLayoutMetrics(meta, frames.length, sheetOptions, includeTimestamps);
  const canvas = document.createElement('canvas');
  canvas.width = metrics.canvasWidth;
  canvas.height = metrics.canvasHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前浏览器无法创建最终导出画布。');
  }

  if (appearance.transparentBackground) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    context.fillStyle = sheetOptions.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.font = `600 ${LABEL_FONT_SIZE}px "Avenir Next", "PingFang SC", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const cardHeight = metrics.frameHeight + metrics.labelBlockHeight + CARD_PADDING * 2;

  frames.forEach((frame, index) => {
    const column = index % sheetOptions.columns;
    const row = Math.floor(index / sheetOptions.columns);
    const x = sheetOptions.gap + column * (metrics.frameWidth + sheetOptions.gap);
    const y = sheetOptions.gap + row * (cardHeight + sheetOptions.gap);

    if (appearance.showCardBackground) {
      context.fillStyle = 'rgba(16, 24, 40, 0.08)';
      fillRoundedRect(
        context,
        x,
        y,
        metrics.frameWidth,
        metrics.frameHeight + metrics.labelBlockHeight + CARD_PADDING * 2,
        16,
      );
    }

    context.drawImage(
      frame.image,
      x,
      y + CARD_PADDING,
      metrics.frameWidth,
      metrics.frameHeight,
    );

    if (includeTimestamps) {
      context.fillStyle = '#182230';
      context.fillText(
        frame.label,
        x + metrics.frameWidth / 2,
        y + CARD_PADDING + metrics.frameHeight + metrics.labelBlockHeight / 2,
      );
    }
  });

  const blob = await canvasToBlob(canvas);

  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
    outputWidth: canvas.width,
    outputHeight: canvas.height,
  };
}
