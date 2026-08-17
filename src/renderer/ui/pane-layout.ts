export type PaneSide = 'left' | 'right';

interface StorageReader {
  getItem: (key: string) => string | null;
}

interface StorageWriter {
  setItem: (key: string, value: string) => void;
}

export const DEFAULT_LEFT_PANE_WIDTH = 286;
export const MIN_LEFT_PANE_WIDTH = 240;
export const MAX_LEFT_PANE_WIDTH = 480;

export const DEFAULT_RIGHT_PANE_WIDTH = 320;
export const MIN_RIGHT_PANE_WIDTH = 240;
/** Classic pad ceiling on laptop-sized windows; larger displays grow past this. */
export const MAX_RIGHT_PANE_WIDTH = 560;
/** Absolute pad ceiling so ultra-wide windows do not swallow the browser. */
export const MAX_RIGHT_PANE_WIDTH_CEILING = 1100;
/** Window width at which the pad max starts scaling above {@link MAX_RIGHT_PANE_WIDTH}. */
const PAD_MAX_SCALE_VIEWPORT = 1600;
/** Extra pad pixels unlocked per pixel of viewport above {@link PAD_MAX_SCALE_VIEWPORT}. */
const PAD_MAX_SCALE_FACTOR = 0.5;
export const COLLAPSED_RAIL_WIDTH = 34;
/** Gap between the native browser edge and the Poppin Pad (keeps the resizer clickable). */
export const PANE_BROWSER_GUTTER = 18;

const MIN_BROWSER_WIDTH = 320;
const FIXED_HORIZONTAL_SPACE = 52;
const LEFT_PANE_WIDTH_STORAGE_KEY = 'poppin:pane-width:v2';
const RIGHT_PANE_WIDTH_STORAGE_KEY = 'poppin:pad-width:v1';

/**
 * Screen-aware expand limit for Poppin Pad.
 * Holds 560px through ~1600px windows, then grows with the display up to the ceiling.
 */
export function getMaxRightPaneWidth(viewportWidth: number): number {
  const width = Math.round(viewportWidth);
  if (!Number.isFinite(width) || width <= 0) return MAX_RIGHT_PANE_WIDTH;
  const scaled = Math.round(MAX_RIGHT_PANE_WIDTH + Math.max(0, width - PAD_MAX_SCALE_VIEWPORT) * PAD_MAX_SCALE_FACTOR);
  return Math.min(MAX_RIGHT_PANE_WIDTH_CEILING, Math.max(MAX_RIGHT_PANE_WIDTH, scaled));
}

export function normalizeLeftPaneWidth(width: number, viewportWidth: number): number {
  const { minimum, maximum } = getLeftPaneWidthRange(viewportWidth);
  return clamp(width, minimum, maximum);
}

export function normalizeRightPaneWidth(
  width: number,
  viewportWidth: number,
  leftPaneWidth = DEFAULT_LEFT_PANE_WIDTH,
  workspaceCollapsed = false,
): number {
  const { minimum, maximum } = getRightPaneWidthRange(viewportWidth, leftPaneWidth, workspaceCollapsed);
  return clamp(width, minimum, maximum);
}

export function getLeftPaneWidthRange(viewportWidth: number): { minimum: number; maximum: number } {
  const available = Math.round(viewportWidth) - FIXED_HORIZONTAL_SPACE - MIN_BROWSER_WIDTH - MIN_RIGHT_PANE_WIDTH;
  return {
    minimum: MIN_LEFT_PANE_WIDTH,
    maximum: Math.max(MIN_LEFT_PANE_WIDTH, Math.min(MAX_LEFT_PANE_WIDTH, available)),
  };
}

export function getRightPaneWidthRange(
  viewportWidth: number,
  leftPaneWidth = DEFAULT_LEFT_PANE_WIDTH,
  workspaceCollapsed = false,
): { minimum: number; maximum: number } {
  const leftFootprint = workspaceCollapsed ? COLLAPSED_RAIL_WIDTH + 18 : leftPaneWidth;
  const available = Math.round(viewportWidth) - FIXED_HORIZONTAL_SPACE - MIN_BROWSER_WIDTH - leftFootprint;
  const screenMax = getMaxRightPaneWidth(viewportWidth);
  return {
    minimum: MIN_RIGHT_PANE_WIDTH,
    maximum: Math.max(MIN_RIGHT_PANE_WIDTH, Math.min(screenMax, available)),
  };
}

export function getFocusedRightPaneWidth(viewportWidth: number, leftPaneWidth: number, workspaceCollapsed: boolean): number {
  const left = workspaceCollapsed ? COLLAPSED_RAIL_WIDTH + 18 : leftPaneWidth + 14;
  // Focus may grow past the drag-resize ceiling so the pad can use leftover window space.
  return Math.max(MIN_RIGHT_PANE_WIDTH, Math.round(viewportWidth) - left - MIN_BROWSER_WIDTH - 24);
}

/** Native BrowserView right inset so the view stops before the pad + resize gutter. */
export function browserRightInset(padWidth: number, downloadsOpen = false): number {
  return Math.max(downloadsOpen ? 400 : 24, padWidth + PANE_BROWSER_GUTTER);
}

/** Native BrowserView left inset so the view starts after the context pane + gutter. */
export function browserLeftInset(leftPaneWidth: number, workspaceCollapsed: boolean): number {
  return workspaceCollapsed ? COLLAPSED_RAIL_WIDTH + 12 : leftPaneWidth + PANE_BROWSER_GUTTER;
}

export const EXPANDED_COMMAND_BAR_HEIGHT = 94;

/** Native BrowserView bottom inset. A collapsed command bar lives in top chrome. */
export function browserBottomInset(options: {
  commandCollapsed: boolean;
  commandOverlayHeight: number;
  agentDockHeight: number;
}): number {
  if (options.commandCollapsed) return Math.max(0, options.agentDockHeight);
  return EXPANDED_COMMAND_BAR_HEIGHT + options.commandOverlayHeight + options.agentDockHeight;
}

export function clampResizedLeftPaneWidth(requestedWidth: number, viewportWidth: number): number {
  const { minimum, maximum } = getLeftPaneWidthRange(viewportWidth);
  return clamp(requestedWidth, minimum, maximum);
}

export function clampResizedRightPaneWidth(
  requestedWidth: number,
  viewportWidth: number,
  leftPaneWidth = DEFAULT_LEFT_PANE_WIDTH,
  workspaceCollapsed = false,
): number {
  const { minimum, maximum } = getRightPaneWidthRange(viewportWidth, leftPaneWidth, workspaceCollapsed);
  return clamp(requestedWidth, minimum, maximum);
}

export function loadLeftPaneWidth(storage: StorageReader): number {
  return loadStoredWidth(storage, LEFT_PANE_WIDTH_STORAGE_KEY, DEFAULT_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH, MAX_LEFT_PANE_WIDTH);
}

export function loadRightPaneWidth(storage: StorageReader): number {
  // Persist up to the absolute ceiling; live normalize clamps to the current screen max.
  return loadStoredWidth(storage, RIGHT_PANE_WIDTH_STORAGE_KEY, DEFAULT_RIGHT_PANE_WIDTH, MIN_RIGHT_PANE_WIDTH, MAX_RIGHT_PANE_WIDTH_CEILING);
}

export function saveLeftPaneWidth(storage: StorageWriter, width: number): void {
  saveStoredWidth(storage, LEFT_PANE_WIDTH_STORAGE_KEY, width);
}

export function saveRightPaneWidth(storage: StorageWriter, width: number): void {
  saveStoredWidth(storage, RIGHT_PANE_WIDTH_STORAGE_KEY, width);
}

function loadStoredWidth(storage: StorageReader, key: string, fallback: number, min: number, max: number): number {
  try {
    const stored = storage.getItem(key);
    if (!stored) return fallback;
    const candidate = JSON.parse(stored) as unknown;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return fallback;
    return clamp(candidate, min, max);
  } catch {
    return fallback;
  }
}

function saveStoredWidth(storage: StorageWriter, key: string, width: number): void {
  try {
    storage.setItem(key, JSON.stringify(width));
  } catch {
    // Layout persistence is a convenience. Resizing must still work if storage is unavailable.
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
