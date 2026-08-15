// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { authenticationDialogBounds, classifyInspectedControl, isAuthenticationCompletionUrl, isAuthenticationPopup, isAuthenticationRedirectInterstitial, isExternalLinkPreview, isGoogleWidgetMainFrameUrl, isIdentityProviderHost, isLocalhostUrl, isUsefulSemanticRole, recoverMailInboxFromAuthRedirect, recoverMailUrlFromGoogleWidget, SEMANTIC_ROLES } from '../src/main/browser/browser-engine';
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

  it('allows Google Accounts and GSI popups from ordinary relying parties', () => {
    expect(isAuthenticationPopup('https://accounts.google.com/gsi/select?client_id=fixture', 'https://example.com/login')).toBe(true);
    expect(isAuthenticationPopup('https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture', 'https://chatgpt.com/')).toBe(true);
    expect(isAuthenticationPopup('https://accounts.google.com/v3/signin/identifier', 'https://mail.google.com/')).toBe(true);
    expect(isAuthenticationPopup('https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'https://example.com/')).toBe(true);
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

  it('detects identity providers and post-auth return URLs for opener handoff', () => {
    expect(isIdentityProviderHost('accounts.google.com')).toBe(true);
    expect(isIdentityProviderHost('login.microsoftonline.com')).toBe(true);
    expect(isIdentityProviderHost('chatgpt.com')).toBe(false);
    expect(isIdentityProviderHost('claude.ai')).toBe(false);

    expect(isAuthenticationCompletionUrl('https://accounts.google.com/o/oauth2/v2/auth', 'https://chatgpt.com/')).toBe(false);
    expect(isAuthenticationCompletionUrl('https://chatgpt.com/', 'https://chatgpt.com/auth/login')).toBe(true);
    expect(isAuthenticationCompletionUrl('https://chatgpt.com/', 'https://chatgpt.com/')).toBe(true);
    expect(isAuthenticationCompletionUrl('https://mail.google.com/mail/u/0/#inbox', 'https://mail.google.com/')).toBe(true);
    expect(isAuthenticationCompletionUrl('https://chatgpt.com/api/auth/callback?code=fixture', 'https://chatgpt.com/')).toBe(true);
    expect(isAuthenticationCompletionUrl('http://127.0.0.1:3000/oauth-popup', 'http://127.0.0.1:3000/login')).toBe(false);
    expect(isAuthenticationCompletionUrl('http://127.0.0.1:3000/oauth-consent', 'http://127.0.0.1:3000/login')).toBe(false);
    expect(isAuthenticationCompletionUrl('http://127.0.0.1:3000/', 'http://127.0.0.1:3000/login')).toBe(true);
    expect(isAuthenticationCompletionUrl('https://example.com/', 'https://duckduckgo.com/')).toBe(false);

    expect(isAuthenticationRedirectInterstitial('https://outlook.live.com/owa/authredirect.html?code=x')).toBe(true);
    expect(isAuthenticationCompletionUrl('https://outlook.live.com/owa/authredirect.html?code=x', 'https://outlook.live.com/mail/')).toBe(false);
    expect(isAuthenticationCompletionUrl('https://outlook.live.com/mail/u/0/', 'https://outlook.live.com/mail/')).toBe(true);
    expect(recoverMailInboxFromAuthRedirect('https://outlook.live.com/owa/authredirect.html?code=x')).toBe('https://outlook.live.com/mail/');
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

describe('Gmail widget navigation policy', () => {
  const hovercard = 'https://contacts.google.com/widget/hovercard/v/2?hl=en-GB&origin=https%3A%2F%2Fmail.google.com&usegapi=1';

  it('detects Google contact hovercards that must not replace Gmail as the main frame', () => {
    expect(isGoogleWidgetMainFrameUrl(hovercard)).toBe(true);
    expect(isGoogleWidgetMainFrameUrl('https://mail.google.com/mail/u/0/#inbox')).toBe(false);
    expect(isGoogleWidgetMainFrameUrl('https://example.com/widget/hovercard')).toBe(false);
  });

  it('recovers the Gmail inbox from a persisted hovercard URL', () => {
    expect(recoverMailUrlFromGoogleWidget(hovercard)).toBe('https://mail.google.com/mail/u/0/#inbox');
    expect(recoverMailUrlFromGoogleWidget('https://mail.google.com/mail/u/0/#inbox')).toBeNull();
  });
});

describe('mailbox inspect and Outlook AX roles', () => {
  it('exposes named Outlook folder and message roles as useful semantic refs', () => {
    expect(SEMANTIC_ROLES.has('treeitem')).toBe(true);
    expect(SEMANTIC_ROLES.has('row')).toBe(true);
    expect(SEMANTIC_ROLES.has('gridcell')).toBe(true);
    expect(isUsefulSemanticRole('treeitem', 'Inbox')).toBe(true);
    expect(isUsefulSemanticRole('row', 'Quote from Acme')).toBe(true);
    expect(isUsefulSemanticRole('gridcell', 'Request for quote')).toBe(true);
    expect(isUsefulSemanticRole('listitem', 'Deleted Items')).toBe(true);
    expect(isUsefulSemanticRole('treeitem', '')).toBe(false);
    expect(isUsefulSemanticRole('statictext', '')).toBe(false);
  });

  it('gates only Send and Delete on a signed-in mailbox, leaving Search and leftover Sign in ordinary', () => {
    const mailbox = (target: string) => classifyInspectedControl({ mailbox: true, mediaControl: false, target });
    expect(mailbox('Search')).toMatchObject({ consequential: null, takeover: null });
    expect(mailbox('Deleted Items')).toMatchObject({ consequential: null, takeover: null });
    expect(mailbox('Sign in with a different account')).toMatchObject({ consequential: null, takeover: null });
    expect(mailbox('Reply')).toMatchObject({ consequential: null, takeover: null });
    expect(mailbox('Send')).toMatchObject({ consequential: 'This mailbox action needs approval.', takeover: null });
    expect(mailbox('Delete')).toMatchObject({ consequential: 'This mailbox action needs approval.', takeover: null });
    expect(classifyInspectedControl({
      mailbox: false, mediaControl: false, target: 'Search', soup: 'search submit form',
    })).toMatchObject({ consequential: null, takeover: null });
    expect(classifyInspectedControl({
      mailbox: false, mediaControl: false, target: 'Sign in', pageIsAuth: false,
    })).toMatchObject({ consequential: null, takeover: null });
    expect(classifyInspectedControl({
      mailbox: false, mediaControl: false, target: 'Sign in with Microsoft', pageIsAuth: true,
    }).takeover).toMatch(/Authentication/i);
    expect(classifyInspectedControl({
      mailbox: false, mediaControl: false, target: 'Sign in with Microsoft', pageIsAuth: true, humanSessionAvailable: true,
    })).toMatchObject({ consequential: null, takeover: null });
    expect(classifyInspectedControl({ mailbox: false, mediaControl: false, target: 'Buy now' }).consequential).toBeTruthy();
    expect(classifyInspectedControl({ mailbox: false, mediaControl: false, target: 'Submit' }).consequential).toBeTruthy();
    expect(classifyInspectedControl({ mailbox: false, mediaControl: false, target: 'Publish' }).consequential).toBeTruthy();
  });
});
