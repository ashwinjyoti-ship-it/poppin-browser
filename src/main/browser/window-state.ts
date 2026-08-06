import type { Rectangle } from 'electron';

import type { WindowState } from '../../shared/browser';

export const DEFAULT_WINDOW_STATE: WindowState = {
  x: 80,
  y: 60,
  width: 1440,
  height: 940,
  isMaximized: false,
  isFullScreen: false,
};

export function isWindowState(value: unknown): value is WindowState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WindowState>;
  return (
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.width) &&
    Number.isFinite(candidate.height) &&
    (candidate.width ?? 0) >= 900 &&
    (candidate.height ?? 0) >= 620 &&
    typeof candidate.isMaximized === 'boolean' &&
    typeof candidate.isFullScreen === 'boolean'
  );
}

export function clampWindowState(
  state: WindowState,
  workAreas: Rectangle[],
): WindowState {
  const matchingArea = workAreas.find((area) => intersectsByAtLeast(state, area, 120));
  const area = matchingArea ?? workAreas[0];
  if (!area) return DEFAULT_WINDOW_STATE;

  const width = Math.min(Math.max(state.width, 900), area.width);
  const height = Math.min(Math.max(state.height, 620), area.height);
  const x = Math.min(Math.max(state.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(state.y, area.y), area.y + area.height - height);

  return { ...state, x, y, width, height };
}

function intersectsByAtLeast(state: WindowState, area: Rectangle, minimum: number): boolean {
  const overlapWidth = Math.max(
    0,
    Math.min(state.x + state.width, area.x + area.width) - Math.max(state.x, area.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(state.y + state.height, area.y + area.height) - Math.max(state.y, area.y),
  );
  return overlapWidth >= minimum && overlapHeight >= minimum;
}

