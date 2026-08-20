import { describe, expect, it } from 'vitest';

import {
  isAuthenticationPopup,
  isBlankWindowOpenUrl,
  isGoogleWidgetMainFrameUrl,
  isGoogleWorkspaceDocumentUrl,
  isGoogleWorkspaceListUrl,
  resolveGoogleWorkspaceHoldNavigation,
  resolveWindowOpenAction,
  shouldBlockGoogleWorkspaceBounce,
  shouldDeferPageLinkHandling,
  shouldDisposeWindowOpenGuest,
  shouldPruneGoogleWorkspaceHistoryEntry,
  googleWorkspaceHistoryGuardScript,
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

  it('adopts about:blank window.open from Docs as a live tab so window.open is not null', () => {
    expect(resolveWindowOpenAction({
      url: 'about:blank',
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'new-tab',
    })).toEqual({ type: 'open-as-tab', url: 'about:blank', activate: true });
    expect(resolveWindowOpenAction({
      url: '',
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'same-tab',
    })).toEqual({ type: 'open-as-tab', url: 'about:blank', activate: true });
  });

  it('opens a Google Docs document URL as a live tab even when the preference is same-tab', () => {
    expect(resolveWindowOpenAction({
      url: docsFile,
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'new-tab',
    })).toEqual({ type: 'open-as-tab', url: docsFile, activate: true });
    expect(resolveWindowOpenAction({
      url: docsFile,
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'follow-site',
    })).toEqual({ type: 'open-as-tab', url: docsFile, activate: true });
    expect(resolveWindowOpenAction({
      url: docsFile,
      openerUrl: docsList,
      isTaskTab: false,
      linkOpening: 'same-tab',
    })).toEqual({ type: 'open-as-tab', url: docsFile, activate: true });
  });

  it('keeps ordinary same-tab window.open on the opener', () => {
    expect(resolveWindowOpenAction({
      url: 'https://example.com/item',
      openerUrl: 'https://example.com/list',
      isTaskTab: false,
      linkOpening: 'same-tab',
    })).toEqual({ type: 'open', url: 'https://example.com/item', target: 'same-tab' });
  });

  it('opens ordinary new-tab window.open as a live tab instead of denying the WindowProxy', () => {
    expect(resolveWindowOpenAction({
      url: 'https://example.com/item',
      openerUrl: 'https://example.com/list',
      isTaskTab: false,
      linkOpening: 'new-tab',
    })).toEqual({ type: 'open-as-tab', url: 'https://example.com/item', activate: true });
    expect(resolveWindowOpenAction({
      url: 'https://example.com/item',
      openerUrl: 'https://example.com/list',
      isTaskTab: false,
      linkOpening: 'new-tab',
      disposition: 'background-tab',
      focusNewTabs: true,
    })).toEqual({ type: 'open-as-tab', url: 'https://example.com/item', activate: false });
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

  it('classifies Google Workspace document vs list URLs and blocks the open-then-bounce', () => {
    expect(isGoogleWorkspaceDocumentUrl(docsFile)).toBe(true);
    expect(isGoogleWorkspaceDocumentUrl('https://docs.google.com/spreadsheets/d/abc/edit')).toBe(true);
    expect(isGoogleWorkspaceDocumentUrl('https://docs.google.com/document/u/0/d/abc123/edit')).toBe(true);
    expect(isGoogleWorkspaceDocumentUrl('https://docs.google.com/spreadsheets/u/0/d/abc/edit')).toBe(true);
    expect(isGoogleWorkspaceDocumentUrl(docsList)).toBe(false);
    expect(isGoogleWorkspaceListUrl(docsList)).toBe(true);
    expect(isGoogleWorkspaceListUrl('https://docs.google.com/')).toBe(true);
    expect(isGoogleWorkspaceListUrl('https://docs.google.com/document/u/0/home')).toBe(true);
    expect(isGoogleWorkspaceListUrl('https://docs.google.com/document/u/0/d/abc123/edit')).toBe(false);
    expect(isGoogleWorkspaceListUrl('https://drive.google.com/drive/u/0/home')).toBe(true);
    expect(isGoogleWorkspaceListUrl(docsFile)).toBe(false);
    expect(shouldBlockGoogleWorkspaceBounce(docsFile, docsList)).toBe(true);
    expect(shouldBlockGoogleWorkspaceBounce(docsFile, 'https://docs.google.com/')).toBe(true);
    expect(shouldBlockGoogleWorkspaceBounce(
      'https://docs.google.com/document/u/0/d/abc123/edit',
      docsList,
    )).toBe(true);
    expect(shouldBlockGoogleWorkspaceBounce(docsList, docsFile)).toBe(false);
    expect(shouldBlockGoogleWorkspaceBounce(docsFile, 'https://example.com/')).toBe(false);
  });

  it('keeps a document hold after the document has painted so a later list bounce is restored', () => {
    const hold = { documentUrl: docsFile };
    expect(resolveGoogleWorkspaceHoldNavigation(hold, docsList)).toEqual({
      hold,
      prevent: true,
      restoreDocumentUrl: docsFile,
    });
    expect(resolveGoogleWorkspaceHoldNavigation(hold, 'https://docs.google.com/')).toEqual({
      hold,
      prevent: true,
      restoreDocumentUrl: docsFile,
    });
    expect(resolveGoogleWorkspaceHoldNavigation(hold, docsFile)).toEqual({
      hold,
      prevent: false,
      restoreDocumentUrl: null,
    });
  });

  it('lets the list tab return to the list after the document opened in another tab', () => {
    expect(resolveGoogleWorkspaceHoldNavigation(null, docsFile, { suppressHold: true })).toEqual({
      hold: { documentUrl: docsFile },
      prevent: false,
      restoreDocumentUrl: null,
    });
    expect(resolveGoogleWorkspaceHoldNavigation(
      { documentUrl: docsFile },
      docsList,
      { suppressHold: true },
    )).toEqual({
      hold: null,
      prevent: false,
      restoreDocumentUrl: null,
    });
  });

  it('lets the user leave a document tab with chrome back or the address bar', () => {
    expect(resolveGoogleWorkspaceHoldNavigation(
      { documentUrl: docsFile },
      docsList,
      { allowListNavigation: true },
    )).toEqual({
      hold: null,
      prevent: false,
      restoreDocumentUrl: null,
    });
  });

  it('does not dispose a window.open guest that is already hosted as a Poppin tab', () => {
    expect(shouldDisposeWindowOpenGuest({ hostedInTab: true, isAuthentication: false })).toBe(false);
    expect(shouldDisposeWindowOpenGuest({ hostedInTab: false, isAuthentication: true })).toBe(false);
    expect(shouldDisposeWindowOpenGuest({ hostedInTab: false, isAuthentication: false })).toBe(true);
  });

  it('prunes list and blank history entries left behind by window.open', () => {
    expect(shouldPruneGoogleWorkspaceHistoryEntry('about:blank')).toBe(true);
    expect(shouldPruneGoogleWorkspaceHistoryEntry(docsList)).toBe(true);
    expect(shouldPruneGoogleWorkspaceHistoryEntry('https://docs.google.com/')).toBe(true);
    expect(shouldPruneGoogleWorkspaceHistoryEntry(docsFile)).toBe(false);
  });

  it('installs a page-world guard that ignores history.back onto the list', () => {
    const script = googleWorkspaceHistoryGuardScript(1_000);
    expect(script).toContain('history.back');
    expect(script).toContain('replaceState');
    expect(script).toContain('docs.google.com');
  });
});
