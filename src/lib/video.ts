import type { ExtractedFrame, ExtractionOptions, VideoMeta } from '../types';
import { formatTimestamp } from './time';

type VideoAsset = {
  url: string;
  meta: VideoMeta;
};

function waitForEvent<T extends keyof HTMLMediaElementEventMap>(
  target: HTMLVideoElement,
  event: T,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      target.removeEventListener(event, onSuccess);
      target.removeEventListener('error', onError);
    };

    const onSuccess = (): void => {
      cleanup();
      resolve();
    };

    const onError = (): void => {
      cleanup();
      reject(new Error('视频读取失败，请检查文件是否可被当前浏览器解码。'));
    };

    target.addEventListener(event, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

export async function loadVideoAsset(file: File): Promise<VideoAsset> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitForEvent(video, 'loadedmetadata');
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  const duration = video.duration;

  if (!width || !height || !duration || !Number.isFinite(duration)) {
    URL.revokeObjectURL(url);
    throw new Error('无法读取视频元数据，请换一个常见编码的 MP4 文件后重试。');
  }

  return {
    url,
    meta: {
      duration,
      width,
      height,
      name: file.name,
    },
  };
}

export function revokeVideoAsset(url: string): void {
  URL.revokeObjectURL(url);
}

export function getSampleTimes(duration: number, frameCount: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || frameCount <= 0) {
    return [];
  }

  if (frameCount === 1) {
    return [duration / 2];
  }

  const margin = Math.min(0.2, duration * 0.05);
  const start = Math.min(margin, duration / 2);
  const end = Math.max(start, duration - margin);

  if (end <= start) {
    return Array.from({ length: frameCount }, () => duration / 2);
  }

  const step = (end - start) / (frameCount - 1);
  return Array.from({ length: frameCount }, (_, index) => {
    const next = start + step * index;
    return Number(Math.min(duration, Math.max(0, next)).toFixed(3));
  });
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001) {
    return;
  }

  const promise = waitForEvent(video, 'seeked');
  video.currentTime = time;
  await promise;
}

function drawFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('当前浏览器无法创建 Canvas 绘图上下文。');
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function extractFrames(
  videoUrl: string,
  meta: VideoMeta,
  options: ExtractionOptions,
): Promise<ExtractedFrame[]> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = videoUrl;

  await waitForEvent(video, 'loadeddata');

  const sampleTimes = getSampleTimes(meta.duration, options.frameCount);
  const frames: ExtractedFrame[] = [];

  for (const time of sampleTimes) {
    await seekTo(video, time);
    frames.push({
      image: drawFrame(video),
      time,
      label: options.includeTimestamps ? formatTimestamp(time) : '',
    });
  }

  return frames;
}
