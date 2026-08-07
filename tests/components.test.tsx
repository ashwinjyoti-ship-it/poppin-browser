import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BrowserToolbar } from '../src/renderer/ui/BrowserToolbar';
import { TabStrip } from '../src/renderer/ui/TabStrip';
import { CommandBar } from '../src/renderer/ui/CommandBar';
import { ContextPane } from '../src/renderer/ui/ContextPane';
import type { BrowserTabSnapshot } from '../src/shared/browser';
import type { TaskSnapshot } from '../src/shared/task';
import type { WorkspaceSnapshot } from '../src/shared/workspace';

const TAB: BrowserTabSnapshot = {
  id: 'tab-one',
  title: 'Poppin',
  url: 'https://example.com/',
  faviconUrl: null,
  isLoading: false,
  canGoBack: false,
  canGoForward: true,
  failure: null,
};

describe('browser chrome', () => {
  it('activates, closes, and creates tabs accessibly', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(
      <TabStrip
        tabs={[TAB]}
        activeTabId={TAB.id}
        onActivate={onActivate}
        onClose={onClose}
        onCreate={onCreate}
      />,
    );

    await user.click(screen.getByRole('tab', { name: /poppin/i }));
    await user.click(screen.getByRole('button', { name: /close poppin/i }));
    await user.click(screen.getByRole('button', { name: /new tab/i }));
    expect(onActivate).toHaveBeenCalledWith(TAB.id);
    expect(onClose).toHaveBeenCalledWith(TAB.id);
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('reflects navigation availability and submits the address form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const ref = { current: null };
    render(
      <BrowserToolbar
        activeTab={TAB}
        address={TAB.url}
        addressError=""
        addressInputRef={ref}
        onAddressChange={vi.fn()}
        onAddressFocus={vi.fn()}
        onAddressBlur={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onReload={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: /go back/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /go forward/i })).toBeEnabled();
    await user.type(screen.getByRole('textbox', { name: /address and search/i }), '{enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

const READY_TASK: TaskSnapshot = {
  connection: {
    state: 'ready', message: 'Codex is ready.', accountLabel: 'tester@example.com',
    models: [{ id: 'gpt-test', name: 'GPT Test', description: 'Fixture', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high', isDefault: true }],
  },
  task: null,
};

const EMPTY_WORKSPACE: WorkspaceSnapshot = { workspace: null, documents: [], tabContexts: [], project: null };

describe('Codex controls', () => {
  it('sends the selected model, reasoning, and prompt', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    render(<CommandBar snapshot={READY_TASK} collapsed={false} onCollapseChange={vi.fn()} onCommand={onCommand} />);
    await user.type(screen.getByRole('textbox', { name: /prompt/i }), 'Make the button amber');
    await user.click(screen.getByRole('button', { name: /send to codex/i }));
    expect(onCommand).toHaveBeenCalledWith({
      type: 'startTask', prompt: 'Make the button amber', model: 'gpt-test', reasoningEffort: 'high',
    });
  });

  it('shows exactly what an approval will allow', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    const snapshot: TaskSnapshot = {
      ...READY_TASK,
      task: {
        state: 'Needs Approval', prompt: 'Change it', model: 'gpt-test', reasoningEffort: 'high',
        threadId: 'thread-1', turnId: 'turn-1', baselineCommit: 'a'.repeat(40), progress: [],
        pendingApproval: { requestId: 9, kind: 'command', title: 'Codex wants to run a command', detail: 'npm test\n/tmp/project', reason: 'Verify the change' },
        result: '', diff: '', error: null, createdAt: '', updatedAt: '',
      },
    };
    render(<ContextPane collapsed={false} snapshot={EMPTY_WORKSPACE} taskSnapshot={snapshot} onCollapseChange={vi.fn()} onRefreshTab={vi.fn()} onTaskCommand={onCommand} />);
    await user.click(screen.getByRole('button', { name: /^task/i }));
    expect(screen.getByText('npm test', { exact: false })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /allow once/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'respondApproval', decision: 'accept' });
  });
});
