import { describe, expect, it, vi } from 'vitest';

import {
  browserLeftInset,
  browserRightInset,
  clampResizedLeftPaneWidth,
  clampResizedRightPaneWidth,
  DEFAULT_LEFT_PANE_WIDTH,
  DEFAULT_RIGHT_PANE_WIDTH,
  loadLeftPaneWidth,
  MAX_RIGHT_PANE_WIDTH,
  normalizeLeftPaneWidth,
  normalizeRightPaneWidth,
  PANE_BROWSER_GUTTER,
  saveLeftPaneWidth,
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

  it('lets the pad grow to its max without being clipped by the prior 520px inset ceiling', () => {
    expect(browserRightInset(MAX_RIGHT_PANE_WIDTH)).toBeGreaterThan(520);
    expect(clampResizedRightPaneWidth(900, 1600, DEFAULT_LEFT_PANE_WIDTH, true)).toBe(MAX_RIGHT_PANE_WIDTH);
  });
});
