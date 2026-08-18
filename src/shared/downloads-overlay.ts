export const DOWNLOADS_OVERLAY_WIDTH = 360;
export const DOWNLOADS_OVERLAY_MAX_HEIGHT = 420;
export const DOWNLOADS_OVERLAY_TOP = 52;
export const DOWNLOADS_OVERLAY_MARGIN = 18;
export const DOWNLOADS_OVERLAY_MIN_WIDTH = 280;
export const DOWNLOADS_OVERLAY_MIN_HEIGHT = 160;

export interface OverlayParentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Place the downloads panel in the parent window's top-right chrome gap.
 * This is a separate BrowserWindow so it can paint above native WebContentsViews
 * without shrinking the page.
 */
export function downloadsOverlayBounds(parent: OverlayParentBounds): OverlayBounds {
  const width = Math.min(
    DOWNLOADS_OVERLAY_WIDTH,
    Math.max(DOWNLOADS_OVERLAY_MIN_WIDTH, parent.width - DOWNLOADS_OVERLAY_MARGIN * 2),
  );
  const height = Math.min(
    DOWNLOADS_OVERLAY_MAX_HEIGHT,
    Math.max(DOWNLOADS_OVERLAY_MIN_HEIGHT, parent.height - DOWNLOADS_OVERLAY_TOP - DOWNLOADS_OVERLAY_MARGIN),
  );
  return {
    x: parent.x + parent.width - width - DOWNLOADS_OVERLAY_MARGIN,
    y: parent.y + DOWNLOADS_OVERLAY_TOP,
    width,
    height,
  };
}
