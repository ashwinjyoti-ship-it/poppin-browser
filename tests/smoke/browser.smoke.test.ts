import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const compiledMainPath = path.resolve('.webpack/arm64/main/index.js');

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
    response.setHeader('Set-Cookie', 'poppin-session=restored; Path=/; SameSite=Lax');
    response.end(`<!doctype html>
      <link rel="icon" href="/favicon.svg">
      <title>Local fixture</title>
      <h1>Local fixture</h1>
      <a href="/second" id="second">Second page</a>
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

    expect(await shell.evaluate(() => window.poppinBrowser.command({ type: 'openTaskResult' }))).toMatchObject({ ok: true });
    await expect.poll(() => exactPageInfo(application!, 'poppin://task/current/result')).toMatchObject({ title: 'Task result' });
    await expect.poll(() => shell.getByRole('tab').count()).toBe(2);
    await shell.getByRole('button', { name: 'Close Task result' }).click();
    await expect.poll(() => shell.getByRole('tab').count()).toBe(1);

    const address = shell.getByLabel('Address and search');
    const workspaceDivider = shell.getByRole('separator', { name: 'Resize workspace pane' });
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
    await expect.poll(() => pageInfo(application!, origin)).toMatchObject({ title: 'Local fixture' });

    await shell.getByRole('button', { name: 'Collapse right pane' }).click();
    const collapsedRightPane = shell.getByLabel('Right pane collapsed');
    await expect.poll(() => collapsedRightPane.isVisible()).toBe(true);
    await shell.getByRole('button', { name: 'Browser settings' }).click();
    const settingsPanel = shell.getByRole('complementary', { name: 'Browser settings' });
    const railBox = await collapsedRightPane.boundingBox();
    const settingsBox = await settingsPanel.boundingBox();
    expect(railBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();
    await expect.poll(() => shell.evaluate(({ x, y }) => {
      return document.elementFromPoint(x, y)?.closest('.browser-settings-panel')?.getAttribute('aria-label') ?? null;
    }, { x: railBox!.x + railBox!.width / 2, y: Math.max(railBox!.y + 10, settingsBox!.y + 10) })).toBe('Browser settings');
    await shell.getByLabel('Links open in').selectOption('same-tab');
    await shell.getByRole('button', { name: 'Close browser settings' }).click();
    await shell.getByRole('button', { name: 'Open context and task pane' }).click();
    await application.evaluate(async ({ webContents }, prefix) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().startsWith(prefix));
      await contents?.executeJavaScript("document.querySelector('#popup').click()");
    }, origin);
    await expect.poll(() => exactPageInfo(application!, `${origin}/popup`)).toMatchObject({ title: 'Popup page' });
    expect(await shell.getByRole('tab').count()).toBe(1);
    await address.fill(origin);
    await address.press('Enter');
    await shell.getByRole('button', { name: 'Browser settings' }).click();
    await shell.getByLabel('Links open in').selectOption('follow-site');
    await shell.getByRole('button', { name: 'Close browser settings' }).click();

    const workspace = shell.getByLabel('Workspace');
    await workspace.getByLabel('Workspace name').fill('Launch workspace');
    await workspace.getByRole('button', { name: 'Create workspace' }).click();
    await expect.poll(() => workspace.getByRole('heading', { name: 'Launch workspace' }).isVisible()).toBe(true);
    const tabContextCheckbox = workspace.getByRole('checkbox', { name: 'Local fixture' });
    await tabContextCheckbox.click();
    await expect.poll(() => tabContextCheckbox.isChecked()).toBe(true);
    const context = shell.getByLabel('Context');
    await expect.poll(() => context.getByText('Local fixture', { exact: true }).count()).toBeGreaterThan(0);
    await expect.poll(() => context.locator('pre').first().textContent()).toContain('Open popup');

    await address.fill(`${origin}/client-redirect`);
    await address.press('Enter');
    await expect.poll(() => exactPageInfo(application!, `${origin}/second`)).toMatchObject({ title: 'Second page' });
    expect(await shell.getByRole('alert').count()).toBe(0);

    await address.fill(origin);
    await address.press('Enter');
    await expect.poll(() => pageInfo(application!, origin)).toMatchObject({ title: 'Local fixture' });

    await application.evaluate(async ({ webContents }, prefix) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().startsWith(prefix));
      await contents?.executeJavaScript("document.querySelector('#popup').click()");
    }, origin);
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
    await expect.poll(() => shell.getByRole('separator', { name: 'Resize workspace pane' }).getAttribute('aria-valuenow')).toBe(String(resizedWorkspaceWidth));
    await expect.poll(() => shell.getByLabel('Workspace').getByRole('heading', { name: 'Launch workspace' }).isVisible()).toBe(true);
    const cookies = await application.evaluate(async ({ session }, fixtureOrigin) => {
      return session.fromPartition('persist:poppin-browser').cookies.get({ url: fixtureOrigin });
    }, origin);
    expect(cookies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'poppin-session', value: 'restored' })]),
    );
  });
});

async function activeBrowserViewBounds(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const child = window?.contentView.children.find((view) => view.getVisible());
    return child?.getBounds() ?? { x: -1, y: -1, width: -1, height: -1 };
  });
}
