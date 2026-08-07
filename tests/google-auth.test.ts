import { afterEach, describe, expect, it, vi } from 'vitest';

import { GOOGLE_SIGN_IN_FALLBACK_SCRIPT, isGoogleAccountsUrl } from '../src/shared/google-auth';

afterEach(() => {
  document.body.replaceChildren();
});

describe('Google sign-in boundary', () => {
  it('allows assistance only on the exact secure Google Accounts origin', () => {
    expect(isGoogleAccountsUrl('https://accounts.google.com/v3/signin/challenge/pk')).toBe(true);
    expect(isGoogleAccountsUrl('http://accounts.google.com/')).toBe(false);
    expect(isGoogleAccountsUrl('https://accounts.google.com.example.test/')).toBe(false);
    expect(isGoogleAccountsUrl('https://mail.google.com/')).toBe(false);
    expect(isGoogleAccountsUrl('not a url')).toBe(false);
  });

  it('activates only a visible alternate-method control', () => {
    const unrelated = document.createElement('button');
    unrelated.textContent = 'Continue';
    unrelated.addEventListener('click', vi.fn());
    const fallback = document.createElement('button');
    fallback.textContent = 'Try another way';
    Object.defineProperty(fallback, 'getClientRects', { value: () => [{ width: 20, height: 10 }] });
    const clicked = vi.fn();
    fallback.addEventListener('click', clicked);
    document.body.append(unrelated, fallback);

    expect(window.eval(GOOGLE_SIGN_IN_FALLBACK_SCRIPT)).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('does nothing when Google has no visible alternate-method control', () => {
    const hiddenFallback = document.createElement('button');
    hiddenFallback.textContent = 'Try another way';
    document.body.append(hiddenFallback);

    expect(window.eval(GOOGLE_SIGN_IN_FALLBACK_SCRIPT)).toBe(false);
  });
});
