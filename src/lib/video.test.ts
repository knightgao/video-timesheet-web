import { describe, expect, it } from 'vitest';
import { getSampleTimes } from './video';

describe('getSampleTimes', () => {
  it('returns evenly spaced timestamps inside the safe range', () => {
    expect(getSampleTimes(10, 4)).toEqual([0.2, 3.4, 6.6, 9.8]);
  });

  it('returns middle point when frame count is 1', () => {
    expect(getSampleTimes(9, 1)).toEqual([4.5]);
  });

  it('returns empty array when inputs are invalid', () => {
    expect(getSampleTimes(0, 4)).toEqual([]);
    expect(getSampleTimes(10, 0)).toEqual([]);
  });
});

