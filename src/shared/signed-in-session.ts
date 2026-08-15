/**
 * URL-only helpers for reusing a human Poppin tab’s site session.
 * Never inspects cookies, tokens, or credential fields — Agent Tabs already
 * share `persist:poppin-browser`, so opening the same origin is enough.
 */

const IDENTITY_PROVIDER_HOSTS = new Set([
  'accounts.google.com',
  'appleid.apple.com',
  'auth.openai.com',
  'login.microsoftonline.com',
  'login.live.com',
  'auth.anthropic.com',
]);

const COMPOUND_SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'ac']);

export type BrowsableTab = { id: string; url: string; taskSpaceId?: string | null };

export function isLikelyAuthUrl(value: string): boolean {
  try {
    const target = new URL(value);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return true;
    if (IDENTITY_PROVIDER_HOSTS.has(target.hostname) || target.hostname.endsWith('.anthropic.com')) return true;
    const path = `${target.pathname}${target.search}${target.hash}`;
    if (/authredirect/i.test(path)) return true;
    return /(?:^|[/?#&_.-])(?:oauth[-/]?popup|sign[-_]?in|log[-_]?in|authorize|consent|identifier|select|challenge)(?:$|[/?#&_.=-])/i
      .test(path);
  } catch {
    return true;
  }
}

/** True when a tab URL looks like an app page, not a login interstitial. */
export function isSignedInPageUrl(value: string): boolean {
  try {
    const target = new URL(value);
    const local = target.hostname === 'localhost' || target.hostname.endsWith('.localhost') || target.hostname === '127.0.0.1';
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && local)) return false;
    return !isLikelyAuthUrl(value);
  } catch {
    return false;
  }
}

export function registrableSite(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./u, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const sld = parts[parts.length - 2];
  if (sld && COMPOUND_SLD.has(sld) && parts.length >= 3) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

export function sameRegistrableSite(left: string, right: string): boolean {
  try {
    return registrableSite(new URL(left).hostname) === registrableSite(new URL(right).hostname);
  } catch {
    return false;
  }
}

function ordinarySignedInTabs(tabs: readonly BrowsableTab[]): BrowsableTab[] {
  return tabs.filter((tab) => !tab.taskSpaceId && isSignedInPageUrl(tab.url));
}

function findOrdinarySignedInTab(tabs: readonly BrowsableTab[], targetUrl: string): BrowsableTab | null {
  return ordinarySignedInTabs(tabs).find((tab) => sameRegistrableSite(tab.url, targetUrl)) ?? null;
}

/**
 * Known product homes for identity-provider URLs. Only used when that product
 * tab is already open — never guesses a random Google/Microsoft property.
 */
function knownAppUrlForIdentityProvider(value: string): string | null {
  try {
    const target = new URL(value);
    const host = target.hostname.toLowerCase();
    if (host === 'login.microsoftonline.com' || host === 'login.live.com') return 'https://outlook.live.com/mail/';
    if (host === 'outlook.live.com' || host.endsWith('.outlook.com')) {
      if (/authredirect/i.test(`${target.pathname}${target.search}`)) return 'https://outlook.live.com/mail/';
    }
    if (host === 'accounts.google.com' || (host === 'mail.google.com' && /authredirect/i.test(`${target.pathname}${target.search}`))) {
      return 'https://mail.google.com/mail/u/0/#inbox';
    }
    return null;
  } catch {
    return null;
  }
}

/** Human-tab URL the agent should open instead of a login page, if one exists. */
export function signedInHumanUrlFor(targetUrl: string, tabs: readonly BrowsableTab[]): string | null {
  const recovered = knownAppUrlForIdentityProvider(targetUrl);
  if (recovered) {
    const known = findOrdinarySignedInTab(tabs, recovered);
    if (known) return known.url;
  }
  return findOrdinarySignedInTab(tabs, targetUrl)?.url ?? null;
}

/**
 * Ordinary signed-in tabs whose host is mentioned in the prompt. URL/host only —
 * does not read page content.
 */
export function ordinarySignedInTabIdsMatchingPrompt(tabs: readonly BrowsableTab[], prompt: string): string[] {
  const text = prompt.toLowerCase();
  if (!text.trim()) return [];
  return ordinarySignedInTabs(tabs).flatMap((tab) => {
    try {
      const host = new URL(tab.url).hostname.toLowerCase().replace(/^www\./u, '');
      const site = registrableSite(host);
      const labels = host.split('.').filter((part) => part.length >= 4 && !COMPOUND_SLD.has(part));
      if (text.includes(host) || text.includes(site) || labels.some((label) => text.includes(label))) return [tab.id];
      return [];
    } catch {
      return [];
    }
  });
}

export function signedInHumanPageUrls(tabs: readonly BrowsableTab[]): string[] {
  return ordinarySignedInTabs(tabs).map((tab) => tab.url);
}
