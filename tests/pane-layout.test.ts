import { describe, expect, it, vi } from 'vitest';

import {
  browserBottomInset,
  browserLeftInset,
  browserRightInset,
  clampResizedLeftPaneWidth,
  clampResizedRightPaneWidth,
  COLLAPSED_RAIL_WIDTH,
  DEFAULT_LEFT_PANE_WIDTH,
  DEFAULT_RIGHT_PANE_WIDTH,
  getFocusedRightPaneWidth,
  getMaxRightPaneWidth,
  loadLeftPaneWidth,
  loadRightPaneWidth,
  MAX_RIGHT_PANE_WIDTH,
  MAX_RIGHT_PANE_WIDTH_CEILING,
  normalizeLeftPaneWidth,
  normalizeRightPaneWidth,
  PANE_BROWSER_GUTTER,
  saveLeftPaneWidth,
  saveRightPaneWidth,
} from '../src/renderer/ui/pane-layout';

describe('resizable left pane layout', () => {
  it('preserves the default width when the browser has enough room', () => {
    expect(normalizeLeftPaneWidth(DEFAULT_LEFT_PANE_WIDTH, 1440)).toBe(DEFAULT_LEFT_PANE_WIDTH);
  });

  it('shrinks the pane to preserve the central browser on a narrow window', () => {
    const width = normalizeLeftPaneWidth(DEFAULT_LEFT_PANE_WIDTH, 500);
    expect(width).toBeGreaterThanOrEqual(240);
    expect(width).toBeLessThanOrEqual(DEFAULT_LEFT_PANE_WIDTH);
  });

  it('clamps a dragged pane against its own limits and the browser minimum', () => {
    expect(clampResizedLeftPaneWidth(100, 1440)).toBe(240);
    expect(clampResizedLeftPaneWidth(900, 1000)).toBe(388);
    expect(clampResizedLeftPaneWidth(900, 600)).toBe(240);
  });

  it('loads only a finite width and falls back safely for corrupt storage', () => {
    expect(loadLeftPaneWidth({ getItem: () => '{bad json' })).toBe(DEFAULT_LEFT_PANE_WIDTH);
    expect(loadLeftPaneWidth({ getItem: () => JSON.stringify(320) })).toBe(320);
    expect(loadLeftPaneWidth({ getItem: () => JSON.stringify('wide') })).toBe(DEFAULT_LEFT_PANE_WIDTH);
  });

  it('persists the preferred width without making storage mandatory', () => {
    const setItem = vi.fn();
    saveLeftPaneWidth({ setItem }, 330);
    expect(setItem).toHaveBeenCalledWith('poppin:pane-width:v2', '330');
    expect(() => saveLeftPaneWidth({ setItem: () => { throw new Error('blocked'); } }, DEFAULT_LEFT_PANE_WIDTH)).not.toThrow();
  });
});

describe('resizable Poppin Pad layout', () => {
  it('preserves the default pad width when the browser has enough room', () => {
    expect(normalizeRightPaneWidth(DEFAULT_RIGHT_PANE_WIDTH, 1440, DEFAULT_LEFT_PANE_WIDTH)).toBe(DEFAULT_RIGHT_PANE_WIDTH);
  });

  it('reserves a browser gutter so the resize handle stays outside the native view', () => {
    expect(browserRightInset(DEFAULT_RIGHT_PANE_WIDTH)).toBe(DEFAULT_RIGHT_PANE_WIDTH + PANE_BROWSER_GUTTER);
    expect(browserRightInset(MAX_RIGHT_PANE_WIDTH)).toBe(MAX_RIGHT_PANE_WIDTH + PANE_BROWSER_GUTTER);
    expect(browserLeftInset(DEFAULT_LEFT_PANE_WIDTH, false)).toBe(DEFAULT_LEFT_PANE_WIDTH + PANE_BROWSER_GUTTER);
    expect(browserLeftInset(DEFAULT_LEFT_PANE_WIDTH, true)).toBe(46);
  });

  it('does not steal a 400px page gutter for the downloads panel', () => {
    expect(browserRightInset(COLLAPSED_RAIL_WIDTH)).toBe(COLLAPSED_RAIL_WIDTH + PANE_BROWSER_GUTTER);
    expect(browserRightInset(COLLAPSED_RAIL_WIDTH)).toBeLessThan(80);
  });

  it('lets the pad grow to its max without being clipped by the prior 520px inset ceiling', () => {
    expect(browserRightInset(MAX_RIGHT_PANE_WIDTH)).toBeGreaterThan(520);
    expect(clampResizedRightPaneWidth(900, 1600, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(MAX_RIGHT_PANE_WIDTH);
  });

  it('scales the pad expand limit with larger screens', () => {
    expect(getMaxRightPaneWidth(1440)).toBe(MAX_RIGHT_PANE_WIDTH);
    expect(getMaxRightPaneWidth(1600)).toBe(MAX_RIGHT_PANE_WIDTH);
    expect(getMaxRightPaneWidth(1920)).toBe(720);
    expect(getMaxRightPaneWidth(2560)).toBe(1040);
    expect(getMaxRightPaneWidth(3200)).toBe(MAX_RIGHT_PANE_WIDTH_CEILING);
    expect(clampResizedRightPaneWidth(900, 1920, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(720);
    expect(clampResizedRightPaneWidth(900, 2560, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(900);
    expect(normalizeRightPaneWidth(800, 1920, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(720);
  });

  it('expands focus mode past the drag-resize ceiling into leftover window space', () => {
    expect(getFocusedRightPaneWidth(1920, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(1524);
    expect(getFocusedRightPaneWidth(2560, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(2164);
    expect(getFocusedRightPaneWidth(1280, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(884);
    expect(getFocusedRightPaneWidth(1280, DEFAULT_LEFT_PANE_WIDTH, true)).toBeGreaterThan(MAX_RIGHT_PANE_WIDTH);
  });

  it('loads a wide stored pad width and lets live normalize clamp to the screen', () => {
    expect(loadRightPaneWidth({ getItem: () => JSON.stringify(900) })).toBe(900);
    expect(normalizeRightPaneWidth(900, 1440, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(MAX_RIGHT_PANE_WIDTH);
    const setItem = vi.fn();
    saveRightPaneWidth({ setItem }, 720);
    expect(setItem).toHaveBeenCalledWith('poppin:pad-width:v1', '720');
  });
});

describe('command bar bottom inset', () => {
  it('gives the native viewport the full height when the command bar is collapsed', () => {
    expect(browserBottomInset({ commandCollapsed: true, commandOverlayHeight: 160, agentDockHeight: 0 })).toBe(0);
    expect(browserBottomInset({ commandCollapsed: true, commandOverlayHeight: 0, agentDockHeight: 48 })).toBe(48);
  });

  it('reserves the expanded bar, overlay, and dock together', () => {
    expect(browserBottomInset({ commandCollapsed: false, commandOverlayHeight: 0, agentDockHeight: 0 })).toBe(94);
    expect(browserBottomInset({ commandCollapsed: false, commandOverlayHeight: 40, agentDockHeight: 56 })).toBe(190);
  });
});
