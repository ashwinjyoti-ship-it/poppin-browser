import { describe, expect, it } from 'vitest';

import {
  isAuthenticationPopup,
  isBlankWindowOpenUrl,
  isGoogleWidgetMainFrameUrl,
  resolveWindowOpenAction,
  shouldDeferPageLinkHandling,
} from '../src/main/browser/browser-engine';

const docsList = 'https://docs.google.com/document/u/0/';
const docsFile = 'https://docs.google.com/document/d/abc123/edit';

describe('window-open and Google Docs navigation policy', () => {
  it('treats empty and about:blank window.open URLs as deferred placeholders', () => {
    expect(isBlankWindowOpenUrl('about:blank')).toBe(true);
    expect(isBlankWindowOpenUrl('')).toBe(true);
    expect(isBlankWindowOpenUrl('  ')).toBe(true);
    expect(isBlankWindowOpenUrl(docsFile)).toBe(false);
  });

  it('does not treat Google Docs documents as Gmail widgets or auth popups', () => {
    expect(isGoogleWidgetMainFrameUrl(docsFile)).toBe(false);
    expect(isGoogleWidgetMainFrameUrl(docsList)).toBe(false);
    expect(isAuthenticationPopup(docsFile, docsList)).toBe(false);
    expect(isAuthenticationPopup('about:blank', docsList)).toBe(false);
  });

  it('adopts about:blank window.open from Docs instead of denying or loading the opener', () => {
    expect(resolveWindowOpenAction({
      url: 'about:blank',
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'new-tab',
    })).toEqual({ type: 'adopt-blank' });
    expect(resolveWindowOpenAction({
      url: '',
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'same-tab',
    })).toEqual({ type: 'adopt-blank' });
  });

  it('opens a Google Docs document URL in a new tab when the preference is new-tab', () => {
    expect(resolveWindowOpenAction({
      url: docsFile,
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'new-tab',
    })).toEqual({ type: 'open', url: docsFile, target: 'new-tab' });
    expect(resolveWindowOpenAction({
      url: docsFile,
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'follow-site',
    })).toEqual({ type: 'open', url: docsFile, target: 'new-tab' });
  });

  it('keeps same-tab window.open on the opener for explicit same-tab preference', () => {
    expect(resolveWindowOpenAction({
      url: docsFile,
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'same-tab',
    })).toEqual({ type: 'open', url: docsFile, target: 'same-tab' });
  });

  it('still allows Google Account sign-in popups and denies Gmail hovercard widgets', () => {
    expect(resolveWindowOpenAction({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture',
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'new-tab',
    })).toEqual({ type: 'authentication' });
    expect(resolveWindowOpenAction({
      url: 'https://contacts.google.com/widget/hovercard/v/2?origin=https%3A%2F%2Fmail.google.com',
      openerUrl: 'https://mail.google.com/mail/u/0/#inbox',
      isTaskTab: false,
      linkOpening: 'new-tab',
    })).toEqual({ type: 'deny' });
  });

  it('lets Google Docs/Drive same-origin clicks and target=_blank keep native handling', () => {
    expect(shouldDeferPageLinkHandling(docsList, docsFile, '')).toBe(true);
    expect(shouldDeferPageLinkHandling(docsList, docsFile, '_self')).toBe(true);
    expect(shouldDeferPageLinkHandling(
      'https://drive.google.com/drive/u/0/home',
      'https://drive.google.com/file/d/abc/view',
      '',
    )).toBe(true);
    expect(shouldDeferPageLinkHandling('https://example.com/list', 'https://example.com/item', '_blank')).toBe(true);
    expect(shouldDeferPageLinkHandling('https://example.com/list', 'https://example.com/item', '')).toBe(false);
    expect(shouldDeferPageLinkHandling(docsList, 'https://example.com/offsite', '')).toBe(false);
  });
});
