import type { TaskBrowserSourceSnapshot } from './task';

export interface ProvenanceClaim {
  /** Human-readable claim text taken from the markdown link text. */
  claim: string;
  /** The http(s) URL the claim resolves to. */
  url: string;
  /** Optional source title from the matching TaskBrowserSourceSnapshot. */
  sourceTitle?: string;
}

const MARKDOWN_LINK_PATTERN = /(!?)\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu;
const BARE_URL_PATTERN = /https?:\/\/[^\s)<]+/giu;
const HTTP_URL_PATTERN = /^https?:\/\//iu;

/**
 * Extracts provenance claims from a completed result. A claim is any markdown
 * link `[claim text](https://example.com)` in the result, plus any bare http
 * URL that also appears in `sources`. Image links (`!\[...\]`) are ignored,
 * and non-http(s) URLs are skipped. Claims are deduplicated per URL so the UI
 * shows one row per source; the first occurrence wins.
 */
export function extractProvenanceClaims(
  markdown: string,
  sources: readonly TaskBrowserSourceSnapshot[] = [],
): ProvenanceClaim[] {
  if (!markdown) return [];
  const sourceByUrl = new Map<string, TaskBrowserSourceSnapshot>();
  for (const source of sources) sourceByUrl.set(source.url, source);
  const seen = new Map<string, ProvenanceClaim>();

  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const [, image, rawText, rawUrl] = match;
    if (image) continue;
    if (!rawUrl || !HTTP_URL_PATTERN.test(rawUrl)) continue;
    const url = normalizeUrl(rawUrl);
    if (!url || seen.has(url)) continue;
    const claim = collapseWhitespace(rawText ?? '').slice(0, 300)
      || sourceByUrl.get(url)?.title
      || url;
    const known = sourceByUrl.get(url);
    seen.set(url, {
      claim,
      url,
      ...(known ? { sourceTitle: known.title } : {}),
    });
  }

  // Any known source URL that appears as a bare mention (not wrapped in a
  // markdown link) should still surface as provenance so the user can jump.
  for (const bareMatch of markdown.matchAll(BARE_URL_PATTERN)) {
    const url = normalizeUrl(bareMatch[0] ?? '');
    if (!url || seen.has(url)) continue;
    const source = sourceByUrl.get(url);
    if (!source) continue;
    seen.set(url, { claim: source.title, url, sourceTitle: source.title });
  }

  return [...seen.values()];
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.replace(/[),.;]+$/u, ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
