import type { BrowserEnteredUrl, BrowserHistoryEntry, BrowserTabSnapshot } from '../../shared/browser';

const INTERNAL_PREFIXES = ['poppin://', 'about:', 'chrome://', 'devtools://'];

export interface UrlSuggestion {
  url: string;
  title: string;
  source: 'entered';
}

/**
 * Suggest URLs the user previously entered in the address bar this session.
 * Matches typed prefixes against titles, full URLs, and hostnames (e.g. `you` → YouTube).
 */
export function suggestEnteredUrls(
  query: string,
  enteredUrls: BrowserEnteredUrl[],
  limit = 8,
): UrlSuggestion[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const seen = new Set<string>();
  const results: UrlSuggestion[] = [];

  for (const entry of enteredUrls) {
    if (!entry.url || INTERNAL_PREFIXES.some((prefix) => entry.url.startsWith(prefix))) continue;
    const key = entry.url.toLowerCase();
    if (seen.has(key)) continue;
    if (!matchesEnteredQuery(normalized, entry.url, entry.title)) continue;
    seen.add(key);
    results.push({ url: entry.url, title: entry.title || entry.url, source: 'entered' });
    if (results.length >= limit) return results;
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

function matchesEnteredQuery(query: string, url: string, title: string): boolean {
  const q = query.toLowerCase();
  if (title.toLowerCase().startsWith(q)) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./u, '').toLowerCase();
    const domain = host.split('.')[0] ?? host;
    if (domain.startsWith(q)) return true;
    if (q.length >= 3 && (domain.includes(q) || host.includes(q))) return true;
  } catch {
    // ignore malformed URLs
  }
  return false;
}
