import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { _electron as electron } from 'playwright-core';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const compiledMainPath = path.join(root, '.webpack/arm64/main/index.js');
const outputPath = path.join(root, 'docs/screenshots/checkpoint-a-workspace-context.png');
const userDataPath = await mkdtemp(path.join(tmpdir(), 'poppin-checkpoint-a-'));

const server = createServer((request, response) => {
  const route = request.url ?? '/';
  const page = route === '/reference'
    ? { title: 'Design reference', eyebrow: 'Design', heading: 'Warm, spacious, deliberate.', body: 'The browser chrome stays quiet so the work remains central.' }
    : route === '/requirements'
      ? { title: 'Requirements', eyebrow: 'Brief', heading: 'One workflow. Nothing else.', body: 'Browse, collect context, connect the project, and hand the result to Codex.' }
      : { title: 'Poppin launch brief', eyebrow: 'Checkpoint A', heading: 'Browser first. Context visible.', body: 'This page is selected explicitly and frozen into the workspace context before anything is sent to Codex.' };
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html><head><title>${page.title}</title><style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fffaf2; color: #2d251e; font-family: -apple-system, sans-serif; }
    main { width: min(620px, 80vw); padding: 56px; border: 1px solid #eadfce; border-radius: 24px; background: white; box-shadow: 0 20px 60px rgba(70, 45, 20, .09); }
    span { color: #d57610; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 16px 0 12px; font-size: 42px; letter-spacing: -.04em; }
    p { color: #756a60; font-size: 17px; line-height: 1.6; }
  </style></head><body><main><span>${page.eyebrow}</span><h1>${page.heading}</h1><p>${page.body}</p></main></body></html>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Fixture server did not start.');
const origin = `http://127.0.0.1:${address.port}`;

let application;
try {
  application = await electron.launch({ args: [compiledMainPath, `--user-data-dir=${userDataPath}`] });
  await application.firstWindow();
  const shell = await waitForShell(application);
  const addressInput = shell.getByLabel('Address and search');
  await addressInput.waitFor({ timeout: 10_000 });
  await addressInput.fill(origin);
  await addressInput.press('Enter');
  await waitForPageTitle(application, origin, 'Poppin launch brief');
  await shell.getByLabel('Workspace name').fill('Poppin MVP');
  await shell.getByRole('button', { name: 'Create workspace' }).click();
  const workspace = shell.getByLabel('Workspace');
  const checkbox = workspace.getByRole('checkbox', { name: 'Poppin launch brief' });
  await checkbox.waitFor({ timeout: 10_000 });
  await checkbox.click();
  await shell.getByLabel('Context').getByText('Poppin launch brief', { exact: true }).waitFor({ timeout: 10_000 });
  await shell.getByRole('button', { name: 'New tab' }).click();
  await addressInput.fill(`${origin}/reference`);
  await addressInput.press('Enter');
  await waitForPageTitle(application, `${origin}/reference`, 'Design reference');
  await shell.getByRole('button', { name: 'New tab' }).click();
  await addressInput.fill(`${origin}/requirements`);
  await addressInput.press('Enter');
  await waitForPageTitle(application, `${origin}/requirements`, 'Requirements');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
  await delay(500);

  const swift = `import CoreGraphics
import Foundation
let target = Int32(CommandLine.arguments[1])!
let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for item in info where (item[kCGWindowOwnerPID as String] as? Int32) == target {
  if let number = item[kCGWindowNumber as String] { print(number); break }
}`;
  const { stdout } = await execFileAsync('swift', ['-e', swift, String(application.process().pid)]);
  const windowId = stdout.trim();
  if (!/^\d+$/.test(windowId)) throw new Error('Could not find the Poppin window.');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync('screencapture', ['-x', '-l', windowId, outputPath]);
  process.stdout.write(`${outputPath}\n`);
} finally {
  await application?.close().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
}

async function waitForPageTitle(application, prefix, expectedTitle) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const title = await application.evaluate(({ webContents }, urlPrefix) => {
      return webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(urlPrefix))?.getTitle() ?? '';
    }, prefix);
    if (title === expectedTitle) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expectedTitle}.`);
}

async function waitForShell(application) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const shell = application.windows().find((page) => page.url().includes('/renderer/main_window/index.html'));
    if (shell) return shell;
    await delay(100);
  }
  throw new Error('Timed out waiting for the Poppin shell.');
}
