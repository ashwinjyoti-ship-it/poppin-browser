import { describe, expect, it } from 'vitest';

import { issueForCommand, visibleAddressIssue } from '../src/renderer/ui/address-issue';
import type { BrowserSnapshot, BrowserTabSnapshot } from '../src/shared/browser';

const GOOGLE_TAB: BrowserTabSnapshot = {
  id: 'google',
  url: 'https://accounts.google.com/v3/signin/challenge/pk',
  title: 'Google sign-in',
  faviconUrl: null,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  failure: null,
};

describe('address issue scope', () => {
  it('shows a command failure only on the tab and URL that produced it', () => {
    const snapshot: BrowserSnapshot = { tabs: [GOOGLE_TAB], activeTabId: GOOGLE_TAB.id };
    const issue = issueForCommand(
      { type: 'showGoogleSignInAlternatives', tabId: GOOGLE_TAB.id },
      'Choose “Try another way” directly on Google’s page.',
      snapshot,
      GOOGLE_TAB,
    );

    expect(visibleAddressIssue(issue, GOOGLE_TAB)).toContain('Try another way');
    expect(visibleAddressIssue(issue, { ...GOOGLE_TAB, url: 'https://invoice.stripe.com/' })).toBe('');
    expect(visibleAddressIssue(issue, { ...GOOGLE_TAB, id: 'other-tab' })).toBe('');
  });
});
