// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { TaskStore } from '../src/main/task/task-store';
import type { TaskRecordSnapshot } from '../src/shared/task';

describe('task store', () => {
  it('round-trips the single task', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-task-store-'));
    const store = new TaskStore(path.join(directory, 'poppin.sqlite'));
    const task: TaskRecordSnapshot = {
      state: 'Needs Approval',
      kind: 'code',
      prompt: 'Change the button',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      threadId: 'thread-1',
      turnId: 'turn-1',
      baselineCommit: 'a'.repeat(40),
      progress: [{ id: 'item-1', kind: 'files', title: 'Edited files', detail: 'src/App.tsx', status: 'completed' }],
      pendingApproval: { requestId: 4, kind: 'command', title: 'Run command', detail: 'npm test', reason: 'Verify the change' },
      result: 'Implemented the change.',
      diff: 'diff --git a/src/App.tsx b/src/App.tsx',
      error: null,
      delivery: { branch: 'codex/task', commit: 'c'.repeat(40), remote: 'https://github.com/acme/repo.git', pushed: true, pullRequest: null, message: 'Pushed.' },
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:01:00.000Z',
    };
    store.save(task);
    expect(store.load()).toEqual(task);
    store.clear();
    expect(store.load()).toBeNull();
    store.close();
  });

  it('recovers safely from malformed persisted progress', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-task-corrupt-'));
    const databasePath = path.join(directory, 'poppin.sqlite');
    const store = new TaskStore(databasePath);
    const now = new Date().toISOString();
    store.save({
      state: 'Running', kind: 'code', prompt: 'Test', model: 'model', reasoningEffort: 'low', threadId: '', turnId: '',
      baselineCommit: 'b'.repeat(40), progress: [], pendingApproval: null, result: '', diff: '', error: null,
      createdAt: now, updatedAt: now,
    });
    store.close();

    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE active_task SET progress_json = 'nope'").run();
    database.close();
    const recovered = new TaskStore(databasePath);
    expect(recovered.load()).toBeNull();
    recovered.close();
  });
});
