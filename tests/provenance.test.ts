import { describe, expect, it } from 'vitest';

import { extractProvenanceClaims } from '../src/shared/provenance';

describe('extractProvenanceClaims', () => {
  it('returns nothing for empty markdown', () => {
    expect(extractProvenanceClaims('')).toEqual([]);
  });

  it('reads markdown links as claim → url pairs', () => {
    const markdown = 'Fender CD-60S is [available at ₹9,499](https://example.com/fender-cd60s) with fast shipping.';
    expect(extractProvenanceClaims(markdown)).toEqual([
      { claim: 'available at ₹9,499', url: 'https://example.com/fender-cd60s' },
    ]);
  });

  it('ignores non-http(s) links and image references', () => {
    const markdown = 'See ![alt](https://example.com/img.png) or [docs](file:///Users/tester/notes.md).';
    expect(extractProvenanceClaims(markdown)).toEqual([]);
  });

  it('deduplicates by URL, keeping the first claim wording', () => {
    const markdown = 'First [claim A](https://example.com/a) and later [claim A restated](https://example.com/a).';
    expect(extractProvenanceClaims(markdown)).toEqual([
      { claim: 'claim A', url: 'https://example.com/a' },
    ]);
  });

  it('surfaces bare URLs that match known sources so the user still gets provenance', () => {
    const markdown = 'Reviewed the article. Full details at https://example.com/full-article.';
    const claims = extractProvenanceClaims(markdown, [
      { title: 'Full Article', url: 'https://example.com/full-article' },
    ]);
    expect(claims).toEqual([
      { claim: 'Full Article', url: 'https://example.com/full-article', sourceTitle: 'Full Article' },
    ]);
  });

  it('attaches the source title when a markdown link matches a known source', () => {
    const markdown = '[Bajaao listing](https://bajaao.com/fender-cd60s)';
    const claims = extractProvenanceClaims(markdown, [
      { title: 'Bajaao – Fender CD-60S', url: 'https://bajaao.com/fender-cd60s' },
    ]);
    expect(claims).toEqual([
      { claim: 'Bajaao listing', url: 'https://bajaao.com/fender-cd60s', sourceTitle: 'Bajaao – Fender CD-60S' },
    ]);
  });

  it('normalizes trailing punctuation on bare URLs', () => {
    const markdown = 'Check https://example.com/article.';
    const claims = extractProvenanceClaims(markdown, [
      { title: 'Article', url: 'https://example.com/article' },
    ]);
    expect(claims).toEqual([
      { claim: 'Article', url: 'https://example.com/article', sourceTitle: 'Article' },
    ]);
  });
});
