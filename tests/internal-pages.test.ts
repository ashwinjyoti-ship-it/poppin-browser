// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { renderNewTabPage } from '../src/main/browser/internal-pages';

describe('internal new-tab page', () => {
  it('posts searches to Google by default', () => {
    expect(renderNewTabPage('google')).toContain('action="https://www.google.com/search"');
    expect(renderNewTabPage('duckduckgo')).toContain('action="https://duckduckgo.com/"');
  });
});
