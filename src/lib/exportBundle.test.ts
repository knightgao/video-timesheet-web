import { describe, expect, it } from 'vitest';
import {
  getBaseFileName,
  getFrameFileName,
  getSheetFileName,
  getZipFileName,
} from './exportBundle';

describe('export bundle helpers', () => {
  it('sanitizes the base file name', () => {
    expect(getBaseFileName('my video test.mp4')).toBe('my-video-test');
  });

  it('creates a transparent sheet file name', () => {
    expect(getSheetFileName('demo clip.mov', true)).toBe('demo-clip-transparent-timesheet.png');
  });

  it('creates a frame file name with index and timestamp', () => {
    expect(getFrameFileName('demo clip.mov', 2, 3.4)).toBe('demo-clip-frame-003-00-03-400.png');
  });

  it('creates the zip file name', () => {
    expect(getZipFileName('demo clip.mov')).toBe('demo-clip-frames.zip');
  });
});
