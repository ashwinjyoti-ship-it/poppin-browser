import type { Session } from 'electron';

/**
 * Chromium version to advertise when `process.versions.chrome` is unavailable
 * (unit tests). Runtime always prefers Electron's bundled Chromium.
 */
export const FALLBACK_CHROME_VERSION = '144.0.0.0';

const CLIENT_HINT_HEADER_NAMES = [
  'User-Agent',
  'user-agent',
  'Sec-CH-UA',
  'sec-ch-ua',
  'Sec-CH-UA-Mobile',
  'sec-ch-ua-mobile',
  'Sec-CH-UA-Platform',
  'sec-ch-ua-platform',
  'Sec-CH-UA-Full-Version',
  'sec-ch-ua-full-version',
  'Sec-CH-UA-Full-Version-List',
  'sec-ch-ua-full-version-list',
  'Sec-CH-UA-Platform-Version',
  'sec-ch-ua-platform-version',
] as const;

export function chromeVersionForUserAgent(chromeVersion = process.versions.chrome): string {
  const value = chromeVersion?.trim();
  return value && /^\d+(\.\d+){0,3}$/.test(value) ? value : FALLBACK_CHROME_VERSION;
}

export function chromeMajorVersion(chromeVersion = process.versions.chrome): string {
  return chromeVersionForUserAgent(chromeVersion).split('.')[0] ?? '144';
}

/** Chrome's frozen UA reports MAJOR.0.0.0 rather than the full build. */
export function frozenChromeVersion(chromeVersion = process.versions.chrome): string {
  return `${chromeMajorVersion(chromeVersion)}.0.0.0`;
}

/**
 * A current Chrome-compatible UA matching Electron's bundled Chromium.
 * Strips the `Electron/` token Google Account rejects, without advertising a
 * different engine or an inflated Chrome version.
 */
export function chromeCompatibleUserAgent(chromeVersion = process.versions.chrome, platform = process.platform): string {
  const chrome = frozenChromeVersion(chromeVersion);
  if (platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  }
  if (platform === 'linux') {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  }
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

export function chromiumClientHintPlatform(platform = process.platform): '"macOS"' | '"Windows"' | '"Linux"' {
  if (platform === 'win32') return '"Windows"';
  if (platform === 'linux') return '"Linux"';
  return '"macOS"';
}

/**
 * Low-entropy Client Hints Google Account expects from a modern Chromium.
 * Brands advertise the engine we actually ship (`Chromium` + matching
 * `Google Chrome` compatibility token), never Electron.
 */
export function chromiumClientHintHeaders(
  chromeVersion = process.versions.chrome,
  platform = process.platform,
): Record<string, string> {
  const full = chromeVersionForUserAgent(chromeVersion);
  const major = chromeMajorVersion(chromeVersion);
  const brands = `"Chromium";v="${major}", "Not:A-Brand";v="24", "Google Chrome";v="${major}"`;
  const fullList = `"Chromium";v="${full}", "Not:A-Brand";v="10.0.1.4", "Google Chrome";v="${full}"`;
  return {
    'User-Agent': chromeCompatibleUserAgent(chromeVersion, platform),
    'sec-ch-ua': brands,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': chromiumClientHintPlatform(platform),
    'sec-ch-ua-full-version': `"${full}"`,
    'sec-ch-ua-full-version-list': fullList,
  };
}

export function applyClientHintHeaders(
  requestHeaders: Record<string, string>,
  chromeVersion = process.versions.chrome,
  platform = process.platform,
): Record<string, string> {
  const next = { ...requestHeaders };
  for (const name of CLIENT_HINT_HEADER_NAMES) delete next[name];
  return { ...next, ...chromiumClientHintHeaders(chromeVersion, platform) };
}

/**
 * Page-world shim so Google’s JS `navigator.userAgentData` check matches the
 * request headers. Electron still brands itself in UA-CH even after setUserAgent.
 */
export function chromiumUserAgentDataScript(
  chromeVersion = process.versions.chrome,
  platform = process.platform,
): string {
  const major = chromeMajorVersion(chromeVersion);
  const full = chromeVersionForUserAgent(chromeVersion);
  const ua = chromeCompatibleUserAgent(chromeVersion, platform);
  const platformName = platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : 'macOS';
  const architecture = process.arch === 'arm64' || process.arch === 'arm' ? 'arm' : 'x86';
  const bitness = process.arch === 'ia32' ? '32' : '64';
  return `(() => {
    const ua = ${JSON.stringify(ua)};
    const brands = [
      { brand: 'Chromium', version: ${JSON.stringify(major)} },
      { brand: 'Not:A-Brand', version: '24' },
      { brand: 'Google Chrome', version: ${JSON.stringify(major)} },
    ];
    const fullVersionList = [
      { brand: 'Chromium', version: ${JSON.stringify(full)} },
      { brand: 'Not:A-Brand', version: '10.0.1.4' },
      { brand: 'Google Chrome', version: ${JSON.stringify(full)} },
    ];
    const data = {
      brands,
      mobile: false,
      platform: ${JSON.stringify(platformName)},
      getHighEntropyValues: async (hints) => {
        const values = {
          brands,
          fullVersionList,
          mobile: false,
          model: '',
          platform: ${JSON.stringify(platformName)},
          platformVersion: ${JSON.stringify(platform === 'darwin' ? '15.0.0' : '10.0.0')},
          uaFullVersion: ${JSON.stringify(full)},
          architecture: ${JSON.stringify(architecture)},
          bitness: ${JSON.stringify(bitness)},
          wow64: false,
        };
        if (!Array.isArray(hints) || hints.length === 0) return values;
        const requested = {};
        for (const hint of hints) {
          if (hint in values) requested[hint] = values[hint];
        }
        return requested;
      },
      toJSON() { return { brands: this.brands, mobile: this.mobile, platform: this.platform }; },
    };
    try { Object.defineProperty(Navigator.prototype, 'userAgent', { configurable: true, get: () => ua }); } catch {}
    try { Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua }); } catch {}
    try { Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => data }); } catch {}
    try { Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => data }); } catch {}
  })()`;
}

/** Apply a Chromium-compatible UA and Client Hints to the browsing session. */
export function applyChromiumUserAgent(target: Session, chromeVersion = process.versions.chrome): void {
  const ua = chromeCompatibleUserAgent(chromeVersion);
  target.setUserAgent(ua, 'en-US,en');
  target.webRequest.onBeforeSendHeaders(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      callback({ requestHeaders: applyClientHintHeaders(details.requestHeaders, chromeVersion) });
    },
  );
}
