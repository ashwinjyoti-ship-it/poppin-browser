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
export const MAX_RIGHT_PANE_WIDTH = 560;
export const COLLAPSED_RAIL_WIDTH = 34;

const MIN_BROWSER_WIDTH = 320;
const FIXED_HORIZONTAL_SPACE = 52;
const LEFT_PANE_WIDTH_STORAGE_KEY = 'poppin:pane-width:v2';
const RIGHT_PANE_WIDTH_STORAGE_KEY = 'poppin:pad-width:v1';

export function normalizeLeftPaneWidth(width: number, viewportWidth: number): number {
  const { minimum, maximum } = getLeftPaneWidthRange(viewportWidth);
  return clamp(width, minimum, maximum);
}

export function normalizeRightPaneWidth(width: number, viewportWidth: number, leftPaneWidth = DEFAULT_LEFT_PANE_WIDTH): number {
  const { minimum, maximum } = getRightPaneWidthRange(viewportWidth, leftPaneWidth);
  return clamp(width, minimum, maximum);
}

export function getLeftPaneWidthRange(viewportWidth: number): { minimum: number; maximum: number } {
  const available = Math.round(viewportWidth) - FIXED_HORIZONTAL_SPACE - MIN_BROWSER_WIDTH - MIN_RIGHT_PANE_WIDTH;
  return {
    minimum: MIN_LEFT_PANE_WIDTH,
    maximum: Math.max(MIN_LEFT_PANE_WIDTH, Math.min(MAX_LEFT_PANE_WIDTH, available)),
  };
}

export function getRightPaneWidthRange(viewportWidth: number, leftPaneWidth = DEFAULT_LEFT_PANE_WIDTH): { minimum: number; maximum: number } {
  const available = Math.round(viewportWidth) - FIXED_HORIZONTAL_SPACE - MIN_BROWSER_WIDTH - leftPaneWidth;
  return {
    minimum: MIN_RIGHT_PANE_WIDTH,
    maximum: Math.max(MIN_RIGHT_PANE_WIDTH, Math.min(MAX_RIGHT_PANE_WIDTH, available)),
  };
}

export function getFocusedRightPaneWidth(viewportWidth: number, leftPaneWidth: number, workspaceCollapsed: boolean): number {
  const left = workspaceCollapsed ? COLLAPSED_RAIL_WIDTH + 18 : leftPaneWidth + 14;
  return Math.max(MIN_RIGHT_PANE_WIDTH, Math.round(viewportWidth) - left - MIN_BROWSER_WIDTH - 24);
}

export function clampResizedLeftPaneWidth(requestedWidth: number, viewportWidth: number): number {
  const { minimum, maximum } = getLeftPaneWidthRange(viewportWidth);
  return clamp(requestedWidth, minimum, maximum);
}

export function clampResizedRightPaneWidth(requestedWidth: number, viewportWidth: number, leftPaneWidth = DEFAULT_LEFT_PANE_WIDTH): number {
  const { minimum, maximum } = getRightPaneWidthRange(viewportWidth, leftPaneWidth);
  return clamp(requestedWidth, minimum, maximum);
}

export function loadLeftPaneWidth(storage: StorageReader): number {
  return loadStoredWidth(storage, LEFT_PANE_WIDTH_STORAGE_KEY, DEFAULT_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH, MAX_LEFT_PANE_WIDTH);
}

export function loadRightPaneWidth(storage: StorageReader): number {
  return loadStoredWidth(storage, RIGHT_PANE_WIDTH_STORAGE_KEY, DEFAULT_RIGHT_PANE_WIDTH, MIN_RIGHT_PANE_WIDTH, MAX_RIGHT_PANE_WIDTH);
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
