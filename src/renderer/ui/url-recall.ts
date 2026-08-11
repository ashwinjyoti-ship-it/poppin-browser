import type { BrowserHistoryEntry, BrowserTabSnapshot } from '../../shared/browser';

const INTERNAL_PREFIXES = ['poppin://', 'about:', 'chrome://', 'devtools://'];

export interface UrlSuggestion {
  url: string;
  title: string;
  source: 'history' | 'tab';
}

/**
 * Suggest URLs already visited in this Poppin session (tab history + open tabs)
 * while the user types in the address bar.
 */
export function suggestSessionUrls(
  query: string,
  activeTab: BrowserTabSnapshot | null,
  tabs: BrowserTabSnapshot[],
  limit = 8,
): UrlSuggestion[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const seen = new Set<string>();
  const results: UrlSuggestion[] = [];

  const consider = (url: string, title: string, source: UrlSuggestion['source']) => {
    if (!url || INTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix))) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    const haystack = `${title} ${url}`.toLowerCase();
    if (!haystack.includes(normalized)) return;
    seen.add(key);
    results.push({ url, title: title || url, source });
  };

  for (const entry of activeTab?.history ?? []) {
    consider(entry.url, entry.title, 'history');
    if (results.length >= limit) return results;
  }

  for (const tab of tabs) {
    consider(tab.url, tab.title, 'tab');
    for (const entry of tab.history) {
      consider(entry.url, entry.title, 'history');
      if (results.length >= limit) return results;
    }
  }

  return results;
}

/** Previous sites in this tab's session (newest first), for the back-history menu. */
export function previousHistoryEntries(tab: BrowserTabSnapshot | null): BrowserHistoryEntry[] {
  if (!tab?.history.length) return [];
  return tab.history
    .filter((entry) => entry.index < tab.historyIndex)
    .slice()
    .reverse();
}
