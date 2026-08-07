import { describe, expect, it } from 'vitest';

import type { BrowserAgentSnapshot } from '../src/shared/browser-agent';
import type { TaskSnapshot } from '../src/shared/task';
import { browserApprovalAttentionKey, taskAttentionKey } from '../src/renderer/ui/task-attention';

const TASK_SNAPSHOT: TaskSnapshot = {
  connection: { state: 'ready', message: 'Codex is ready.', accountLabel: null, models: [] },
  task: {
    kind: 'work', state: 'Needs Approval', prompt: 'Summarize this', model: 'gpt-test', reasoningEffort: 'high',
    threadId: 'thread-1', turnId: 'turn-1', baselineCommit: '', progress: [], pendingApproval: null,
    result: 'Summary', diff: '', error: null, createdAt: '2026-08-07T12:00:00Z', updatedAt: '2026-08-07T12:01:00Z',
  },
};

const BROWSER_AGENT_SNAPSHOT: BrowserAgentSnapshot = {
  state: 'idle', taskId: null, allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null, log: [],
};

describe('task attention', () => {
  it('focuses actual task approvals but not the completed-result review state', () => {
    expect(taskAttentionKey(TASK_SNAPSHOT)).toBeNull();
    expect(taskAttentionKey({
      ...TASK_SNAPSHOT,
      task: {
        ...TASK_SNAPSHOT.task!,
        pendingApproval: { requestId: 42, kind: 'permissions', title: 'Permission needed', detail: '/tmp', reason: null },
      },
    })).toBe('approval:42');
  });

  it('focuses failures and browser-action approvals', () => {
    expect(taskAttentionKey({
      ...TASK_SNAPSHOT,
      task: { ...TASK_SNAPSHOT.task!, state: 'Failed' },
    })).toBe('failure:2026-08-07T12:01:00Z');
    expect(browserApprovalAttentionKey({
      ...BROWSER_AGENT_SNAPSHOT,
      state: 'needs-approval',
      pendingApproval: { actionId: 'action-7', title: 'Submit form', target: 'Send', scope: 'Selected tab', consequence: 'Sends data' },
    })).toBe('browser:action-7');
  });
});
