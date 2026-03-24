import { describe, expect, it } from 'vitest';
import {
  applyDespill,
  computeColorDistance,
  getOpacityForDistance,
} from './chromaKey';

describe('chroma key helpers', () => {
  it('treats the sampled color as transparent', () => {
    const distance = computeColorDistance(
      { r: 200, g: 192, b: 231 },
      { r: 200, g: 192, b: 231 },
      'enhanced',
    );

    expect(getOpacityForDistance(distance, 20, 10, 'enhanced', true)).toBe(0);
  });

  it('keeps distant colors opaque', () => {
    const distance = computeColorDistance(
      { r: 24, g: 28, b: 40 },
      { r: 200, g: 192, b: 231 },
      'classic',
    );

    expect(getOpacityForDistance(distance, 20, 10, 'classic', true)).toBe(1);
  });

  it('softness creates a smooth transition on the edge', () => {
    expect(getOpacityForDistance(25, 20, 20, 'enhanced', true)).toBeGreaterThan(0);
    expect(getOpacityForDistance(25, 20, 20, 'enhanced', true)).toBeLessThan(1);
  });

  it('despill reduces the dominant background channel near transparent edges', () => {
    const adjusted = applyDespill(
      { r: 70, g: 180, b: 75 },
      { r: 90, g: 220, b: 80 },
      0.35,
      80,
    );

    expect(adjusted.g).toBeLessThan(180);
  });
});
