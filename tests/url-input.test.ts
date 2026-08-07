import { describe, expect, it } from 'vitest';

import { NEW_TAB_URL, normalizeAddressInput } from '../src/main/browser/url-input';

describe('normalizeAddressInput', () => {
  it('opens the branded new-tab page for empty input', () => {
    expect(normalizeAddressInput('   ')).toEqual({ kind: 'empty', url: NEW_TAB_URL });
  });

  it('keeps explicit HTTP and HTTPS addresses', () => {
    expect(normalizeAddressInput('https://example.com/path')).toEqual({
      kind: 'url',
      url: 'https://example.com/path',
    });
    expect(normalizeAddressInput('http://example.com')).toEqual({
      kind: 'url',
      url: 'http://example.com/',
    });
  });

  it('uses HTTP for localhost and HTTPS for public hosts', () => {
    expect(normalizeAddressInput('localhost:3000/dashboard')).toEqual({
      kind: 'url',
      url: 'http://localhost:3000/dashboard',
    });
    expect(normalizeAddressInput('example.com/docs')).toEqual({
      kind: 'url',
      url: 'https://example.com/docs',
    });
  });

  it('searches DuckDuckGo for plain text', () => {
    expect(normalizeAddressInput('calm browser design')).toEqual({
      kind: 'search',
      url: 'https://duckduckgo.com/?q=calm%20browser%20design',
    });
  });

  it('can use Google as the selected search engine', () => {
    expect(normalizeAddressInput('calm browser design', 'google')).toEqual({
      kind: 'search',
      url: 'https://www.google.com/search?q=calm%20browser%20design',
    });
  });

  it('rejects unsafe and unsupported schemes', () => {
    expect(normalizeAddressInput('javascript:alert(1)')).toMatchObject({ kind: 'invalid' });
    expect(normalizeAddressInput('file:///tmp/private')).toMatchObject({ kind: 'invalid' });
    expect(normalizeAddressInput('data:text/html,hello')).toMatchObject({ kind: 'invalid' });
  });
});
