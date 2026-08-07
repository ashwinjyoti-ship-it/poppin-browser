export const GOOGLE_SIGN_IN_FALLBACK_SCRIPT = `(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const fallbackLabels = new Set(['try another way', 'choose another option']);
  const controls = document.querySelectorAll('button, a, [role="button"]');
  for (const control of controls) {
    const label = normalize(control.getAttribute('aria-label') || control.textContent);
    if (fallbackLabels.has(label) && control.getClientRects().length > 0) {
      control.click();
      return true;
    }
  }
  return false;
})()`;

export function isGoogleAccountsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'accounts.google.com';
  } catch {
    return false;
  }
}
