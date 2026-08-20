import { describe, expect, it } from 'vitest';

import {
  applyClientHintHeaders,
  chromeCompatibleUserAgent,
  chromeMajorVersion,
  chromiumClientHintHeaders,
  chromiumUserAgentDataScript,
  firefoxCompatibleUserAgent,
  frozenChromeVersion,
  isGoogleAccountUrl,
} from '../src/main/browser/chromium-user-agent';

describe('chromium-compatible user agent', () => {
  const chrome = '144.0.7559.110';

  it('advertises Electron’s Chromium as a current Chrome UA without an Electron token', () => {
    const ua = chromeCompatibleUserAgent(chrome, 'darwin');
    expect(ua).toContain('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(ua).toContain(`Chrome/${frozenChromeVersion(chrome)}`);
    expect(ua).toContain('Safari/537.36');
    expect(ua).not.toMatch(/Electron/i);
    expect(ua).not.toMatch(/Poppin/i);
    expect(frozenChromeVersion(chrome)).toBe('144.0.0.0');
    expect(chromeMajorVersion(chrome)).toBe('144');
  });

  it('matches platform-specific Chromium UA shapes', () => {
    expect(chromeCompatibleUserAgent(chrome, 'win32')).toContain('Windows NT 10.0; Win64; x64');
    expect(chromeCompatibleUserAgent(chrome, 'linux')).toContain('X11; Linux x86_64');
  });

  it('sends Chromium Client Hints without an Electron brand', () => {
    const headers = chromiumClientHintHeaders(chrome, 'darwin');
    expect(headers['User-Agent']).toBe(chromeCompatibleUserAgent(chrome, 'darwin'));
    expect(headers['sec-ch-ua']).toContain('"Chromium";v="144"');
    expect(headers['sec-ch-ua']).toContain('"Google Chrome";v="144"');
    expect(headers['sec-ch-ua']).not.toMatch(/Electron/i);
    expect(headers['sec-ch-ua-mobile']).toBe('?0');
    expect(headers['sec-ch-ua-platform']).toBe('"macOS"');
    expect(headers['sec-ch-ua-full-version']).toBe(`"${chrome}"`);
    expect(headers['sec-ch-ua-full-version-list']).toContain(`"Chromium";v="${chrome}"`);
  });

  it('replaces an existing Electron UA and Client Hint headers on outbound requests', () => {
    const headers = applyClientHintHeaders({
      'User-Agent': 'Mozilla/5.0 Poppin Browser/0.1.0 Chrome/90.0.0.0 Electron/43.3.0 Safari/537.36',
      'sec-ch-ua': '"Electron";v="43", "Chromium";v="90"',
      Accept: 'text/html',
    }, chrome, 'darwin');
    expect(headers.Accept).toBe('text/html');
    expect(headers['User-Agent']).toBe(chromeCompatibleUserAgent(chrome, 'darwin'));
    expect(headers['User-Agent']).not.toMatch(/Electron/i);
    expect(headers['sec-ch-ua']).not.toMatch(/Electron/i);
    expect(headers['sec-ch-ua']).toContain('"Chromium";v="144"');
  });

  it('uses Firefox UA for Google Account requests and strips Client Hints', () => {
    const headers = applyClientHintHeaders({
      'User-Agent': 'Mozilla/5.0 Electron/43.3.0',
      'sec-ch-ua': '"Electron";v="43"',
      Accept: 'text/html',
    }, chrome, 'darwin', 'https://accounts.google.com/v3/signin/identifier');
    expect(headers.Accept).toBe('text/html');
    expect(headers['User-Agent']).toBe(firefoxCompatibleUserAgent('darwin'));
    expect(headers['User-Agent']).toMatch(/Firefox\/134\.0/);
    expect(headers['sec-ch-ua']).toBeUndefined();
    expect(isGoogleAccountUrl('https://accounts.google.com/signin')).toBe(true);
    expect(isGoogleAccountUrl('https://docs.google.com/document/u/0/')).toBe(false);
  });

  it('shims navigator.userAgentData in the page world without an Electron brand', () => {
    const script = chromiumUserAgentDataScript(chrome, 'darwin');
    expect(script).toContain('Google Chrome');
    expect(script).toContain('"144"');
    expect(script).toContain('userAgentData');
    expect(script).not.toMatch(/Electron/i);
  });
});
