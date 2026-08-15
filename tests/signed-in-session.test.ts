import { describe, expect, it } from 'vitest';

import {
  isSignedInPageUrl,
  ordinarySignedInTabIdsMatchingPrompt,
  signedInHumanUrlFor,
} from '../src/shared/signed-in-session';

describe('signed-in human session helpers', () => {
  it('treats app pages as signed in and login URLs as auth', () => {
    expect(isSignedInPageUrl('https://github.com/issues')).toBe(true);
    expect(isSignedInPageUrl('https://www.linkedin.com/feed/')).toBe(true);
    expect(isSignedInPageUrl('https://github.com/login')).toBe(false);
    expect(isSignedInPageUrl('https://accounts.google.com/ServiceLogin')).toBe(false);
  });

  it('rewrites a login URL to the matching ordinary human tab', () => {
    const tabs = [
      { id: 'human', url: 'https://github.com/issues' },
      { id: 'agent', url: 'https://github.com/login', taskSpaceId: 'space-1' },
    ];
    expect(signedInHumanUrlFor('https://github.com/login', tabs)).toBe('https://github.com/issues');
    expect(signedInHumanUrlFor('https://linkedin.com/login', tabs)).toBeNull();
  });

  it('matches a prompt to the named site without sending unrelated tabs', () => {
    const tabs = [
      { id: 'linkedin', url: 'https://www.linkedin.com/feed/' },
      { id: 'hn', url: 'https://news.ycombinator.com/' },
    ];
    expect(ordinarySignedInTabIdsMatchingPrompt(tabs, 'Research my LinkedIn feed today.')).toEqual(['linkedin']);
    expect(ordinarySignedInTabIdsMatchingPrompt(tabs, 'Search for acoustic guitars')).toEqual([]);
  });
});
