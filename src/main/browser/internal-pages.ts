import { protocol, type Session } from 'electron';

import type { SearchEnginePreference } from '../../shared/browser';
import { escapeHtml } from './safe-html';
import { newTabSearchForm } from './url-input';

export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'poppin',
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function handleInternalPages(browserSession: Session, getSearchEngine?: () => SearchEnginePreference): void {
  if (browserSession.protocol.isProtocolHandled('poppin')) return;
  browserSession.protocol.handle('poppin', (request) => {
    const url = new URL(request.url);
    const searchEngine = getSearchEngine?.() ?? 'google';
    if (url.hostname === 'error') {
      return htmlResponse(renderErrorPage(url), searchEngine);
    }
    return htmlResponse(renderNewTabPage(searchEngine), searchEngine);
  });
}

export function errorPageUrl(url: string, code: number, description: string): string {
  const params = new URLSearchParams({ url, code: String(code), description });
  return `poppin://error/?${params.toString()}`;
}

export function renderNewTabPage(searchEngine: SearchEnginePreference = 'google'): string {
  const form = newTabSearchForm(searchEngine);
  return pageShell(`
    <main class="new-tab">
      <div class="orbit" aria-hidden="true">
        <span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span>
        <span class="dot d4"></span><span class="dot d5"></span><span class="dot amber"></span>
        <span class="dot dark d6"></span><span class="dot dark d7"></span><span class="dot core"></span>
      </div>
      <h1>Where would you like to go?</h1>
      <p>Browse with a little more breathing room.</p>
      <form method="get" action="${form.action}">
        <label>
          <span aria-hidden="true">⌕</span>
          <input name="q" autocomplete="off" autofocus placeholder="Search the web" aria-label="Search the web" />
        </label>
      </form>
    </main>
  `, 'New Tab');
}

function htmlResponse(body: string, searchEngine: SearchEnginePreference): Response {
  const form = newTabSearchForm(searchEngine);
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src poppin: data:; form-action ${form.formActionOrigin}`,
    },
  });
}

function renderErrorPage(url: URL): string {
  const failedUrl = escapeHtml(url.searchParams.get('url') ?? 'this page');
  const description = escapeHtml(url.searchParams.get('description') ?? 'The page could not be reached.');
  return pageShell(`
    <main class="error-page">
      <div class="error-mark">!</div>
      <p class="eyebrow">PAGE UNAVAILABLE</p>
      <h1>We couldn’t open that.</h1>
      <p>${description}</p>
      <code>${failedUrl}</code>
      <a href="${failedUrl}">Try again</a>
    </main>
  `, 'Page unavailable');
}

function pageShell(content: string, title: string): string {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <style>
        :root { color: #181818; background: #fbf8f2; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 50% 42%, #fffdf9 0, #fbf8f2 58%, #f7f1e6 100%); }
        main { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; text-align: center; }
        h1 { margin: 24px 0 8px; font-size: clamp(28px, 3vw, 42px); font-weight: 620; letter-spacing: -.04em; }
        p { margin: 0; color: #77716a; font-size: 15px; }
        form { width: min(560px, 78vw); margin-top: 32px; }
        label { display: flex; gap: 12px; align-items: center; padding: 0 18px; height: 54px; border: 1px solid #e7dccb; border-radius: 18px; background: rgba(255,255,255,.74); box-shadow: 0 12px 36px rgba(65,45,20,.08); }
        label span { color: #bd6b0b; font-size: 24px; }
        input { width: 100%; border: 0; outline: 0; background: transparent; color: #1f1d1b; font: inherit; }
        input::placeholder { color: #aaa39a; }
        .orbit { position: relative; width: 92px; height: 82px; }
        .dot { position: absolute; display: block; border-radius: 999px; background: #f18a12; box-shadow: 0 4px 12px rgba(217,112,0,.16); }
        .d1 { width: 7px; height: 7px; left: 47px; top: 4px; } .d2 { width: 10px; height: 10px; left: 59px; top: 7px; }
        .d3 { width: 13px; height: 13px; left: 71px; top: 14px; } .d4 { width: 17px; height: 17px; left: 77px; top: 28px; }
        .d5 { width: 20px; height: 20px; left: 73px; top: 47px; } .amber { width: 24px; height: 24px; left: 60px; top: 61px; }
        .dark { background: #2e1b0d; } .d6 { width: 7px; height: 7px; left: 6px; top: 57px; } .d7 { width: 12px; height: 12px; left: 17px; top: 61px; }
        .core { width: 38px; height: 38px; left: 26px; top: 50px; background: #f4ddba; }
        .error-mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 16px; color: #b05c0b; background: #fff1df; font-size: 24px; }
        .error-page { max-width: 620px; margin: auto; }
        .error-page .eyebrow { margin-top: 20px; color: #bb6b15; font-size: 11px; font-weight: 700; letter-spacing: .16em; }
        code { max-width: min(560px, 80vw); overflow: hidden; margin-top: 20px; padding: 10px 14px; border-radius: 10px; color: #6f665c; background: #f3ede4; text-overflow: ellipsis; white-space: nowrap; }
        a { color: #8f4e0b; text-decoration: none; }
        .error-page > a { margin-top: 20px; padding: 10px 16px; border: 1px solid #dfcdb5; border-radius: 10px; background: #fffaf2; }
        .result-page { display: block; width: min(920px, 100%); min-height: 100vh; margin: auto; padding: clamp(36px, 7vw, 82px); text-align: left; }
        .result-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; padding-bottom: 30px; border-bottom: 1px solid #e7dccb; }
        .result-header h1 { max-width: 720px; margin: 7px 0 0; font-size: clamp(26px, 4vw, 44px); }
        .eyebrow { color: #b7650b; font-size: 11px; font-weight: 750; letter-spacing: .15em; }
        .result-state { flex: none; padding: 7px 10px; border-radius: 999px; color: #7a552b; background: #fff0dc; font-size: 11px; font-weight: 700; }
        .result-content { padding: 38px 0; }
        .result-content pre, details pre { margin: 0; color: #302b26; font: 15px/1.75 Inter, -apple-system, BlinkMacSystemFont, sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; }
        details { margin-bottom: 34px; padding: 18px; border: 1px solid #e7dccb; border-radius: 14px; background: rgba(255,255,255,.5); }
        summary { cursor: pointer; color: #6f5b43; font-size: 13px; font-weight: 700; }
        details .diff { max-height: 420px; margin-top: 16px; overflow: auto; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
        .sources { padding-top: 26px; border-top: 1px solid #e7dccb; }
        .sources h2 { margin: 0 0 14px; font-size: 14px; }
        .sources ul { margin: 0; padding-left: 20px; }
        .sources li { margin: 8px 0; color: #766f67; font-size: 13px; }
        .empty { font-size: 13px; }
      </style>
    </head>
    <body>${content}</body>
  </html>`;
}
