export type PaneSide = 'left';

interface StorageReader {
  getItem: (key: string) => string | null;
}

interface StorageWriter {
  setItem: (key: string, value: string) => void;
}

export const DEFAULT_LEFT_PANE_WIDTH = 286;
export const MIN_LEFT_PANE_WIDTH = 240;
export const MAX_LEFT_PANE_WIDTH = 480;

const MIN_BROWSER_WIDTH = 320;
const FIXED_HORIZONTAL_SPACE = 52;
const PANE_WIDTH_STORAGE_KEY = 'poppin:pane-width:v2';

export function normalizeLeftPaneWidth(width: number, viewportWidth: number): number {
  const { minimum, maximum } = getLeftPaneWidthRange(viewportWidth);
  return clamp(width, minimum, maximum);
}

export function getLeftPaneWidthRange(viewportWidth: number): { minimum: number; maximum: number } {
  const available = Math.round(viewportWidth) - FIXED_HORIZONTAL_SPACE - MIN_BROWSER_WIDTH;
  return {
    minimum: MIN_LEFT_PANE_WIDTH,
    maximum: Math.max(MIN_LEFT_PANE_WIDTH, Math.min(MAX_LEFT_PANE_WIDTH, available)),
  };
}

export function clampResizedLeftPaneWidth(requestedWidth: number, viewportWidth: number): number {
  const { minimum, maximum } = getLeftPaneWidthRange(viewportWidth);
  return clamp(requestedWidth, minimum, maximum);
}

export function loadLeftPaneWidth(storage: StorageReader): number {
  try {
    const stored = storage.getItem(PANE_WIDTH_STORAGE_KEY);
    if (!stored) return DEFAULT_LEFT_PANE_WIDTH;
    const candidate = JSON.parse(stored) as unknown;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return DEFAULT_LEFT_PANE_WIDTH;
    return clamp(candidate, MIN_LEFT_PANE_WIDTH, MAX_LEFT_PANE_WIDTH);
  } catch {
    return DEFAULT_LEFT_PANE_WIDTH;
  }
}

export function saveLeftPaneWidth(storage: StorageWriter, width: number): void {
  try {
    storage.setItem(PANE_WIDTH_STORAGE_KEY, JSON.stringify(width));
  } catch {
    // Layout persistence is a convenience. Resizing must still work if storage is unavailable.
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
