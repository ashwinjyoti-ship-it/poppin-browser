export type ChromeDensity = 'roomy' | 'compact' | 'dense';

export interface ChromeLayout {
  density: ChromeDensity;
  height: number;
}

const CHROME_LAYOUTS: Record<ChromeDensity, ChromeLayout> = {
  roomy: { density: 'roomy', height: 103 },
  compact: { density: 'compact', height: 86 },
  dense: { density: 'dense', height: 76 },
};

/** Extra chrome height so the tab-search form can sit above the tab strip without clipping it. */
export const TAB_SEARCH_CHROME_EXTRA = 48;
/** Pushes the native BrowserView down so open-tab search results can paint above it. */
export const TAB_SEARCH_RESULTS_INSET = 200;

export function getChromeLayout(viewportWidth: number, viewportHeight: number): ChromeLayout {
  if (viewportWidth <= 980 || viewportHeight <= 720) return CHROME_LAYOUTS.dense;
  if (viewportWidth <= 1440 || viewportHeight <= 980) return CHROME_LAYOUTS.compact;
  return CHROME_LAYOUTS.roomy;
}

export function resolveChromeHeight(layout: ChromeLayout, tabSearchOpen: boolean): number {
  return layout.height + (tabSearchOpen ? TAB_SEARCH_CHROME_EXTRA : 0);
}

export function getTitlebarLeftInset(density: ChromeDensity, isFullScreen: boolean): number {
  if (isFullScreen) return density === 'roomy' ? 16 : 12;
  if (density === 'roomy') return 82;
  if (density === 'compact') return 80;
  return 76;
}
