import { describe, expect, it, vi } from 'vitest';

import {
  clampResizedPaneWidth,
  DEFAULT_PANE_WIDTHS,
  loadPaneWidths,
  normalizePaneWidths,
  savePaneWidths,
} from '../src/renderer/ui/pane-layout';

describe('resizable pane layout', () => {
  it('preserves default widths when the browser has enough room', () => {
    expect(normalizePaneWidths(DEFAULT_PANE_WIDTHS, 1440)).toEqual(DEFAULT_PANE_WIDTHS);
  });

  it('shrinks panes together to preserve the central browser on a narrow window', () => {
    const widths = normalizePaneWidths(DEFAULT_PANE_WIDTHS, 900);
    expect(widths.left).toBeGreaterThanOrEqual(240);
    expect(widths.right).toBeGreaterThanOrEqual(260);
    expect(widths.left + widths.right).toBeLessThanOrEqual(528);
  });

  it('clamps a dragged pane against its own limits and the browser minimum', () => {
    expect(clampResizedPaneWidth('left', 100, 1440, 316)).toBe(240);
    expect(clampResizedPaneWidth('left', 900, 1000, 316)).toBe(312);
    expect(clampResizedPaneWidth('right', 900, 1600, 286)).toBe(520);
  });

  it('loads only finite widths and falls back safely for corrupt storage', () => {
    expect(loadPaneWidths({ getItem: () => '{bad json' })).toEqual(DEFAULT_PANE_WIDTHS);
    expect(loadPaneWidths({ getItem: () => JSON.stringify({ left: 320, right: 410 }) })).toEqual({ left: 320, right: 410 });
    expect(loadPaneWidths({ getItem: () => JSON.stringify({ left: 'wide', right: 410 }) })).toEqual(DEFAULT_PANE_WIDTHS);
  });

  it('persists both preferred widths without making storage mandatory', () => {
    const setItem = vi.fn();
    savePaneWidths({ setItem }, { left: 330, right: 370 });
    expect(setItem).toHaveBeenCalledWith('poppin:pane-widths:v1', '{"left":330,"right":370}');
    expect(() => savePaneWidths({ setItem: () => { throw new Error('blocked'); } }, DEFAULT_PANE_WIDTHS)).not.toThrow();
  });
});
