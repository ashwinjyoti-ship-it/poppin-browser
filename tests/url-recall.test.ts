import { describe, expect, it } from 'vitest';

import type { BrowserTabSnapshot } from '../src/shared/browser';
import { previousHistoryEntries, suggestSessionUrls } from '../src/renderer/ui/url-recall';

const tab = (overrides: Partial<BrowserTabSnapshot>): BrowserTabSnapshot => ({
  id: 'tab',
  url: 'https://example.com/',
  title: 'Example',
  faviconUrls: [],
  pinned: false,
  groupId: null,
  isLoading: false,
  canGoBack: true,
  canGoForward: false,
  historyIndex: 1,
  history: [
    { index: 0, url: 'https://news.example/', title: 'News' },
    { index: 1, url: 'https://example.com/', title: 'Example' },
  ],
  failure: null,
  ...overrides,
});

describe('url recall', () => {
  it('suggests previously visited session URLs while typing', () => {
    const active = tab({});
    const other = tab({
      id: 'other',
      url: 'https://docs.poppin.test/guide',
      title: 'Poppin Guide',
      historyIndex: 0,
      history: [{ index: 0, url: 'https://docs.poppin.test/guide', title: 'Poppin Guide' }],
    });
    expect(suggestSessionUrls('news', active, [active, other]).map((item) => item.url)).toEqual(['https://news.example/']);
    expect(suggestSessionUrls('poppin', active, [active, other]).map((item) => item.url)).toEqual(['https://docs.poppin.test/guide']);
  });

  it('lists earlier sites for the back-history menu', () => {
    expect(previousHistoryEntries(tab({})).map((entry) => entry.url)).toEqual(['https://news.example/']);
  });
});
