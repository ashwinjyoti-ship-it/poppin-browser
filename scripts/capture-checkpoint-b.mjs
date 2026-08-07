import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

import { _electron as electron } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const compiledMainPath = path.join(root, '.webpack/arm64/main/index.js');
const outputPath = path.join(root, 'docs/screenshots/checkpoint-b-codex-review.png');
const taskOutputPath = path.join(root, 'docs/screenshots/checkpoint-b-codex-task.png');
const userDataPath = await mkdtemp(path.join(tmpdir(), 'poppin-checkpoint-b-'));

const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html><head><title>Launch page</title><style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fffaf2; color: #2d251e; font-family: -apple-system, sans-serif; }
    main { width: min(620px, 80vw); padding: 56px; border: 1px solid #eadfce; border-radius: 24px; background: white; box-shadow: 0 20px 60px rgba(70,45,20,.09); }
    span { color: #d57610; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 16px 0 12px; font-size: 42px; letter-spacing: -.04em; }
    p { color: #756a60; font-size: 17px; line-height: 1.6; }
  </style></head><body><main><span>Codex result</span><h1>One change, ready to review.</h1><p>The browser remains central while Poppin shows the exact result and Git diff.</p></main></body></html>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Fixture server did not start.');
const origin = `http://127.0.0.1:${address.port}`;

await mkdir(userDataPath, { recursive: true });
await writeFile(path.join(userDataPath, 'browser-state.json'), `${JSON.stringify({
  version: 1,
  tabs: [{ id: 'fixture-tab', url: origin }],
  activeTabId: 'fixture-tab',
  window: { x: 80, y: 70, width: 1600, height: 980, isMaximized: false, isFullScreen: false },
}, null, 2)}\n`);
seedDatabase(path.join(userDataPath, 'poppin.sqlite'), root, origin);

let application;
try {
  application = await electron.launch({ args: [compiledMainPath, `--user-data-dir=${userDataPath}`] });
  await application.firstWindow();
  const shell = await waitForShell(application);
  await shell.getByRole('button', { name: /^Result$/ }).click();
  await shell.getByText('Review the change').waitFor({ timeout: 10_000 });
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.maximize();
    window?.focus();
  });
  await delay(700);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await shell.screenshot({ path: outputPath });
  await shell.getByRole('button', { name: /^Task/ }).click();
  await shell.getByText('tester@example.com').waitFor({ timeout: 10_000 }).catch(() => undefined);
  await delay(250);
  await shell.screenshot({ path: taskOutputPath });
  process.stdout.write(`${outputPath}\n${taskOutputPath}\n`);
} finally {
  await application?.close().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
}

function seedDatabase(filePath, repositoryPath, url) {
  const database = new DatabaseSync(filePath);
  database.exec(`
    CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    CREATE TABLE documents (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL, selected INTEGER NOT NULL DEFAULT 0, captured_text TEXT, truncated INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE tab_context (tab_id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, captured_text TEXT NOT NULL, truncated INTEGER NOT NULL DEFAULT 0, captured_at TEXT NOT NULL) STRICT;
    CREATE TABLE project (id TEXT PRIMARY KEY, repository_path TEXT NOT NULL, remote TEXT, branch TEXT NOT NULL, install_command TEXT NOT NULL DEFAULT '', dev_command TEXT NOT NULL DEFAULT '', preview_url TEXT NOT NULL) STRICT;
    CREATE TABLE active_task (id TEXT PRIMARY KEY, state TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT NOT NULL, reasoning_effort TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, baseline_commit TEXT NOT NULL, progress_json TEXT NOT NULL, approval_json TEXT, result TEXT NOT NULL, diff TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
  `);
  const now = new Date().toISOString();
  database.prepare('INSERT INTO workspace VALUES (?, ?, ?)').run('primary', 'Poppin MVP', now);
  database.prepare('INSERT INTO tab_context VALUES (?, ?, ?, ?, ?, ?)').run('fixture-tab', 'Launch page', url, 'One change, ready to review. The browser remains central while Poppin shows the exact result and Git diff.', 0, now);
  database.prepare('INSERT INTO project VALUES (?, ?, ?, ?, ?, ?, ?)').run('primary', repositoryPath, 'https://github.com/ashwinjyoti-ship-it/poppin-browser.git', 'main', 'npm install', 'npm run dev', 'http://localhost:3000');
  const progress = JSON.stringify([
    { id: 'plan', kind: 'plan', title: 'Plan', detail: 'Update the primary action and verify the focused component.', status: 'completed' },
    { id: 'files', kind: 'files', title: 'Changed project files', detail: '1 file change', status: 'completed' },
    { id: 'test', kind: 'command', title: 'npm test', detail: '28 tests passed', status: 'completed' },
  ]);
  const diff = `diff --git a/src/renderer/ui/PrimaryAction.tsx b/src/renderer/ui/PrimaryAction.tsx
index 4e32f1a..9c2f440 100644
--- a/src/renderer/ui/PrimaryAction.tsx
+++ b/src/renderer/ui/PrimaryAction.tsx
@@ -8,5 +8,5 @@ export function PrimaryAction() {
-  return <button className="secondary">Continue</button>;
+  return <button className="primary">Continue with Poppin</button>;
 }`;
  database.prepare('INSERT INTO active_task VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'primary', 'Needs Approval', 'Make the primary action clearer and use the amber accent.', 'gpt-5.6-sol', 'high',
    'fixture-thread', 'fixture-turn', 'a'.repeat(40), progress, null,
    'Updated the primary action label and applied the existing amber primary-button treatment. Focused tests pass.', diff, null, now, now,
  );
  database.close();
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
