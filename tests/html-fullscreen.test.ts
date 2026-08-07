import { describe, expect, it } from 'vitest';

import { HtmlFullscreenCoordinator } from '../src/main/browser/html-fullscreen';

describe('HTML fullscreen coordination', () => {
  it('repeats an early exit after the asynchronous window enter finishes', () => {
    const fullscreen = new HtmlFullscreenCoordinator();

    expect(fullscreen.enter('video-tab', false)).toEqual({ windowFullscreen: true });
    expect(fullscreen.leave('video-tab')).toEqual({ windowFullscreen: false });
    expect(fullscreen.windowDidEnter()).toEqual({ windowFullscreen: false });
    expect(fullscreen.windowDidLeave()).toBeNull();
    expect(fullscreen.isActiveFor('video-tab')).toBe(false);
  });

  it('does not exit a fullscreen window that the page did not enter', () => {
    const fullscreen = new HtmlFullscreenCoordinator();

    expect(fullscreen.enter('video-tab', true)).toEqual({ windowFullscreen: null });
    expect(fullscreen.leave('video-tab')).toEqual({ windowFullscreen: null });
  });

  it('ends page fullscreen when the user exits the native window first', () => {
    const fullscreen = new HtmlFullscreenCoordinator();

    fullscreen.enter('video-tab', false);
    expect(fullscreen.windowDidLeave()).toBe('video-tab');
    expect(fullscreen.isActiveFor('video-tab')).toBe(false);
  });
});
