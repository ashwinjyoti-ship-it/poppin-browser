import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AgentDock } from '../src/renderer/ui/AgentDock';
import type { TaskRecordSnapshot, TaskSnapshot } from '../src/shared/task';
import type { BrowserAgentSnapshot } from '../src/shared/browser-agent';

const READY_CONNECTION = { state: 'ready' as const, message: 'Codex is ready.', accountLabel: 'tester@example.com', models: [] };
const EMPTY_BROWSER_AGENT: BrowserAgentSnapshot = { state: 'idle', taskId: null, taskSpace: null, watching: false, allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null, log: [] };

function taskWith(overrides: Partial<TaskRecordSnapshot>): TaskSnapshot {
  return {
    connection: READY_CONNECTION,
    task: {
      state: 'Running', kind: 'work', prompt: 'Research guitars', model: 'gpt-test', reasoningEffort: 'high',
      documentId: 'doc-1', threadId: 'thread-1', turnId: 'turn-1', baselineCommit: '', progress: [], pendingApproval: null,
      result: '', diff: '', error: null,
      browserRun: { required: false, state: 'not-required', taskSpaceId: null, successfulActionCount: 0, retryCount: 0, lastActionAt: null, sources: [] },
      createdAt: '', updatedAt: '',
      ...overrides,
    },
  };
}

describe('AgentDock', () => {
  it('renders nothing when there is no task', () => {
    const { container } = render(<AgentDock taskSnapshot={{ connection: READY_CONNECTION, task: null }} onTaskCommand={vi.fn()} onOpenTaskTab={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a quiet status pill while a turn is running, and opens the task tab on click', async () => {
    const user = userEvent.setup();
    const onOpenTaskTab = vi.fn();
    render(<AgentDock taskSnapshot={taskWith({ state: 'Running' })} onTaskCommand={vi.fn()} onOpenTaskTab={onOpenTaskTab} />);
    await user.click(screen.getByRole('button', { name: /the agent is working/i }));
    expect(onOpenTaskTab).toHaveBeenCalled();
  });

  it('prioritizes a blocking question with an "open task tab" escape hatch instead of a cramped inline field', () => {
    const onOpenTaskTab = vi.fn();
    render(<AgentDock
      taskSnapshot={taskWith({ state: 'Needs Approval', pendingApproval: { requestId: 1, kind: 'question', title: 'Which city?', detail: '', reason: null } })}
      onTaskCommand={vi.fn()}
      onOpenTaskTab={onOpenTaskTab}
    />);
    expect(screen.getByText('Which city?')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open task tab/i })).toBeVisible();
  });

  it('answers a task approval directly from the dock', async () => {
    const user = userEvent.setup();
    const onTaskCommand = vi.fn().mockResolvedValue({ ok: true });
    render(<AgentDock
      taskSnapshot={taskWith({ state: 'Needs Approval', pendingApproval: { requestId: 2, kind: 'command', title: 'Run npm test?', detail: '', reason: null } })}
      onTaskCommand={onTaskCommand}
      onOpenTaskTab={vi.fn()}
    />);
    await user.click(screen.getByRole('button', { name: /allow/i }));
    expect(onTaskCommand).toHaveBeenCalledWith({ type: 'respondApproval', decision: 'accept' });
  });

  it('surfaces a browser approval ahead of a generic running status', async () => {
    const user = userEvent.setup();
    const onBrowserAgentCommand = vi.fn().mockResolvedValue({ ok: true });
    const browserAgentSnapshot: BrowserAgentSnapshot = {
      ...EMPTY_BROWSER_AGENT, state: 'needs-approval',
      pendingApproval: { actionId: 'a1', title: 'Submit login', target: 'Login button', scope: 'tab-1', consequence: 'Signs the user in.' },
    };
    render(<AgentDock taskSnapshot={taskWith({ state: 'Running' })} browserAgentSnapshot={browserAgentSnapshot} onTaskCommand={vi.fn()} onBrowserAgentCommand={onBrowserAgentCommand} onOpenTaskTab={vi.fn()} />);
    expect(screen.getByText('Signs the user in.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(onBrowserAgentCommand).toHaveBeenCalledWith({ type: 'respondApproval', decision: 'approve' });
  });

  it('offers Keep/Close tabs once browsing finishes, reachable from any tab', async () => {
    const user = userEvent.setup();
    const onBrowserAgentCommand = vi.fn().mockResolvedValue({ ok: true });
    const browserAgentSnapshot: BrowserAgentSnapshot = { ...EMPTY_BROWSER_AGENT, state: 'completed' };
    render(<AgentDock taskSnapshot={taskWith({ state: 'Completed' })} browserAgentSnapshot={browserAgentSnapshot} onTaskCommand={vi.fn()} onBrowserAgentCommand={onBrowserAgentCommand} onOpenTaskTab={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /keep tabs/i }));
    expect(onBrowserAgentCommand).toHaveBeenCalledWith({ type: 'keepTabs' });
  });

  it('shows a quiet completion pill once everything is resolved', () => {
    render(<AgentDock taskSnapshot={taskWith({ state: 'Completed' })} onTaskCommand={vi.fn()} onOpenTaskTab={vi.fn()} />);
    expect(screen.getByRole('button', { name: /task complete · view/i })).toBeVisible();
  });
});
