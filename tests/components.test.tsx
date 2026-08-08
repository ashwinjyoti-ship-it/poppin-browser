import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BrowserToolbar } from '../src/renderer/ui/BrowserToolbar';
import { TabStrip } from '../src/renderer/ui/TabStrip';
import { CommandBar } from '../src/renderer/ui/CommandBar';
import { ContextPane } from '../src/renderer/ui/ContextPane';
import { PaneResizer } from '../src/renderer/ui/PaneResizer';
import { DEFAULT_BROWSER_SETTINGS, type BrowserTabSnapshot } from '../src/shared/browser';
import type { TaskSnapshot } from '../src/shared/task';
import type { WorkspaceSnapshot } from '../src/shared/workspace';

const TAB: BrowserTabSnapshot = {
  id: 'tab-one',
  title: 'Poppin',
  url: 'https://example.com/',
  faviconUrls: [],
  pinned: false,
  groupId: null,
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
        groups={[]}
        activeTabId={TAB.id}
        onActivate={onActivate}
        onClose={onClose}
        onCreate={onCreate}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onShowGroupMenu={vi.fn()}
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
        tabs={[{ ...TAB, faviconUrls: ['https://example.com/missing-favicon.ico'] }]}
        groups={[]}
        activeTabId={TAB.id}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onShowGroupMenu={vi.fn()}
      />,
    );

    const favicon = container.querySelector<HTMLImageElement>('.tab-favicon');
    expect(favicon).not.toBeNull();
    fireEvent.error(favicon!);
    expect(container.querySelector('.tab-favicon')).toBeNull();
    expect(container.querySelector('.tab-icon svg')).not.toBeNull();
  });

  it('renders, renames, and collapses visually connected tab groups', async () => {
    const user = userEvent.setup();
    const onToggleGroup = vi.fn();
    const onRenameGroup = vi.fn();
    render(
      <TabStrip
        tabs={[
          { ...TAB, pinned: true },
          { ...TAB, id: 'grouped', title: 'Grouped page', groupId: 'group-one' },
          { ...TAB, id: 'grouped-two', title: 'Second grouped page', groupId: 'group-one' },
        ]}
        groups={[{ id: 'group-one', name: 'Research', color: 'blue', collapsed: false }]}
        activeTabId={TAB.id}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={onToggleGroup}
        onRenameGroup={onRenameGroup}
        onShowGroupMenu={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /poppin, pinned/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /close poppin/i })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /research tab group, 2 tabs/i })).toBeVisible();
    expect(screen.getAllByRole('tab', { name: /research group/i })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /rename research tab group/i }));
    const groupName = screen.getByRole('textbox', { name: /rename research tab group/i });
    await user.clear(groupName);
    await user.type(groupName, 'Launch{Enter}');
    expect(onRenameGroup).toHaveBeenCalledWith('group-one', 'Launch');
    await user.click(screen.getByRole('button', { name: /rename research tab group/i }));
    await user.clear(screen.getByRole('textbox', { name: /rename research tab group/i }));
    await user.type(screen.getByRole('textbox', { name: /rename research tab group/i }), 'Cancelled{Escape}');
    expect(onRenameGroup).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /collapse research tab group/i }));
    expect(onToggleGroup).toHaveBeenCalledWith('group-one');
  });

  it('keeps a collapsed group named and counted instead of rendering a blank chip', () => {
    render(
      <TabStrip
        tabs={[
          { ...TAB, id: 'grouped', title: 'Grouped page', groupId: 'group-one' },
          { ...TAB, id: 'grouped-two', title: 'Second grouped page', groupId: 'group-one' },
        ]}
        groups={[{ id: 'group-one', name: 'Research', color: 'green', collapsed: true }]}
        activeTabId="grouped"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onShowGroupMenu={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: /research tab group, 2 tabs/i })).toHaveTextContent('Research2');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand research tab group/i })).toHaveAttribute('aria-expanded', 'false');
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
        settings={DEFAULT_BROWSER_SETTINGS}
        settingsOpen={false}
        canReopenClosedTab={false}
        addressInputRef={ref}
        onAddressChange={vi.fn()}
        onAddressFocus={vi.fn()}
        onAddressBlur={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onReload={vi.fn()}
        onReopenClosedTab={vi.fn()}
        onSettingsOpenChange={vi.fn()}
        onUpdateSettings={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: /go back/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /go forward/i })).toBeEnabled();
    await user.type(screen.getByRole('textbox', { name: /address and search/i }), '{enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('opens browser settings and updates link behavior', async () => {
    const user = userEvent.setup();
    const onUpdateSettings = vi.fn();
    render(
      <BrowserToolbar
        activeTab={{ ...TAB, url: 'https://accounts.google.com/v3/signin/challenge/pk' }}
        address="https://accounts.google.com/v3/signin/challenge/pk"
        addressError=""
        settings={DEFAULT_BROWSER_SETTINGS}
        settingsOpen
        canReopenClosedTab={false}
        addressInputRef={{ current: null }}
        onAddressChange={vi.fn()}
        onAddressFocus={vi.fn()}
        onAddressBlur={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onReload={vi.fn()}
        onReopenClosedTab={vi.fn()}
        onSettingsOpenChange={vi.fn()}
        onUpdateSettings={onUpdateSettings}
        onSubmit={vi.fn()}
      />,
    );

    expect(await screen.findByRole('complementary', { name: /browser settings/i })).toBeVisible();
    await user.selectOptions(screen.getByLabelText(/links open in/i), 'new-tab');
    expect(onUpdateSettings).toHaveBeenCalledWith({ linkOpening: 'new-tab' });
  });
});

const READY_TASK: TaskSnapshot = {
  connection: {
    state: 'ready', message: 'Codex is ready.', accountLabel: 'tester@example.com',
    models: [{ id: 'gpt-test', name: 'GPT Test', description: 'Fixture', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high', isDefault: true }],
  },
  task: null,
};

const EMPTY_WORKSPACE: WorkspaceSnapshot = { workspace: null, documents: [], tabContexts: [], project: null, visualSelection: null };
const PROJECT_WORKSPACE: WorkspaceSnapshot = {
  ...EMPTY_WORKSPACE,
  workspace: { id: 'primary', name: 'Fixture', createdAt: '' },
  project: { repositoryPath: '/tmp/project', remote: null, branch: 'main', installCommand: '', devCommand: '', previewUrl: 'http://localhost:3000' },
};

describe('Codex controls', () => {
  it('sends the selected model, reasoning, and prompt', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    const onOverlayHeightChange = vi.fn();
    render(<CommandBar snapshot={READY_TASK} workspace={PROJECT_WORKSPACE} collapsed={false} onCollapseChange={vi.fn()} onCommand={onCommand} onOverlayHeightChange={onOverlayHeightChange} />);
    await user.type(screen.getByRole('textbox', { name: /prompt/i }), 'Make the button amber');
    await user.click(screen.getByRole('button', { name: /send to codex/i }));
    expect(screen.getByRole('region', { name: /task preflight/i })).toBeVisible();
    expect(onOverlayHeightChange).toHaveBeenLastCalledWith(160);
    await user.click(screen.getByRole('button', { name: /start code/i }));
    expect(onCommand).toHaveBeenCalledWith({
      type: 'startTask', prompt: 'Make the button amber', model: 'gpt-test', reasoningEffort: 'high', kind: 'code',
    });
  });

  it('starts requested browser work directly and reserves approval for critical actions', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    const onBrowserAgentCommand = vi.fn().mockResolvedValue({ ok: true, data: 'Visible mail page' });
    const workspace: WorkspaceSnapshot = {
      ...EMPTY_WORKSPACE,
      workspace: { id: 'primary', name: 'Fixture', createdAt: '' },
      tabContexts: [{ tabId: 'mail-tab', title: 'Inbox', url: 'https://mail.example.com', capturedText: 'A message', truncated: false, capturedAt: '' }],
    };
    render(<CommandBar snapshot={READY_TASK} workspace={workspace} collapsed={false} onCollapseChange={vi.fn()} onCommand={onCommand} />);
    await user.type(screen.getByRole('textbox', { name: /prompt/i }), 'Use browser use and draft and save a reply');
    await user.click(screen.getByRole('button', { name: /send to codex/i }));
    await waitFor(() => expect(onCommand).toHaveBeenCalledWith({
      type: 'startTask', prompt: 'Use browser use and draft and save a reply', model: 'gpt-test', reasoningEffort: 'high', kind: 'work',
    }));
    expect(screen.queryByRole('region', { name: /task preflight/i })).not.toBeInTheDocument();
    expect(onBrowserAgentCommand).not.toHaveBeenCalled();
  });

  it('sends a follow-up from a completed result without requiring approval', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    const snapshot: TaskSnapshot = {
      ...READY_TASK,
      task: {
        state: 'Completed', kind: 'work', prompt: 'First question', model: 'gpt-test', reasoningEffort: 'high',
        threadId: 'thread-1', turnId: 'turn-1', baselineCommit: '', progress: [], pendingApproval: null,
        result: 'First answer', diff: '', error: null,
        browserRun: { required: false, state: 'not-required', taskSpaceId: null, successfulActionCount: 0, retryCount: 0, lastActionAt: null },
        createdAt: '', updatedAt: '',
      },
    };
    render(<CommandBar snapshot={snapshot} workspace={EMPTY_WORKSPACE} collapsed={false} onCollapseChange={vi.fn()} onCommand={onCommand} />);
    const prompt = screen.getByRole('textbox', { name: /prompt/i });
    expect(prompt).toHaveAttribute('placeholder', expect.stringMatching(/same Codex conversation/i));
    await user.type(prompt, 'Tell me more');
    await user.click(screen.getByRole('button', { name: /send follow-up to codex/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'continueTask', prompt: 'Tell me more' });
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
        result: '', diff: '', error: null,
        browserRun: { required: false, state: 'not-required', taskSpaceId: null, successfulActionCount: 0, retryCount: 0, lastActionAt: null },
        createdAt: '', updatedAt: '',
      },
    };
    render(<ContextPane collapsed={false} snapshot={EMPTY_WORKSPACE} taskSnapshot={snapshot} onCollapseChange={vi.fn()} onRefreshTab={vi.fn()} onTaskCommand={onCommand} onOpenResult={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^task/i }));
    expect(screen.getByText('npm test', { exact: false })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /allow once/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'respondApproval', decision: 'accept' });
  });
});
