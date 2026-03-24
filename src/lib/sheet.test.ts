import { describe, expect, it } from 'vitest';
import { getLayoutMetrics } from './sheet';
import type { SheetOptions, VideoMeta } from '../types';

const meta: VideoMeta = {
  duration: 12,
  width: 1920,
  height: 1080,
  name: 'sample.mp4',
};

const options: SheetOptions = {
  columns: 4,
  gap: 8,
  backgroundColor: '#ffffff',
};

describe('getLayoutMetrics', () => {
  it('calculates sheet size without timestamps', () => {
    expect(getLayoutMetrics(meta, 12, options, false)).toEqual({
      rows: 3,
      canvasWidth: 1320,
      canvasHeight: 632,
      frameWidth: 320,
      frameHeight: 180,
      labelBlockHeight: 0,
    });
  });

  it('adds extra height when timestamps are enabled', () => {
    expect(getLayoutMetrics(meta, 12, options, true)).toEqual({
      rows: 3,
      canvasWidth: 1320,
      canvasHeight: 722,
      frameWidth: 320,
      frameHeight: 180,
      labelBlockHeight: 30,
    });
  });
});
