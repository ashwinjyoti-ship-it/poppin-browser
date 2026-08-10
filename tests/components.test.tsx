import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BrowserToolbar } from '../src/renderer/ui/BrowserToolbar';
import { TabStrip } from '../src/renderer/ui/TabStrip';
import { CommandBar } from '../src/renderer/ui/CommandBar';
import { TaskTabView } from '../src/renderer/ui/TaskTabView';
import { TandemSection } from '../src/renderer/ui/TandemSection';
import { ProjectSection } from '../src/renderer/ui/ProjectSection';
import { PaneResizer } from '../src/renderer/ui/PaneResizer';
import { DEFAULT_BROWSER_SETTINGS, type BrowserTabSnapshot } from '../src/shared/browser';
import type { TaskSnapshot } from '../src/shared/task';
import type { WorkspaceSnapshot } from '../src/shared/workspace';
import { EMPTY_TANDEM_SNAPSHOT } from '../src/shared/tandem';

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

  it('keeps a long Agent Tabs title intentionally truncated without clipping its count', () => {
    const { container } = render(
      <TabStrip
        tabs={[TAB]}
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
        agentTaskSpace={{ id: 'space-1', taskId: 'task-1', name: 'Search for acoustic guitars under ₹10,000 and tell me where I can buy them.', mode: 'browser-only', owner: 'agent', status: 'agent-controlling', tabIds: ['agent-tab'], contextTabIds: [], explorationTabIds: ['agent-tab'], activeTabId: 'agent-tab', createdAt: '', updatedAt: '', kept: false }}
        watchingAgentTabs
        onWatchAgentTabs={vi.fn()}
      />,
    );
    const entry = screen.getByRole('button', { name: /Agent Tabs · Search for acoustic guitars/i });
    expect(entry).toHaveAttribute('title', 'Agent Tabs · Search for acoustic guitars under ₹10,000 and tell me where I can buy them.');
    expect(container.querySelector('.agent-tabs-entry-label')).toHaveTextContent('Search for acoustic guitars under ₹10,000');
    expect(container.querySelector('.agent-tabs-entry-count')).toHaveTextContent('1');
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

  it('tints the task tab like the agent-owned browsing tabs and keeps it closable', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <TabStrip
        tabs={[
          { id: 'agent-ctx', title: 'Docs', kind: 'browser', taskSpaceId: 'space-1' },
          { id: 'task-reply', title: 'Reply', kind: 'task', taskKind: 'work', taskSpaceId: 'space-1' },
        ]}
        groups={[]}
        activeTabId="task-reply"
        onActivate={onActivate}
        onClose={onClose}
        onCreate={vi.fn()}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onShowGroupMenu={vi.fn()}
      />,
    );
    const tabs = container.querySelectorAll('.tab-agent');
    expect(tabs).toHaveLength(2);
    const closeButton = screen.getByRole('button', { name: /close reply/i });
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledWith('task-reply');
  });

  it('uses the persistent task tab as the accessible completion indicator', () => {
    const { container } = render(
      <TabStrip
        tabs={[{ id: 'task-reply', title: 'Reply', kind: 'task', taskKind: 'work', taskStatus: 'complete', taskSpaceId: 'task-only' }]}
        groups={[]}
        activeTabId="another-tab"
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
    expect(screen.getByRole('tab', { name: 'Reply, task completed' })).toBeVisible();
    expect(container.querySelector('.tab-task-status-complete')).not.toBeNull();
    expect(screen.queryByText(/task complete · view/i)).not.toBeInTheDocument();
  });

  it('docks Agent Tabs and the reply tab to the right, separate from ordinary browsing tabs', () => {
    const { container } = render(
      <TabStrip
        tabs={[
          TAB,
          { id: 'agent-ctx', title: 'Docs', kind: 'browser', taskSpaceId: 'space-1' },
          { id: 'task-reply', title: 'Reply', kind: 'task', taskKind: 'work', taskSpaceId: 'space-1' },
        ]}
        groups={[]}
        activeTabId="task-reply"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onShowGroupMenu={vi.fn()}
        agentTaskSpace={{ id: 'space-1', taskId: 'task-1', name: 'Browser task', mode: 'mixed', owner: 'agent', status: 'agent-controlling', tabIds: ['agent-ctx'], contextTabIds: ['agent-ctx'], explorationTabIds: [], activeTabId: 'agent-ctx', createdAt: '', updatedAt: '', kept: false }}
      />,
    );
    const ordinaryStrip = container.querySelector('.tab-strip');
    const agentStrip = container.querySelector('.tab-strip-agent');
    expect(ordinaryStrip).not.toBeNull();
    expect(agentStrip).not.toBeNull();
    // Poppin (an ordinary tab) stays in the scrollable strip; the agent-owned
    // context tab and the reply tab dock in the separate right-hand cluster,
    // alongside the Agent Tabs entry pill.
    expect(ordinaryStrip!.querySelector('[title="Poppin"]')).not.toBeNull();
    expect(ordinaryStrip!.querySelector('[title="Docs"]')).toBeNull();
    expect(ordinaryStrip!.querySelector('[title="Reply"]')).toBeNull();
    expect(agentStrip!.querySelector('[title="Docs"]')).not.toBeNull();
    expect(agentStrip!.querySelector('[title="Reply"]')).not.toBeNull();
    expect(agentStrip!.querySelector('.agent-tabs-entry')).not.toBeNull();
    // DOM order matches visual order: the agent cluster renders after (to the
    // right of) the ordinary tab strip.
    const strips = [...container.querySelectorAll('.tab-strip, .tab-strip-agent')];
    expect(strips.indexOf(ordinaryStrip!)).toBeLessThan(strips.indexOf(agentStrip!));
  });

  it('offers a pinned Tandem World launcher independent of the tab list', async () => {
    const user = userEvent.setup();
    const onOpenTandemWorld = vi.fn();
    render(
      <TabStrip
        tabs={[TAB]}
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
        tandemReady
        onOpenTandemWorld={onOpenTandemWorld}
      />,
    );
    expect(screen.getByText('Tandem')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /open tandem world/i }));
    expect(onOpenTandemWorld).toHaveBeenCalledOnce();
  });

  it('replaces the Tandem launcher with one closable Tandem World tab while open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <TabStrip
        tabs={[{ ...TAB, id: 'tandem-world', title: 'Tandem World', kind: 'tandem' }]}
        groups={[]}
        activeTabId="tandem-world"
        onActivate={vi.fn()}
        onClose={onClose}
        onCreate={vi.fn()}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onShowGroupMenu={vi.fn()}
        tandemReady
        onOpenTandemWorld={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /open tandem world/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close tandem world/i }));
    expect(onClose).toHaveBeenCalledWith('tandem-world');
  });

  it('offers an explicit Tandem World action in the connected workspace section', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue(null);
    render(<TandemSection snapshot={{
      ...EMPTY_TANDEM_SNAPSHOT,
      connection: { ...EMPTY_TANDEM_SNAPSHOT.connection, state: 'ready', message: 'Connected', baseUrl: 'https://tandem.example.com', hasCredential: true, writable: true },
      workspaces: [{ id: 'workspace-1', name: 'Personal' }],
      activeWorkspaceId: 'workspace-1',
    }} onCommand={onCommand} />);

    await user.click(screen.getByRole('button', { name: 'Open Tandem World' }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'openWorld' });
  });

  it('keeps Tandem projects collapsed until requested and keeps checked context inspectable', async () => {
    const user = userEvent.setup();
    render(<TandemSection snapshot={{
      ...EMPTY_TANDEM_SNAPSHOT,
      connection: { ...EMPTY_TANDEM_SNAPSHOT.connection, state: 'ready', message: 'Connected', baseUrl: 'https://tandem.example.com', hasCredential: true, writable: true },
      workspaces: [{ id: 'workspace-1', name: 'Personal' }], activeWorkspaceId: 'workspace-1',
      pages: [{ id: 'page-1', title: 'Project notes', kind: 'page', parentId: null, icon: null, updatedAt: null }],
      selected: [{ sourceType: 'tandem-page', workspaceId: 'workspace-1', pageId: 'page-1', title: 'Project notes', updatedAt: null, capturedMarkdown: '# Notes', capturedAt: '2026-08-10T00:00:00Z', truncated: false, stale: false }],
    }} onCommand={vi.fn().mockResolvedValue(null)} />);
    const projects = screen.getByRole('button', { name: /projects & pages/i });
    expect(projects).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Project notes')).not.toBeInTheDocument();
    await user.click(projects);
    expect(screen.getByText('Project notes')).toBeVisible();
    expect(screen.getByText('Selected context snapshot')).toBeVisible();
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

    expect(await screen.findByRole('complementary', { name: /poppin settings/i })).toBeVisible();
    await user.selectOptions(screen.getByLabelText(/links open in/i), 'new-tab');
    expect(onUpdateSettings).toHaveBeenCalledWith({ linkOpening: 'new-tab' });
  });

  it('connects Tandem from Poppin settings instead of the workspace pane', async () => {
    const user = userEvent.setup();
    const onTandemCommand = vi.fn().mockResolvedValue(null);
    render(
      <BrowserToolbar
        activeTab={TAB} address={TAB.url} addressError="" settings={DEFAULT_BROWSER_SETTINGS} settingsOpen
        tandem={EMPTY_TANDEM_SNAPSHOT} canReopenClosedTab={false} addressInputRef={{ current: null }}
        onAddressChange={vi.fn()} onAddressFocus={vi.fn()} onAddressBlur={vi.fn()} onBack={vi.fn()} onForward={vi.fn()} onReload={vi.fn()}
        onReopenClosedTab={vi.fn()} onSettingsOpenChange={vi.fn()} onUpdateSettings={vi.fn()} onTandemCommand={onTandemCommand} onSubmit={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText('Tandem address'), 'tandem.example.com');
    await user.type(screen.getByLabelText('API key'), 'udm_secret');
    await user.click(screen.getByRole('button', { name: 'Connect Tandem' }));
    expect(onTandemCommand).toHaveBeenCalledWith({ type: 'connect', baseUrl: 'tandem.example.com', apiKey: 'udm_secret' });
  });

  it('keeps connected project settings collapsed until requested', async () => {
    const user = userEvent.setup();
    render(<ProjectSection project={{ repositoryPath: '/tmp/poppin', remote: 'origin', branch: 'main', installCommand: 'npm ci', devCommand: 'npm run dev', previewUrl: 'http://localhost:3000' }} onCommand={vi.fn().mockResolvedValue(null)} />);
    expect(screen.queryByLabelText('Install command')).not.toBeVisible();
    await user.click(screen.getByText('Project settings'));
    expect(screen.getByLabelText('Install command')).toBeVisible();
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
        documentId: 'document-1', threadId: 'thread-1', turnId: 'turn-1', baselineCommit: '', progress: [], pendingApproval: null,
        result: 'First answer', diff: '', error: null,
        browserRun: { required: false, state: 'not-required', taskSpaceId: null, successfulActionCount: 0, retryCount: 0, lastActionAt: null, sources: [] },
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

  it('shows exactly what an approval will allow, in the task tab', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    const snapshot: TaskSnapshot = {
      ...READY_TASK,
      task: {
        state: 'Needs Approval', kind: 'code', prompt: 'Change it', model: 'gpt-test', reasoningEffort: 'high',
        documentId: 'document-1', threadId: 'thread-1', turnId: 'turn-1', baselineCommit: 'a'.repeat(40), progress: [],
        pendingApproval: { requestId: 9, kind: 'command', title: 'Codex wants to run a command', detail: 'npm test\n/tmp/project', reason: 'Verify the change' },
        result: '', diff: '', error: null,
        browserRun: { required: false, state: 'not-required', taskSpaceId: null, successfulActionCount: 0, retryCount: 0, lastActionAt: null, sources: [] },
        createdAt: '', updatedAt: '',
      },
    };
    render(<TaskTabView taskSnapshot={snapshot} workspace={EMPTY_WORKSPACE} onTaskCommand={onCommand} />);
    expect(screen.getByText('npm test', { exact: false })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /allow once/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'respondApproval', decision: 'accept' });
  });

  it('renders a completed Work reply once, without duplicating it as live progress', () => {
    const snapshot: TaskSnapshot = {
      ...READY_TASK,
      task: {
        state: 'Completed', kind: 'work', prompt: 'Research guitars', model: 'gpt-test', reasoningEffort: 'high',
        documentId: 'document-1', threadId: 'thread-1', turnId: 'turn-1', baselineCommit: '', pendingApproval: null,
        progress: [{ id: 'message-1', kind: 'message', title: 'Codex response', detail: 'Guitar options', status: 'completed' }],
        result: '# Guitar options\n\nHere is the shortlist.', diff: '', error: null,
        browserRun: { required: true, state: 'completed', taskSpaceId: 'space-1', successfulActionCount: 1, retryCount: 0, lastActionAt: '', sources: [] },
        createdAt: '', updatedAt: '',
      },
    };
    render(<TaskTabView taskSnapshot={snapshot} workspace={EMPTY_WORKSPACE} onTaskCommand={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /guitar options/i })).toBeVisible();
    expect(screen.queryByText('Codex response')).not.toBeInTheDocument();
    expect(screen.queryByText(/tandem/i)).not.toBeInTheDocument();
  });

  it('renders follow-ups as one persistent task thread and exposes an explicit new-task action', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    const snapshot: TaskSnapshot = {
      ...READY_TASK,
      task: {
        state: 'Completed', kind: 'work', prompt: 'Tell me more', model: 'gpt-test', reasoningEffort: 'high',
        documentId: 'document-1', threadId: 'thread-1', turnId: 'turn-2', baselineCommit: '', progress: [], pendingApproval: null,
        result: 'Second answer', diff: '', error: null,
        turns: [
          { id: 'turn-1', prompt: 'First question', result: 'First answer', status: 'completed', sources: [], createdAt: '', completedAt: '' },
          { id: 'turn-2', prompt: 'Tell me more', result: 'Second answer', status: 'completed', sources: [], createdAt: '', completedAt: '' },
        ],
        browserRun: { required: false, state: 'not-required', taskSpaceId: null, successfulActionCount: 0, retryCount: 0, lastActionAt: null, sources: [] },
        createdAt: '', updatedAt: '',
      },
    };
    render(<TaskTabView taskSnapshot={snapshot} workspace={EMPTY_WORKSPACE} onTaskCommand={onCommand} />);
    expect(screen.getAllByText('First question')).toHaveLength(2);
    expect(screen.getByText('First answer')).toBeVisible();
    expect(screen.getByText('Tell me more')).toBeVisible();
    expect(screen.getByText('Second answer')).toBeVisible();
    expect(screen.queryByText(/agent thinking/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new task/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'finishTask' });
  });
});
