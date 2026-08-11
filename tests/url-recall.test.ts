import { describe, expect, it } from 'vitest';

import type { BrowserTabSnapshot } from '../src/shared/browser';
import { previousHistoryEntries, suggestEnteredUrls } from '../src/renderer/ui/url-recall';

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
  it('suggests previously entered addresses while typing', () => {
    const entered = [
      { url: 'https://mail.google.com/', title: 'Gmail' },
      { url: 'https://www.youtube.com/', title: 'YouTube' },
      { url: 'https://outlook.live.com/', title: 'Outlook' },
    ];
    expect(suggestEnteredUrls('gm', entered).map((item) => item.url)).toEqual(['https://mail.google.com/']);
    expect(suggestEnteredUrls('you', entered).map((item) => item.url)).toEqual(['https://www.youtube.com/']);
    expect(suggestEnteredUrls('ou', entered).map((item) => item.url)).toEqual(['https://outlook.live.com/']);
  });

  it('does not suggest anything when no addresses were entered', () => {
    expect(suggestEnteredUrls('news', [])).toEqual([]);
  });

  it('lists earlier sites for the back-history menu', () => {
    expect(previousHistoryEntries(tab({})).map((entry) => entry.url)).toEqual(['https://news.example/']);
  });
});
