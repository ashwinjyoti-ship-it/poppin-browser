import { describe, expect, it } from 'vitest';

import type { WindowState } from '../src/shared/browser';
import { clampWindowState, DEFAULT_WINDOW_STATE, isWindowState } from '../src/main/browser/window-state';

const DISPLAY = { x: 0, y: 0, width: 1440, height: 900 };

describe('window state', () => {
  it('recognizes a valid state', () => {
    expect(isWindowState(DEFAULT_WINDOW_STATE)).toBe(true);
    expect(isWindowState({ ...DEFAULT_WINDOW_STATE, width: 200 })).toBe(false);
  });

  it('clamps an off-screen state onto the available display', () => {
    const state: WindowState = {
      x: 4000,
      y: 3000,
      width: 1200,
      height: 800,
      isMaximized: false,
      isFullScreen: false,
    };
    expect(clampWindowState(state, [DISPLAY])).toEqual({ ...state, x: 240, y: 100 });
  });

  it('caps oversized windows without losing state flags', () => {
    expect(
      clampWindowState(
        { ...DEFAULT_WINDOW_STATE, width: 3000, height: 2000, isMaximized: true },
        [DISPLAY],
      ),
    ).toMatchObject({ width: 1440, height: 900, isMaximized: true });
  });
});
