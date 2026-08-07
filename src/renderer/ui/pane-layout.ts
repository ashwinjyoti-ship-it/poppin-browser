export type PaneSide = 'left' | 'right';

export interface PaneWidths {
  left: number;
  right: number;
}

interface StorageReader {
  getItem: (key: string) => string | null;
}

interface StorageWriter {
  setItem: (key: string, value: string) => void;
}

export const DEFAULT_PANE_WIDTHS: PaneWidths = { left: 286, right: 316 };
export const MIN_PANE_WIDTHS: PaneWidths = { left: 240, right: 260 };
export const MAX_PANE_WIDTHS: PaneWidths = { left: 480, right: 520 };

const MIN_BROWSER_WIDTH = 320;
const FIXED_HORIZONTAL_SPACE = 52;
const PANE_WIDTHS_STORAGE_KEY = 'poppin:pane-widths:v1';

export function normalizePaneWidths(widths: PaneWidths, viewportWidth: number): PaneWidths {
  let left = clamp(widths.left, MIN_PANE_WIDTHS.left, MAX_PANE_WIDTHS.left);
  let right = clamp(widths.right, MIN_PANE_WIDTHS.right, MAX_PANE_WIDTHS.right);
  const availableForPanes = Math.max(
    MIN_PANE_WIDTHS.left + MIN_PANE_WIDTHS.right,
    Math.round(viewportWidth) - FIXED_HORIZONTAL_SPACE - MIN_BROWSER_WIDTH,
  );
  const overflow = left + right - availableForPanes;

  if (overflow > 0) {
    const leftCapacity = left - MIN_PANE_WIDTHS.left;
    const rightCapacity = right - MIN_PANE_WIDTHS.right;
    const capacity = leftCapacity + rightCapacity;
    const leftReduction = capacity > 0
      ? Math.min(leftCapacity, Math.round(overflow * (leftCapacity / capacity)))
      : 0;
    left -= leftReduction;
    right -= Math.min(rightCapacity, overflow - leftReduction);
  }

  return { left, right };
}

export function getPaneWidthRange(side: PaneSide, viewportWidth: number, otherPaneWidth: number) {
  const minimum = MIN_PANE_WIDTHS[side];
  const available = Math.round(viewportWidth) - FIXED_HORIZONTAL_SPACE - MIN_BROWSER_WIDTH - otherPaneWidth;
  return {
    minimum,
    maximum: Math.max(minimum, Math.min(MAX_PANE_WIDTHS[side], available)),
  };
}

export function clampResizedPaneWidth(
  side: PaneSide,
  requestedWidth: number,
  viewportWidth: number,
  otherPaneWidth: number,
): number {
  const { minimum, maximum } = getPaneWidthRange(side, viewportWidth, otherPaneWidth);
  return clamp(requestedWidth, minimum, maximum);
}

export function loadPaneWidths(storage: StorageReader): PaneWidths {
  try {
    const stored = storage.getItem(PANE_WIDTHS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_PANE_WIDTHS };
    const candidate = JSON.parse(stored) as Partial<PaneWidths>;
    if (!Number.isFinite(candidate.left) || !Number.isFinite(candidate.right)) {
      return { ...DEFAULT_PANE_WIDTHS };
    }
    return {
      left: clamp(candidate.left!, MIN_PANE_WIDTHS.left, MAX_PANE_WIDTHS.left),
      right: clamp(candidate.right!, MIN_PANE_WIDTHS.right, MAX_PANE_WIDTHS.right),
    };
  } catch {
    return { ...DEFAULT_PANE_WIDTHS };
  }
}

export function savePaneWidths(storage: StorageWriter, widths: PaneWidths): void {
  try {
    storage.setItem(PANE_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Layout persistence is a convenience. Resizing must still work if storage is unavailable.
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
