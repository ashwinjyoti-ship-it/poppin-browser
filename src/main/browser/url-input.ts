export const NEW_TAB_URL = 'poppin://new-tab/';

const EXPLICIT_PROTOCOL = /^[a-z][a-z\d+.-]*:/i;
const LOCALHOST = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(:\d+)?(?:\/|$)/i;
const HOST_LIKE = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:\/|$)/i;

export type NormalizedInput =
  | { kind: 'empty'; url: typeof NEW_TAB_URL }
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string }
  | { kind: 'invalid'; message: string };

export function normalizeAddressInput(input: string): NormalizedInput {
  const value = input.trim();

  if (!value) {
    return { kind: 'empty', url: NEW_TAB_URL };
  }

  if (LOCALHOST.test(value)) {
    return parseCandidate(`http://${value}`);
  }

  if (EXPLICIT_PROTOCOL.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { kind: 'invalid', message: 'Poppin can only open HTTP and HTTPS addresses.' };
      }
      return { kind: 'url', url: parsed.toString() };
    } catch {
      return { kind: 'invalid', message: 'That address is not valid.' };
    }
  }

  if (HOST_LIKE.test(value)) {
    return parseCandidate(`https://${value}`);
  }

  return {
    kind: 'search',
    url: `https://duckduckgo.com/?q=${encodeURIComponent(value)}`,
  };
}

function parseCandidate(value: string): NormalizedInput {
  try {
    return { kind: 'url', url: new URL(value).toString() };
  } catch {
    return { kind: 'invalid', message: 'That address is not valid.' };
  }
}

export function displayUrl(actualUrl: string, failedUrl?: string): string {
  if (failedUrl) return failedUrl;
  if (actualUrl === NEW_TAB_URL || actualUrl.startsWith('poppin://new-tab')) return '';
  if (actualUrl.startsWith('poppin://error')) return '';
  return actualUrl;
}
