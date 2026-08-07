// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { GitEngine } from '../src/main/project/git-engine';
import { TaskEngine } from '../src/main/task/task-engine';
import { TaskStore } from '../src/main/task/task-store';
import { WorkspaceStore } from '../src/main/workspace/workspace-store';

const execFileAsync = promisify(execFile);
const runLive = process.env.POPPIN_RUN_LIVE_CODEX === '1';

describe.skipIf(!runLive)('live Codex integration', () => {
  it('uses the signed-in local Codex runtime to modify a clean fixture repository', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-live-codex-'));
    const repositoryPath = path.join(directory, 'repo');
    const databasePath = path.join(directory, 'poppin.sqlite');
    const workspaceStore = new WorkspaceStore(databasePath);
    const taskStore = new TaskStore(databasePath);
    const window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: () => undefined },
    };
    const engine = new TaskEngine(
      window as unknown as Electron.BrowserWindow,
      taskStore,
      workspaceStore,
      new GitEngine(),
    );
    try {
      await execFileAsync('git', ['init', '-b', 'main', repositoryPath]);
      await writeFile(path.join(repositoryPath, 'README.md'), '# Poppin live Codex fixture\n');
      await execFileAsync('git', ['-C', repositoryPath, 'add', 'README.md']);
      await execFileAsync('git', ['-C', repositoryPath, '-c', 'user.name=Poppin Tests', '-c', 'user.email=tests@poppin.local', 'commit', '-m', 'initial']);
      workspaceStore.createWorkspace('Live Codex fixture');
      workspaceStore.saveProject({ repositoryPath, remote: null, branch: 'main', installCommand: '', devCommand: '', previewUrl: 'http://localhost:3000' });

      await engine.initialize();
      const connection = engine.getSnapshot().connection;
      expect(connection.state, connection.message).toBe('ready');
      const model = connection.models.find((candidate) => candidate.isDefault) ?? connection.models[0];
      expect(model).toBeDefined();
      const started = await engine.execute({
        type: 'startTask',
        prompt: 'Create a file named codex-proof.txt containing exactly: Poppin Codex integration works. Do not change any other file and do not run commands.',
        model: model?.id ?? '',
        reasoningEffort: model?.defaultReasoningEffort ?? '',
      });
      expect(started.ok, started.message).toBe(true);

      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const task = engine.getSnapshot().task;
        if (task?.pendingApproval) {
          const response = await engine.execute({ type: 'respondApproval', decision: 'accept' });
          expect(response.ok, response.message).toBe(true);
        } else if (task?.state === 'Needs Approval') {
          break;
        } else if (task?.state === 'Failed' || task?.state === 'Cancelled') {
          throw new Error(task.error ?? `Live task ended as ${task.state}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const task = engine.getSnapshot().task;
      expect(task?.state, task?.error ?? 'Codex did not finish before the timeout.').toBe('Needs Approval');
      expect((await readFile(path.join(repositoryPath, 'codex-proof.txt'), 'utf8')).trim()).toBe('Poppin Codex integration works.');
      expect(task?.diff).toContain('codex-proof.txt');
      expect((await engine.execute({ type: 'approveResult' })).ok).toBe(true);
    } finally {
      await engine.close();
      taskStore.close();
      workspaceStore.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 240_000);
});
