import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BrowserToolbar } from '../src/renderer/ui/BrowserToolbar';
import { TabStrip } from '../src/renderer/ui/TabStrip';
import { CommandBar } from '../src/renderer/ui/CommandBar';
import { ContextPane } from '../src/renderer/ui/ContextPane';
import { PaneResizer } from '../src/renderer/ui/PaneResizer';
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
  it('resizes a pane from the keyboard and resets it accessibly', async () => {
    const user = userEvent.setup();
    const onResize = vi.fn();
    render(<PaneResizer side="left" width={300} minimum={240} maximum={480} onResize={onResize} />);

    const separator = screen.getByRole('separator', { name: /resize workspace pane/i });
    separator.focus();
    await user.keyboard('{ArrowRight}');
    expect(onResize).toHaveBeenLastCalledWith(308);
    await user.dblClick(separator);
    expect(onResize).toHaveBeenLastCalledWith(286);
  });

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

  it('keeps the globe fallback when a tab favicon cannot load', () => {
    const { container } = render(
      <TabStrip
        tabs={[{ ...TAB, faviconUrl: 'https://example.com/missing-favicon.ico' }]}
        activeTabId={TAB.id}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    const favicon = container.querySelector<HTMLImageElement>('.tab-favicon');
    expect(favicon).not.toBeNull();
    fireEvent.error(favicon!);
    expect(favicon).toHaveAttribute('hidden');
    expect(container.querySelector('.tab-icon svg')).not.toBeNull();
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
        googleSignInHelp={false}
        addressInputRef={ref}
        onAddressChange={vi.fn()}
        onAddressFocus={vi.fn()}
        onAddressBlur={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onReload={vi.fn()}
        onShowGoogleSignInAlternatives={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: /go back/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /go forward/i })).toBeEnabled();
    await user.type(screen.getByRole('textbox', { name: /address and search/i }), '{enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('offers a safe fallback when Google selects an unavailable passkey flow', async () => {
    const user = userEvent.setup();
    const onShowGoogleSignInAlternatives = vi.fn();
    render(
      <BrowserToolbar
        activeTab={{ ...TAB, url: 'https://accounts.google.com/v3/signin/challenge/pk' }}
        address="https://accounts.google.com/v3/signin/challenge/pk"
        addressError=""
        googleSignInHelp
        addressInputRef={{ current: null }}
        onAddressChange={vi.fn()}
        onAddressFocus={vi.fn()}
        onAddressBlur={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onReload={vi.fn()}
        onShowGoogleSignInAlternatives={onShowGoogleSignInAlternatives}
        onSubmit={vi.fn()}
      />,
    );

    expect(await screen.findByRole('complementary', { name: /google sign-in guidance/i })).toBeVisible();
    expect(screen.getByText(/separate secure browser session/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /show other methods/i }));
    expect(onShowGoogleSignInAlternatives).toHaveBeenCalledOnce();
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
const PROJECT_WORKSPACE: WorkspaceSnapshot = {
  ...EMPTY_WORKSPACE,
  workspace: { id: 'primary', name: 'Fixture', createdAt: '' },
  project: { repositoryPath: '/tmp/project', remote: null, branch: 'main', installCommand: '', devCommand: '', previewUrl: 'http://localhost:3000' },
};

describe('Codex controls', () => {
  it('sends the selected model, reasoning, and prompt', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    render(<CommandBar snapshot={READY_TASK} workspace={PROJECT_WORKSPACE} collapsed={false} onCollapseChange={vi.fn()} onCommand={onCommand} />);
    await user.type(screen.getByRole('textbox', { name: /prompt/i }), 'Make the button amber');
    await user.click(screen.getByRole('button', { name: /send to codex/i }));
    expect(screen.getByRole('region', { name: /task preflight/i })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /start code/i }));
    expect(onCommand).toHaveBeenCalledWith({
      type: 'startTask', prompt: 'Make the button amber', model: 'gpt-test', reasoningEffort: 'high', kind: 'code',
    });
  });

  it('shows exactly what an approval will allow', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    const snapshot: TaskSnapshot = {
      ...READY_TASK,
      task: {
        state: 'Needs Approval', kind: 'code', prompt: 'Change it', model: 'gpt-test', reasoningEffort: 'high',
        threadId: 'thread-1', turnId: 'turn-1', baselineCommit: 'a'.repeat(40), progress: [],
        pendingApproval: { requestId: 9, kind: 'command', title: 'Codex wants to run a command', detail: 'npm test\n/tmp/project', reason: 'Verify the change' },
        result: '', diff: '', error: null, createdAt: '', updatedAt: '',
      },
    };
    render(<ContextPane collapsed={false} snapshot={EMPTY_WORKSPACE} taskSnapshot={snapshot} onCollapseChange={vi.fn()} onRefreshTab={vi.fn()} onTaskCommand={onCommand} onOpenResult={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^task/i }));
    expect(screen.getByText('npm test', { exact: false })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /allow once/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'respondApproval', decision: 'accept' });
  });
});
