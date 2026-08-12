import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const compiledMainPath = path.resolve('.webpack/arm64/main/index.js');
const DOWNLOAD_FIXTURE = Buffer.alloc(64 * 1024, 0x5a);
DOWNLOAD_FIXTURE.write('bvxn', 0);
const DOWNLOAD_FIXTURE_HASH = createHash('sha256').update(DOWNLOAD_FIXTURE).digest('hex');

let server: Server;
let origin: string;
let application: ElectronApplication | null = null;

beforeEach(async () => {
  server = createServer((request, response) => {
    const route = request.url ?? '/';
    if (route === '/favicon.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#e8820b"/></svg>');
      return;
    }
    if (route === '/fixture.dmg' || route.startsWith('/fixture.dmg?')) {
      response.writeHead(200, {
        'Content-Type': 'application/x-apple-diskimage',
        'Content-Disposition': 'attachment; filename="Poppin-Smoke-Fixture.dmg"',
        'Content-Length': String(DOWNLOAD_FIXTURE.length),
      });
      response.end(DOWNLOAD_FIXTURE);
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (route === '/second') {
      response.end('<!doctype html><title>Second page</title><h1>Second page</h1>');
      return;
    }
    if (route === '/popup') {
      response.end('<!doctype html><title>Popup page</title><h1>Popup page</h1>');
      return;
    }
    if (route === '/client-redirect') {
      response.end("<!doctype html><title>Redirecting</title><script>location.replace('/second')</script>");
      return;
    }
    if (route === '/fullscreen') {
      response.end(`<!doctype html><title>Fullscreen fixture</title>
        <button id="enter" onclick="document.documentElement.requestFullscreen()">Enter fullscreen</button>`);
      return;
    }
    if (route === '/agent') {
      response.end(`<!doctype html><title>Browser agent fixture</title><meta name="description" content="A metadata-first research fixture">
        <h1>Draft a reply</h1>
        <article><a href="/second" title="Research candidate">Research candidate</a><span>Fixture channel · 4 minutes</span></article>
        <button id="play" type="button" aria-label="Play" onclick="document.body.dataset.played='true'">Play</button>
        <textarea id="draft" aria-label="Reply body"></textarea>
        <button id="save" type="button" onclick="document.body.dataset.saved='true'">Save draft</button>
        <button id="send" type="button" onclick="document.body.dataset.sent='true'">Send reply</button>`);
      return;
    }
    if (route === '/oauth-start') {
      response.end(`<!doctype html><title>OAuth opener fixture</title>
        <h1>OAuth opener fixture</h1>
        <button id="signin" onclick="window.open('/oauth-popup', 'fixture-oauth', 'width=560,height=640')">Sign in</button>
        <script>addEventListener('message', (event) => { if (event.origin === location.origin && event.data === 'oauth-complete') document.body.dataset.auth = 'complete'; });</script>`);
      return;
    }
    if (route === '/oauth-popup') {
      response.end(`<!doctype html><title>Secure fixture sign-in</title>
        <h1>Secure fixture sign-in</h1>
        <button id="continue" onclick="window.open('/oauth-consent', 'fixture-oauth-consent', 'width=560,height=640')">Continue to permissions</button>`);
      return;
    }
    if (route === '/oauth-consent') {
      response.end(`<!doctype html><title>Fixture permissions</title>
        <h1>Fixture permissions</h1>
        <button id="complete" onclick="window.opener.opener.postMessage('oauth-complete', location.origin); window.close(); window.opener.close()">Allow and complete sign-in</button>`);
      return;
    }
    response.setHeader('Set-Cookie', 'poppin-session=restored; Path=/; SameSite=Lax');
    response.end(`<!doctype html>
      <link rel="icon" href="/favicon.svg">
      <title>Local fixture</title>
      <h1>Local fixture</h1>
      <a href="/second" id="second">Second page</a>
      <a href="http://localhost:${(server.address() as { port: number }).port}/second" id="external">External site</a>
      <a href="/fixture.dmg" id="download" download>Download fixture</a>
      <a href="/fixture.dmg" id="download-blank" target="_blank">Download fixture blank</a>
      <button id="popup" onclick="window.open('/popup', '_blank')">Open popup</button>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start.');
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (application) await application.close().catch(() => undefined);
  application = null;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function launch(userDataPath: string): Promise<{ app: ElectronApplication; shell: Page }> {
  const app = await electron.launch({
    args: [compiledMainPath, `--user-data-dir=${userDataPath}`],
  });
  await app.firstWindow();
  const existingShell = app.windows().find((page) => page.url().includes('/renderer/main_window/index.html'));
  const shell = existingShell ?? await app.waitForEvent('window', {
    predicate: (page) => page.url().includes('/renderer/main_window/index.html'),
  });
  await shell.getByLabel('Address and search').waitFor();
  return { app, shell };
}

async function pageInfo(app: ElectronApplication, urlPrefix: string) {
  return app.evaluate(async ({ webContents }, prefix) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().startsWith(prefix));
    if (!contents) return null;
    return contents.executeJavaScript(`({
      url: location.href,
      title: document.title,
      node: typeof window.process,
      bridge: typeof window.poppinBrowser
    })`);
  }, urlPrefix);
}

async function exactPageInfo(app: ElectronApplication, url: string) {
  return app.evaluate(async ({ webContents }, targetUrl) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl);
    if (!contents) return null;
    return contents.executeJavaScript(`({ url: location.href, title: document.title })`);
  }, url);
}

describe('packaged browser workflow', () => {
  it('navigates, opens popup tabs, isolates pages, and restores the session', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'poppin-smoke-'));
    const firstLaunch = await launch(userDataPath);
    application = firstLaunch.app;
    let shell = firstLaunch.shell;

    const newTabPage = application.windows().find((page) => page.url().startsWith('poppin://new-tab'));
    expect(newTabPage).toBeDefined();
    await expect.poll(() => newTabPage!.getByRole('heading', { name: /where would you like to go/i }).isVisible()).toBe(true);

    const address = shell.getByLabel('Address and search');
    await expect.poll(() => shell.getByRole('button', { name: 'Open Poppin Context' }).isVisible()).toBe(true);
    await shell.getByRole('button', { name: 'Open Poppin Context' }).click();
    const workspaceDivider = shell.getByRole('separator', { name: 'Resize Poppin Context pane' });
    const initialWorkspaceWidth = Number(await workspaceDivider.getAttribute('aria-valuenow'));
    const chromeHeight = await shell.locator('.app-shell').evaluate((element) => Number.parseInt(getComputedStyle(element).getPropertyValue('--chrome-height'), 10));
    const initialBrowserBounds = await activeBrowserViewBounds(application);
    expect(initialBrowserBounds.y).toBe(chromeHeight);
    await workspaceDivider.press('Shift+ArrowRight');
    const resizedWorkspaceWidth = initialWorkspaceWidth + 24;
    await expect.poll(() => workspaceDivider.getAttribute('aria-valuenow')).toBe(String(resizedWorkspaceWidth));
    await expect.poll(async () => (await activeBrowserViewBounds(application!)).x).toBe(initialBrowserBounds.x + 24);

    await address.fill(origin);
    await address.press('Enter');
    await expect.poll(() => pageInfo(application!, origin)).toMatchObject({
      title: 'Local fixture',
      node: 'undefined',
      bridge: 'undefined',
    });
    await expect.poll(() => shell.locator('.tab-active .tab-favicon').getAttribute('src')).toContain('/favicon.svg');

    await address.fill(`${origin}/fullscreen`);
    await address.press('Enter');
    await expect.poll(() => exactPageInfo(application!, `${origin}/fullscreen`)).toMatchObject({ title: 'Fullscreen fixture' });
    await application.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await application.evaluate(({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl);
      (contents as unknown as { emit(event: string): void })?.emit('enter-html-full-screen');
    }, `${origin}/fullscreen`);
    await expect.poll(
      () => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen()),
      { timeout: 5_000, interval: 100 },
    ).toBe(true);
    await expect.poll(async () => {
      const bounds = await activeBrowserViewBounds(application!);
      return bounds.x === 0 && bounds.y === 0;
    }).toBe(true);
    await application.evaluate(({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl);
      (contents as unknown as { emit(event: string): void })?.emit('leave-html-full-screen');
    }, `${origin}/fullscreen`);
    await expect.poll(
      () => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen()),
      { timeout: 5_000, interval: 100 },
    ).toBe(false);
    await address.fill(origin);
    await address.press('Enter');
    await expect.poll(() => exactPageInfo(application!, `${origin}/`)).toMatchObject({ title: 'Local fixture' });

    const boundsBeforeSettings = await activeBrowserViewBounds(application);
    await shell.getByRole('button', { name: 'Poppin settings' }).click();
    await expect.poll(() => shell.getByRole('button', { name: 'Poppin settings' }).getAttribute('aria-expanded')).toBe('true');
    const settingsOverlay = await settingsOverlayPage(application);
    const settingsPanel = settingsOverlay.getByRole('complementary', { name: 'Poppin settings' });
    await expect.poll(() => settingsPanel.isVisible()).toBe(true);
    expect(await activeBrowserViewBounds(application)).toEqual(boundsBeforeSettings);
    await settingsOverlay.getByLabel('Links open in').selectOption('same-tab');
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowser.getSnapshot()).settings.linkOpening)).toBe('same-tab');
    await settingsOverlay.getByRole('button', { name: 'Close Poppin settings' }).click();
    await expect.poll(() => shell.getByRole('button', { name: 'Poppin settings' }).getAttribute('aria-expanded')).toBe('false');
    expect(await activeBrowserViewBounds(application)).toEqual(boundsBeforeSettings);
    await application.evaluate(async ({ webContents }, prefix) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().startsWith(prefix));
      await contents?.executeJavaScript("document.querySelector('#popup').click()");
    }, origin);
    await expect.poll(() => exactPageInfo(application!, `${origin}/popup`)).toMatchObject({ title: 'Popup page' });
    expect(await shell.getByRole('tab').count()).toBe(1);
    await address.fill(origin);
    await address.press('Enter');
    await shell.getByRole('button', { name: 'Poppin settings' }).click();
    await expect.poll(() => shell.getByRole('button', { name: 'Poppin settings' }).getAttribute('aria-expanded')).toBe('true');
    await settingsOverlay.getByLabel('Links open in').selectOption('follow-site');
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowser.getSnapshot()).settings.linkOpening)).toBe('follow-site');
    await settingsOverlay.getByRole('button', { name: 'Close Poppin settings' }).click();

    await application.evaluate(async ({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl);
      await contents?.executeJavaScript("document.querySelector('#external').click()");
    }, `${origin}/`);
    await expect.poll(() => shell.getByRole('tab').count()).toBe(2);
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowser.getSnapshot()).linkPreview)).toBeNull();
    await shell.evaluate(async () => {
      const snapshot = await window.poppinBrowser.getSnapshot();
      await window.poppinBrowser.command({ type: 'close', tabId: snapshot.activeTabId });
    });
    await expect.poll(() => shell.getByRole('tab').count()).toBe(1);

    await address.fill(`${origin}/oauth-start`);
    await address.press('Enter');
    await expect.poll(() => exactPageInfo(application!, `${origin}/oauth-start`)).toMatchObject({ title: 'OAuth opener fixture' });
    await application.evaluate(async ({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl);
      await contents?.executeJavaScript("document.querySelector('#signin').click()");
    }, `${origin}/oauth-start`);
    await expect.poll(() => application!.windows().some((page) => page.url() === `${origin}/oauth-popup`)).toBe(true);
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowser.getSnapshot()).authenticationPopup?.url ?? null)).toBe(`${origin}/oauth-popup`);
    await expect.poll(() => shell.getByRole('region', { name: 'Secure sign-in overlay' }).isVisible()).toBe(true);
    const authPopup = application.windows().find((page) => page.url() === `${origin}/oauth-popup`)!;
    await authPopup.getByRole('button', { name: 'Continue to permissions' }).click();
    await expect.poll(() => application!.windows().some((page) => page.url() === `${origin}/oauth-consent`)).toBe(true);
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowser.getSnapshot()).authenticationPopup?.url ?? null)).toBe(`${origin}/oauth-consent`);
    const consentPopup = application.windows().find((page) => page.url() === `${origin}/oauth-consent`)!;
    await consentPopup.getByRole('button', { name: 'Allow and complete sign-in' }).click();
    await expect.poll(() => application!.evaluate(async ({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl);
      return contents?.executeJavaScript('document.body.dataset.auth || null');
    }, `${origin}/oauth-start`)).toBe('complete');
    await expect.poll(() => shell.getByRole('region', { name: 'Secure sign-in overlay' }).count()).toBe(0);

    await application.evaluate(async ({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl);
      await contents?.executeJavaScript("document.querySelector('#signin').click()");
    }, `${origin}/oauth-start`);
    await expect.poll(() => shell.getByRole('region', { name: 'Secure sign-in overlay' }).isVisible()).toBe(true);
    await shell.getByRole('region', { name: 'Secure sign-in overlay' }).getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => shell.getByRole('region', { name: 'Secure sign-in overlay' }).count()).toBe(0);

    await address.fill(origin);
    await address.press('Enter');
    await expect.poll(() => exactPageInfo(application!, `${origin}/`)).toMatchObject({ title: 'Local fixture' });

    const workspace = shell.getByRole('complementary', { name: 'Poppin Context' });
    await workspace.getByLabel('Workspace name').fill('Launch workspace');
    await workspace.getByRole('button', { name: 'Create workspace' }).click();
    await expect.poll(() => workspace.getByRole('heading', { name: 'Launch workspace' }).isVisible()).toBe(true);
    const workspaceBox = await workspace.boundingBox();
    expect(workspaceBox).not.toBeNull();
    const memoryActionBox = await workspace.getByRole('button', { name: /Open Memory/i }).boundingBox();
    expect(memoryActionBox).not.toBeNull();
    expect(memoryActionBox!.x).toBeGreaterThanOrEqual(workspaceBox!.x);
    expect(memoryActionBox!.x + memoryActionBox!.width).toBeLessThanOrEqual(workspaceBox!.x + workspaceBox!.width);
    expect(await workspace.getByRole('button', { name: 'Page', exact: true }).count()).toBe(0);
    expect(await workspace.getByRole('button', { name: 'Database', exact: true }).count()).toBe(0);
    const tabContextCheckbox = workspace.getByRole('checkbox', { name: 'Local fixture' });
    await tabContextCheckbox.click();
    await expect.poll(() => tabContextCheckbox.isChecked()).toBe(true);
    await expect.poll(() => workspace.locator('.context-preview pre').first().textContent()).toContain('Open popup');

    await address.fill(`${origin}/agent`);
    await address.press('Enter');
    await expect.poll(() => exactPageInfo(application!, `${origin}/agent`)).toMatchObject({ title: 'Browser agent fixture' });
    const agentTabId = await shell.evaluate(async () => (await window.poppinBrowser.getSnapshot()).activeTabId);
    expect(await shell.evaluate((tabId) => window.poppinBrowserAgent.command({ type: 'start', taskId: 'smoke-browser-task', mode: 'mixed', tabIds: [tabId] }), agentTabId)).toMatchObject({ ok: true });
    const agentTabsEntry = shell.getByRole('button', { name: /Agent Tabs · Browser task/ });
    await expect.poll(() => agentTabsEntry.isVisible()).toBe(true);
    expect(await agentTabsEntry.locator('.agent-tabs-entry-label').evaluate((element) => getComputedStyle(element).textOverflow)).toBe('ellipsis');
    const agentEntryBox = await agentTabsEntry.boundingBox();
    const agentCountBox = await agentTabsEntry.locator('.agent-tabs-entry-count').boundingBox();
    expect(agentEntryBox).not.toBeNull();
    expect(agentCountBox).not.toBeNull();
    expect(agentCountBox!.x + agentCountBox!.width).toBeLessThanOrEqual(agentEntryBox!.x + agentEntryBox!.width);
    await expect.poll(() => shell.evaluate(async () => {
      const agent = await window.poppinBrowserAgent.getSnapshot();
      const browser = await window.poppinBrowser.getSnapshot();
      return agent.watching && browser.activeTabId === agent.taskSpace?.explorationTabIds[0];
    })).toBe(true);
    await shell.getByRole('tab', { name: /Browser agent fixture/ }).first().click();
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowserAgent.getSnapshot()).watching)).toBe(false);
    await shell.getByRole('button', { name: /Agent Tabs · Browser task/ }).click();
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowserAgent.getSnapshot()).watching)).toBe(true);
    const agentScope = await shell.evaluate(async () => {
      const snapshot = await window.poppinBrowserAgent.getSnapshot();
      if (snapshot.taskSpace?.contextTabIds.length !== 1 || snapshot.taskSpace.explorationTabIds.length !== 1) throw new Error('Mixed Agent Tabs were not created.');
      return { taskSpaceId: snapshot.taskSpace.id, tabId: snapshot.taskSpace.contextTabIds[0]! };
    });
    await expect.poll(() => application!.evaluate(async ({ webContents }, targetUrl) => webContents.getAllWebContents()
      .filter((contents) => contents.getURL() === targetUrl).map((contents) => contents.isAudioMuted()), `${origin}/agent`)).toContain(true);
    const metadataResult = await shell.evaluate((scope) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'readMetadata' } }), agentScope);
    expect(metadataResult).toMatchObject({ ok: true, data: expect.stringContaining('A metadata-first research fixture') });
    expect(JSON.parse(metadataResult.data!) as { items: Array<{ title: string }> }).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ title: 'Research candidate' })]) });
    const openedTab = await shell.evaluate(({ scope, url }) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'openTab', url } }), { scope: agentScope, url: `${origin}/second` });
    expect(openedTab).toMatchObject({ ok: true, data: expect.stringContaining('tabId') });
    const openedTabId = (JSON.parse(openedTab.data!) as { tabId: string }).tabId;
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowserAgent.getSnapshot()).taskSpace?.explorationTabIds.length)).toBe(2);
    expect(await shell.evaluate(({ scope, tabId }) => window.poppinBrowserAgent.command({ type: 'act', taskSpaceId: scope.taskSpaceId, tabId, action: { type: 'closeTab' } }), { scope: agentScope, tabId: openedTabId })).toMatchObject({ ok: true });
    const readResult = await shell.evaluate((scope) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'read' } }), agentScope);
    expect(readResult).toMatchObject({ ok: true, data: expect.stringContaining('"snapshotId"') });
    const firstSemantic = JSON.parse(readResult.data!) as { snapshotId: string; nodes: Array<{ ref: string; role: string; locator?: string }> };
    const draftRef = firstSemantic.nodes.find((node) => node.locator === '#draft' || node.role === 'textbox')?.ref;
    expect(draftRef).toBeTruthy();
    expect(await shell.evaluate(({ scope, snapshotId, ref }) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'type', snapshotId, ref, text: 'A saved reply' } }), { scope: agentScope, snapshotId: firstSemantic.snapshotId, ref: draftRef! })).toMatchObject({ ok: true });
    const secondRead = await shell.evaluate((scope) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'read' } }), agentScope);
    const secondSemantic = JSON.parse(secondRead.data!) as { snapshotId: string; nodes: Array<{ ref: string; name: string; locator?: string }> };
    const saveRef = secondSemantic.nodes.find((node) => node.locator === '#save' || /^save$/i.test(node.name))?.ref;
    expect(saveRef).toBeTruthy();
    expect(await shell.evaluate(({ scope, snapshotId, ref }) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'click', snapshotId, ref } }), { scope: agentScope, snapshotId: secondSemantic.snapshotId, ref: saveRef! })).toMatchObject({ ok: true });
    await expect.poll(() => application!.evaluate(async ({ webContents }, targetUrl) => {
      const candidates = webContents.getAllWebContents().filter((candidate) => candidate.getURL() === targetUrl);
      return await Promise.all(candidates.map((contents) => contents.executeJavaScript(`({ draft: document.querySelector('#draft')?.value, saved: document.body.dataset.saved })`)));
    }, `${origin}/agent`)).toContainEqual({ draft: 'A saved reply', saved: 'true' });
    const thirdRead = await shell.evaluate((scope) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'read' } }), agentScope);
    const thirdSemantic = JSON.parse(thirdRead.data!) as { snapshotId: string; nodes: Array<{ ref: string; name: string; locator?: string }> };
    const sendRef = thirdSemantic.nodes.find((node) => node.locator === '#send' || /^send$/i.test(node.name))?.ref;
    expect(sendRef).toBeTruthy();
    expect(await shell.evaluate(({ scope, snapshotId, ref }) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'click', snapshotId, ref } }), { scope: agentScope, snapshotId: thirdSemantic.snapshotId, ref: sendRef! })).toEqual({ ok: false, message: 'Approval required.' });
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowserAgent.getSnapshot()).pendingApproval?.target ?? null)).toBe('Send reply');
    expect(await shell.evaluate(() => window.poppinBrowserAgent.command({ type: 'respondApproval', decision: 'reject' }))).toEqual({ ok: false, message: 'Browser action rejected by the user.' });
    await expect.poll(() => application!.evaluate(async ({ webContents }, targetUrl) => {
      const candidates = webContents.getAllWebContents().filter((candidate) => candidate.getURL() === targetUrl);
      return await Promise.all(candidates.map((contents) => contents.executeJavaScript('document.body.dataset.sent || null')));
    }, `${origin}/agent`)).not.toContain('true');
    expect(await shell.evaluate(() => window.poppinBrowserAgent.command({ type: 'resume' }))).toMatchObject({ ok: true });
    const playbackRead = await shell.evaluate((scope) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'read' } }), agentScope);
    const playbackSemantic = JSON.parse(playbackRead.data!) as { snapshotId: string; nodes: Array<{ ref: string; name: string; locator?: string }> };
    const playRef = playbackSemantic.nodes.find((node) => node.locator === '#play' || /^play$/i.test(node.name))?.ref;
    expect(playRef).toBeTruthy();
    expect(await shell.evaluate(({ scope, snapshotId, ref }) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'click', snapshotId, ref } }), { scope: agentScope, snapshotId: playbackSemantic.snapshotId, ref: playRef! })).toEqual({ ok: false, message: 'User takeover required.' });
    await expect.poll(() => shell.evaluate(async () => (await window.poppinBrowserAgent.getSnapshot()).taskSpace?.owner)).toBe('user');
    await expect.poll(() => application!.evaluate(async ({ webContents }, targetUrl) => webContents.getAllWebContents()
      .filter((contents) => contents.getURL() === targetUrl).map((contents) => contents.isAudioMuted()), `${origin}/agent`)).not.toContain(true);
    expect(await application!.evaluate(async ({ webContents }, targetUrl) => await Promise.all(webContents.getAllWebContents()
      .filter((contents) => contents.getURL() === targetUrl).map((contents) => contents.executeJavaScript('document.body.dataset.played || null'))), `${origin}/agent`)).not.toContain('true');
    expect(await shell.evaluate(() => window.poppinBrowserAgent.command({ type: 'stop' }))).toMatchObject({ ok: true });
    await expect.poll(() => application!.evaluate(async ({ webContents }, targetUrl) => webContents.getAllWebContents()
      .filter((contents) => contents.getURL() === targetUrl).map((contents) => contents.isAudioMuted()), `${origin}/agent`)).not.toContain(true);
    expect(await shell.evaluate(() => window.poppinBrowserAgent.command({ type: 'closeTaskTabs' }))).toMatchObject({ ok: true });

    expect(await shell.evaluate(() => window.poppinBrowserAgent.command({ type: 'start', taskId: 'smoke-browser-only-task', mode: 'browser-only', tabIds: [] }))).toMatchObject({ ok: true });
    const explorationScope = await shell.evaluate(async () => {
      const snapshot = await window.poppinBrowserAgent.getSnapshot();
      if (snapshot.taskSpace?.contextTabIds.length !== 0 || snapshot.taskSpace.explorationTabIds.length !== 1) throw new Error('Browser-only Agent Tab was not created.');
      return { taskSpaceId: snapshot.taskSpace.id, tabId: snapshot.taskSpace.explorationTabIds[0]! };
    });
    const explorationNavigation = await shell.evaluate(({ scope, url }) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'navigate', url } }), { scope: explorationScope, url: origin });
    if (!explorationNavigation.ok) throw new Error(explorationNavigation.message ?? 'Browser-only navigation failed.');
    const explorationRead = await shell.evaluate((scope) => window.poppinBrowserAgent.command({ type: 'act', ...scope, action: { type: 'read' } }), explorationScope);
    expect(explorationRead).toMatchObject({ ok: true, data: expect.stringContaining('Local fixture') });
    expect(await shell.evaluate(() => window.poppinBrowserAgent.command({ type: 'stop' }))).toMatchObject({ ok: true });
    expect(await shell.evaluate(() => window.poppinBrowserAgent.command({ type: 'closeTaskTabs' }))).toMatchObject({ ok: true });

    await shell.evaluate(async (url) => {
      const snapshot = await window.poppinBrowser.getSnapshot();
      await window.poppinBrowser.command({ type: 'navigate', tabId: snapshot.activeTabId, input: url });
    }, `${origin}/client-redirect`);
    await expect.poll(() => exactPageInfo(application!, `${origin}/second`)).toMatchObject({ title: 'Second page' });
    expect(await shell.getByRole('alert').count()).toBe(0);

    await shell.evaluate(async (url) => {
      const snapshot = await window.poppinBrowser.getSnapshot();
      await window.poppinBrowser.command({ type: 'navigate', tabId: snapshot.activeTabId, input: url });
    }, origin);
    await expect.poll(() => exactPageInfo(application!, `${origin}/`)).toMatchObject({ title: 'Local fixture' });

    await application.evaluate(async ({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl);
      await contents?.executeJavaScript("document.querySelector('#popup').click()");
    }, `${origin}/`);
    await expect.poll(() => shell.getByRole('tab').count()).toBe(2);
    await expect.poll(() => pageInfo(application!, `${origin}/popup`)).toMatchObject({ title: 'Popup page' });

    const groupedTabIds = await shell.evaluate(async () => {
      const before = await window.poppinBrowser.getSnapshot();
      const [first, second] = before.tabs;
      if (!first || !second) throw new Error('Grouping fixture requires two tabs.');
      await window.poppinBrowser.command({ type: 'createGroup', tabId: first.id });
      const grouped = await window.poppinBrowser.getSnapshot();
      const groupId = grouped.tabs.find((tab) => tab.id === first.id)?.groupId;
      if (!groupId) throw new Error('Group was not created.');
      await window.poppinBrowser.command({ type: 'moveToGroup', tabId: second.id, groupId });
      await window.poppinBrowser.command({ type: 'setGroupColor', groupId, color: 'green' });
      return [first.id, second.id];
    });
    await expect.poll(() => shell.getByRole('group', { name: /group 1 tab group, 2 tabs/i }).isVisible()).toBe(true);
    await expect.poll(() => shell.locator('.tab-grouped-green').count()).toBe(2);
    await shell.getByRole('button', { name: /rename group 1 tab group/i }).click();
    const renameGroup = shell.getByRole('textbox', { name: /rename group 1 tab group/i });
    await renameGroup.fill('Launch');
    await renameGroup.press('Enter');
    await shell.getByRole('button', { name: /collapse launch tab group/i }).click();
    await expect.poll(() => shell.getByRole('group', { name: /launch tab group, 2 tabs/i }).isVisible()).toBe(true);
    await expect.poll(() => shell.getByRole('tab').count()).toBe(0);
    await shell.getByRole('button', { name: /expand launch tab group/i }).click();
    await expect.poll(() => shell.getByRole('tab').count()).toBe(2);
    await shell.evaluate(async (tabIds) => {
      for (const tabId of tabIds) await window.poppinBrowser.command({ type: 'moveToGroup', tabId, groupId: null });
    }, groupedTabIds);

    await shell.getByRole('tab').first().click();
    await address.fill(`${origin}/second`);
    await address.press('Enter');
    await expect.poll(() => pageInfo(application!, `${origin}/second`)).toMatchObject({ title: 'Second page' });
    await expect.poll(() => shell.getByLabel('Go back').isEnabled()).toBe(true);
    await shell.getByLabel('Go back').click();
    await expect.poll(() => exactPageInfo(application!, `${origin}/`)).toMatchObject({ title: 'Local fixture' });

    await application.close();
    application = null;

    ({ app: application, shell } = await launch(userDataPath));
    await expect.poll(() => shell.getByRole('tab').count()).toBe(2);
    await shell.getByRole('button', { name: 'Open Poppin Context' }).click();
    await expect.poll(() => shell.getByRole('separator', { name: 'Resize Poppin Context pane' }).getAttribute('aria-valuenow')).toBe(String(resizedWorkspaceWidth));
    await expect.poll(() => shell.getByLabel('Poppin Context').getByRole('heading', { name: 'Launch workspace' }).isVisible()).toBe(true);
    const cookies = await application.evaluate(async ({ session }, fixtureOrigin) => {
      return session.fromPartition('persist:poppin-browser').cookies.get({ url: fixtureOrigin });
    }, origin);
    expect(cookies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'poppin-session', value: 'restored' })]),
    );
  });

  it('saves target=_blank DMG downloads completely under Downloads with a progress bar', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'poppin-smoke-dl-'));
    const launched = await launch(userDataPath);
    application = launched.app;
    const shell = launched.shell;
    const address = shell.getByLabel('Address and search');
    await address.fill(origin);
    await address.press('Enter');
    await expect.poll(() => pageInfo(application!, origin)).toMatchObject({ title: 'Local fixture' });

    await application.evaluate(({ webContents }, fixtureOrigin) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().startsWith(fixtureOrigin));
      return contents?.executeJavaScript("document.getElementById('download-blank').click()");
    }, origin);

    // Downloads live in a settings-adjacent popover (no viewport shelf). Wait for
    // the toolbar control to show activity, open it, then assert completion.
    const downloadsButton = shell.getByRole('button', { name: /downloads/i });
    await expect.poll(() => downloadsButton.isVisible()).toBe(true);
    await expect.poll(async () => {
      const label = await downloadsButton.getAttribute('aria-label');
      return Boolean(label && /\d/.test(label));
    }).toBe(true);
    await downloadsButton.click();
    await expect.poll(() => shell.getByRole('dialog', { name: /downloads/i }).isVisible()).toBe(true);
    await expect.poll(async () => {
      const snapshot = await shell.evaluate(async () => window.poppinDownloads.getSnapshot());
      return snapshot.items.some((item) => item.filename.includes('Poppin-Smoke-Fixture') && item.state === 'completed');
    }).toBe(true);

    const completed = await shell.evaluate(async () => {
      const snapshot = await window.poppinDownloads.getSnapshot();
      return snapshot.items.find((item) => item.state === 'completed') ?? null;
    });
    expect(completed).not.toBeNull();
    const bytes = await readFile(completed!.savePath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(DOWNLOAD_FIXTURE_HASH);
    expect(completed!.savePath.startsWith(path.join(homedir(), 'Downloads'))).toBe(true);
  });
});

async function activeBrowserViewBounds(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.contentView.children.length > 0);
    const child = window?.contentView.children.find((view) => view.getVisible());
    return child?.getBounds() ?? { x: -1, y: -1, width: -1, height: -1 };
  });
}

async function settingsOverlayPage(app: ElectronApplication) {
  await expect.poll(() => app.windows().some((page) => page.url().includes('/renderer/settings_overlay/index.html'))).toBe(true);
  return app.windows().find((page) => page.url().includes('/renderer/settings_overlay/index.html'))!;
}
