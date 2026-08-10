import { describe, expect, it } from 'vitest';

import { getAgentDockPresentation, getTaskTabStatus } from '../src/renderer/ui/task-surface';
import type { BrowserAgentSnapshot, BrowserTaskSpace } from '../src/shared/browser-agent';
import type { TaskRecordSnapshot, TaskSnapshot } from '../src/shared/task';

const TASK_SPACE: BrowserTaskSpace = {
  id: 'space-1', taskId: 'task-1', name: 'Research', mode: 'browser-only', owner: 'agent', status: 'agent-controlling',
  tabIds: ['agent-tab'], contextTabIds: [], explorationTabIds: ['agent-tab'], activeTabId: 'agent-tab', createdAt: '', updatedAt: '', kept: false,
};
const BROWSER_AGENT: BrowserAgentSnapshot = {
  state: 'running', taskId: 'task-1', taskSpace: TASK_SPACE, watching: true, allowedTabIds: ['agent-tab'], activeTabId: 'agent-tab', currentAction: null, pendingApproval: null, log: [],
};
const TASK: TaskRecordSnapshot = {
  state: 'Running', kind: 'work', prompt: 'Research guitars', model: 'gpt-test', reasoningEffort: 'high', documentId: 'doc-1', threadId: 'thread-1', turnId: 'turn-1',
  baselineCommit: '', progress: [], pendingApproval: null, result: '', diff: '', error: null,
  browserRun: { required: true, state: 'awaiting-action', taskSpaceId: 'space-1', successfulActionCount: 0, retryCount: 0, lastActionAt: null, sources: [] }, createdAt: '', updatedAt: '',
};
const TASK_SNAPSHOT: TaskSnapshot = { connection: { state: 'ready', message: 'Ready', accountLabel: null, models: [] }, task: TASK };

function presentation(overrides: Partial<Parameters<typeof getAgentDockPresentation>[0]> = {}) {
  return getAgentDockPresentation({
    taskSnapshot: TASK_SNAPSHOT,
    browserAgentSnapshot: BROWSER_AGENT,
    activeBrowserTaskSpaceId: null,
    taskTabActive: false,
    commandCollapsed: false,
    ...overrides,
  });
}

describe('task surface presentation', () => {
  it('does not reserve bottom space on manual or Tandem tabs for passive task state', () => {
    expect(presentation()).toBe('hidden');
    expect(presentation({ taskSnapshot: { ...TASK_SNAPSHOT, task: { ...TASK, state: 'Completed' } } })).toBe('hidden');
  });

  it('shows running status and cleanup only on the active Agent Tab', () => {
    expect(presentation({ activeBrowserTaskSpaceId: 'space-1' })).toBe('pill');
    expect(presentation({
      activeBrowserTaskSpaceId: 'space-1',
      taskSnapshot: { ...TASK_SNAPSHOT, task: { ...TASK, state: 'Completed' } },
      browserAgentSnapshot: { ...BROWSER_AGENT, state: 'completed', taskSpace: { ...TASK_SPACE, owner: 'user', status: 'completed' } },
    })).toBe('card');
  });

  it('keeps blocking approvals reachable from a manual tab but avoids duplicating them in the task tab', () => {
    const approvalTask = { ...TASK, state: 'Needs Approval' as const, pendingApproval: { requestId: 1, kind: 'question' as const, title: 'Which city?', detail: '', reason: null } };
    expect(presentation({ taskSnapshot: { ...TASK_SNAPSHOT, task: approvalTask } })).toBe('card');
    expect(presentation({ taskSnapshot: { ...TASK_SNAPSHOT, task: approvalTask }, taskTabActive: true })).toBe('hidden');
  });

  it('maps task lifecycle to persistent tab status', () => {
    expect(getTaskTabStatus(TASK)).toBe('working');
    expect(getTaskTabStatus({ ...TASK, state: 'Needs Approval' })).toBe('attention');
    expect(getTaskTabStatus({ ...TASK, state: 'Completed' })).toBe('complete');
    expect(getTaskTabStatus({ ...TASK, state: 'Failed' })).toBe('failed');
    expect(getTaskTabStatus({ ...TASK, state: 'Cancelled' })).toBe('cancelled');
    expect(getTaskTabStatus({ ...TASK, state: 'Discarded' })).toBe('discarded');
  });
});
