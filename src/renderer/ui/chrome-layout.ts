export type ChromeDensity = 'roomy' | 'compact' | 'dense';

export interface ChromeLayout {
  density: ChromeDensity;
  height: number;
}

const CHROME_LAYOUTS: Record<ChromeDensity, ChromeLayout> = {
  roomy: { density: 'roomy', height: 152 },
  compact: { density: 'compact', height: 124 },
  dense: { density: 'dense', height: 108 },
};

export function getChromeLayout(viewportWidth: number, viewportHeight: number): ChromeLayout {
  if (viewportWidth <= 980 || viewportHeight <= 720) return CHROME_LAYOUTS.dense;
  if (viewportWidth <= 1440 || viewportHeight <= 980) return CHROME_LAYOUTS.compact;
  return CHROME_LAYOUTS.roomy;
}
