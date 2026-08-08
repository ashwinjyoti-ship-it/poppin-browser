// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { renderTaskResult } from '../src/main/browser/internal-pages';
import type { TaskRecordSnapshot } from '../src/shared/task';

describe('Work Result sources', () => {
  it('renders persisted Agent Tab sources and URLs returned in the answer', () => {
    const now = '2026-08-08T00:00:00.000Z';
    const task: TaskRecordSnapshot = {
      state: 'Completed', kind: 'work', prompt: 'Research guitars', model: 'gpt-test', reasoningEffort: 'high',
      threadId: 'thread-1', turnId: 'turn-1', baselineCommit: '', progress: [], pendingApproval: null,
      result: 'Compare https://shop.example/guitar and https://retailer.example/list.', diff: '', error: null,
      browserRun: {
        required: true, state: 'completed', taskSpaceId: 'space-1', successfulActionCount: 2,
        retryCount: 0, lastActionAt: now, sources: [{ title: 'Shop guitar', url: 'https://shop.example/guitar' }],
      },
      createdAt: now, updatedAt: now,
    };

    const html = renderTaskResult(task, null);
    expect(html).toContain('Shop guitar');
    expect(html).toContain('retailer.example');
    expect(html.match(/href="https:\/\/shop\.example\/guitar"/g)).toHaveLength(1);
    expect(html).not.toContain('No research sources were captured.');
  });
});
