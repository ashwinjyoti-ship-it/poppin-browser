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
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (route === '/second') {
      response.end('<!doctype html><title>Second page</title><h1>Second page</h1>');
      return;
    }
    if (route === '/popup') {
      response.end('<!doctype html><title>Popup page</title><h1>Popup page</h1>');
      return;
    }
    response.setHeader('Set-Cookie', 'poppin-session=restored; Path=/; SameSite=Lax');
    response.end(`<!doctype html>
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

    const address = shell.getByLabel('Address and search');
    await address.fill(origin);
    await address.press('Enter');
    await expect.poll(() => pageInfo(application!, origin)).toMatchObject({
      title: 'Local fixture',
      node: 'undefined',
      bridge: 'undefined',
    });

    await application.evaluate(async ({ webContents }, prefix) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().startsWith(prefix));
      await contents?.executeJavaScript("document.querySelector('#popup').click()");
    }, origin);
    await expect.poll(() => shell.getByRole('tab').count()).toBe(2);
    await expect.poll(() => pageInfo(application!, `${origin}/popup`)).toMatchObject({ title: 'Popup page' });

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
    const cookies = await application.evaluate(async ({ session }, fixtureOrigin) => {
      return session.fromPartition('persist:poppin-browser').cookies.get({ url: fixtureOrigin });
    }, origin);
    expect(cookies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'poppin-session', value: 'restored' })]),
    );
  });
});
