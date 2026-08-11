// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { authenticationDialogBounds, isAuthenticationPopup, isExternalLinkPreview, isLocalhostUrl } from '../src/main/browser/browser-engine';
import { WorkspaceStore } from '../src/main/workspace/workspace-store';
import type { VisualSelectionSnapshot } from '../src/shared/workspace';

describe('localhost visual selection', () => {
  it('accepts only HTTP localhost preview origins', () => {
    expect(isLocalhostUrl('http://localhost:3000/settings')).toBe(true);
    expect(isLocalhostUrl('https://127.0.0.1:5173/')).toBe(true);
    expect(isLocalhostUrl('http://[::1]:8080/')).toBe(true);
    expect(isLocalhostUrl('https://example.com/')).toBe(false);
    expect(isLocalhostUrl('file:///tmp/index.html')).toBe(false);
  });

  it('persists one explicit inspectable selection package', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-selection-'));
    const store = new WorkspaceStore(path.join(directory, 'poppin.sqlite'));
    const selection: VisualSelectionSnapshot = {
      tabId: 'tab-1', url: 'http://localhost:3000/', selector: '#save', html: '<button id="save">Save</button>',
      css: { display: 'flex', color: 'rgb(0, 0, 0)' }, domContext: '<main><button id="save">Save</button></main>',
      boundingBox: { x: 10, y: 20, width: 90, height: 32 }, screenshotDataUrl: 'data:image/png;base64,fixture',
      capturedAt: '2026-08-07T00:00:00.000Z',
    };
    store.saveVisualSelection(selection);
    expect(store.getVisualSelection()).toEqual(selection);
    store.clearVisualSelection();
    expect(store.getVisualSelection()).toBeNull();
    store.close();
  });
});

describe('authentication popup policy', () => {
  it('allows secure identity popups from Claude without allowing arbitrary popups', () => {
    expect(isAuthenticationPopup('https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture', 'https://claude.ai/login')).toBe(true);
    expect(isAuthenticationPopup('about:blank', 'https://claude.ai/login')).toBe(true);
    expect(isAuthenticationPopup('about:blank', 'https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    expect(isAuthenticationPopup('https://accounts.google.com/o/oauth2/consent', 'https://accounts.google.com/signin')).toBe(true);
    expect(isAuthenticationPopup('https://example.com/oauth/callback', 'https://example.com/login')).toBe(true);
    expect(isAuthenticationPopup('http://127.0.0.1:3000/oauth-popup', 'http://127.0.0.1:3000/login')).toBe(true);
    expect(isAuthenticationPopup('https://example.com/popup', 'https://claude.ai/login')).toBe(false);
    expect(isAuthenticationPopup('about:blank', 'https://example.com/login')).toBe(false);
    expect(isAuthenticationPopup('http://accounts.google.com/login', 'https://claude.ai/login')).toBe(false);
    expect(isAuthenticationPopup('https://accounts.google.com/login', 'http://example.com/')).toBe(false);
  });

  it('keeps the sign-in dialog smaller than the parent with a visible top Cancel strip', () => {
    const bounds = authenticationDialogBounds({ x: 100, y: 40, width: 1280, height: 800 });
    expect(bounds.width).toBeLessThanOrEqual(720);
    expect(bounds.height).toBeLessThanOrEqual(620);
    expect(bounds.width).toBeLessThan(1280 * 0.75);
    expect(bounds.height).toBeLessThan(800 * 0.85);
    expect(bounds.y).toBeGreaterThanOrEqual(40 + 76);
    expect(bounds.x).toBeGreaterThanOrEqual(100);
  });
});

describe('Arc-style link preview policy', () => {
  it('previews secure cross-site links without intercepting same-site or unsafe navigation', () => {
    expect(isExternalLinkPreview('https://docs.example.net/guide', 'https://example.com/article')).toBe(true);
    expect(isExternalLinkPreview('https://example.com/next', 'https://example.com/article')).toBe(false);
    expect(isExternalLinkPreview('http://localhost:4000/preview', 'http://localhost:3000/article')).toBe(true);
    expect(isExternalLinkPreview('http://example.net/', 'https://example.com/')).toBe(false);
    expect(isExternalLinkPreview('javascript:alert(1)', 'https://example.com/')).toBe(false);
  });

});
