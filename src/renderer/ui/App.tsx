import { ExternalLink, X } from 'lucide-react';
import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from 'react';

import { DEFAULT_BROWSER_SETTINGS, type BrowserCommand, type BrowserSnapshot } from '../../shared/browser';
import type { WorkspaceCommand, WorkspaceSnapshot } from '../../shared/workspace';
import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import type { BrowserAgentCommand, BrowserAgentCommandResult, BrowserAgentSnapshot } from '../../shared/browser-agent';
import type { PagesCommand, PagesSnapshot } from '../../shared/pages';
import { Brand } from './Brand';
import { BrowserToolbar } from './BrowserToolbar';
import { TabStrip } from './TabStrip';
import { WorkspacePane } from './WorkspacePane';
import { ContextPane, type PaneSection } from './ContextPane';
import { CommandBar } from './CommandBar';
import { PaneResizer } from './PaneResizer';
import { NativePageView } from './NativePageView';
import { NativeDatabaseView } from './NativeDatabaseView';
import { getChromeLayout, getTitlebarLeftInset } from './chrome-layout';
import { issueForCommand, visibleAddressIssue, type AddressIssue } from './address-issue';
import { browserApprovalAttentionKey, taskAttentionKey } from './task-attention';
import {
  clampResizedPaneWidth,
  getPaneWidthRange,
  loadPaneWidths,
  normalizePaneWidths,
  savePaneWidths,
  type PaneSide,
} from './pane-layout';

const EMPTY_SNAPSHOT: BrowserSnapshot = {
  tabs: [], groups: [], activeTabId: '', isFullScreen: false, canReopenClosedTab: false,
  settings: { ...DEFAULT_BROWSER_SETTINGS },
  authenticationPopup: null,
  linkPreview: null,
};
const EMPTY_WORKSPACE: WorkspaceSnapshot = { workspace: null, documents: [], tabContexts: [], project: null, visualSelection: null };
const EMPTY_TASK: TaskSnapshot = { connection: { state: 'checking', message: 'Connecting to Codex…', accountLabel: null, models: [] }, task: null };
const EMPTY_BROWSER_AGENT: BrowserAgentSnapshot = { state: 'idle', taskId: null, taskSpace: null, watching: false, allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null, log: [] };
const EMPTY_PAGES: PagesSnapshot = { pages: [], tabs: [], activeTabId: null, selectedPageIds: [] };

export function App() {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>(EMPTY_SNAPSHOT);
  const [addressDraft, setAddressDraft] = useState('');
  const [addressIssue, setAddressIssue] = useState<AddressIssue | null>(null);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [contextSection, setContextSection] = useState<PaneSection>('context');
  const [taskSnapshot, setTaskSnapshot] = useState<TaskSnapshot>(EMPTY_TASK);
  const [browserAgentSnapshot, setBrowserAgentSnapshot] = useState<BrowserAgentSnapshot>(EMPTY_BROWSER_AGENT);
  const [pagesSnapshot, setPagesSnapshot] = useState<PagesSnapshot>(EMPTY_PAGES);
  const [pagesRevision, setPagesRevision] = useState(0);
  const [commandCollapsed, setCommandCollapsed] = useState(false);
  const [commandOverlayHeight, setCommandOverlayHeight] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferredPaneWidths, setPreferredPaneWidths] = useState(() => loadPaneWidths(window.localStorage));
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const addressInputRef = useRef<HTMLInputElement>(null);

  const activeNativeTab = pagesSnapshot.tabs.find((tab) => tab.id === pagesSnapshot.activeTabId) ?? null;
  const activeNativeTabId = activeNativeTab?.id ?? null;
  const browserActiveTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
  const activeTab = activeNativeTab ? null : browserActiveTab;
  const browserTabs = snapshot.tabs.filter((tab) => !tab.taskSpaceId || (browserAgentSnapshot.watching && tab.taskSpaceId === browserAgentSnapshot.taskSpace?.id));
  const visibleTabs = [
    ...browserTabs.map((tab) => ({ ...tab, kind: 'browser' as const })),
    ...pagesSnapshot.tabs.map((tab) => ({ id: tab.id, title: tab.title, kind: tab.kind })),
  ];
  const activeTabId = activeNativeTab?.id ?? snapshot.activeTabId;
  const address = isEditingAddress ? addressDraft : activeTab?.url ?? (activeNativeTab ? `${activeNativeTab.kind}://${activeNativeTab.pageId}` : '');
  const addressError = visibleAddressIssue(addressIssue, activeTab);
  const chromeLayout = getChromeLayout(viewport.width, viewport.height);
  const paneWidths = normalizePaneWidths(preferredPaneWidths, viewport.width);
  const paneStyle = {
    '--chrome-height': `${chromeLayout.height}px`,
    '--titlebar-left-inset': `${getTitlebarLeftInset(chromeLayout.density, snapshot.isFullScreen)}px`,
    '--workspace-pane-width': `${paneWidths.left}px`,
    '--context-pane-width': `${paneWidths.right}px`,
    '--command-overlay-height': `${commandOverlayHeight}px`,
  } as CSSProperties;
  const taskAttention = taskAttentionKey(taskSnapshot);
  const browserApprovalAttention = browserApprovalAttentionKey(browserAgentSnapshot);
  const attentionRequired = Boolean(taskAttention || browserApprovalAttention);
  const visibleContextCollapsed = attentionRequired ? false : contextCollapsed;
  const visibleContextSection: PaneSection = attentionRequired ? 'task' : contextSection;

  useEffect(() => {
    let mounted = true;
    void window.poppinBrowser.getSnapshot().then((initialSnapshot) => {
      if (mounted) setSnapshot(initialSnapshot);
    });
    const unsubscribeSnapshot = window.poppinBrowser.subscribe(setSnapshot);
    void window.poppinWorkspace.getSnapshot().then((initialSnapshot) => {
      if (mounted) setWorkspaceSnapshot(initialSnapshot);
    });
    const unsubscribeWorkspace = window.poppinWorkspace.subscribe(setWorkspaceSnapshot);
    const receiveTaskSnapshot = (nextSnapshot: TaskSnapshot) => {
      if (!mounted) return;
      setTaskSnapshot(nextSnapshot);
    };
    void window.poppinTask.getSnapshot().then((initialSnapshot) => {
      receiveTaskSnapshot(initialSnapshot);
    });
    const unsubscribeTask = window.poppinTask.subscribe(receiveTaskSnapshot);
    const receiveBrowserAgentSnapshot = (nextSnapshot: BrowserAgentSnapshot) => {
      if (!mounted) return;
      setBrowserAgentSnapshot(nextSnapshot);
    };
    void window.poppinBrowserAgent.getSnapshot().then(receiveBrowserAgentSnapshot);
    const unsubscribeBrowserAgent = window.poppinBrowserAgent.subscribe(receiveBrowserAgentSnapshot);
    void window.poppinPages.getSnapshot().then((initialSnapshot) => {
      if (mounted) setPagesSnapshot(initialSnapshot);
    });
    const unsubscribePages = window.poppinPages.subscribe((nextSnapshot) => {
      if (!mounted) return;
      setPagesSnapshot(nextSnapshot);
      setPagesRevision((value) => value + 1);
    });
    const unsubscribeFocus = window.poppinBrowser.onFocusAddress(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });
    return () => {
      mounted = false;
      unsubscribeSnapshot();
      unsubscribeWorkspace();
      unsubscribeTask();
      unsubscribeBrowserAgent();
      unsubscribePages();
      unsubscribeFocus();
    };
  }, []);

  useEffect(() => {
    void window.poppinBrowser.command({ type: 'setContentVisible', visible: activeNativeTabId === null });
  }, [activeNativeTabId]);

  useEffect(() => {
    if (browserAgentSnapshot.watching && pagesSnapshot.activeTabId) void window.poppinPages.command({ type: 'deactivateTabs' });
  }, [browserAgentSnapshot.watching, pagesSnapshot.activeTabId]);

  useEffect(() => {
    const updateViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      void window.poppinBrowser.getSnapshot().then(setSnapshot);
    };
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    savePaneWidths(window.localStorage, preferredPaneWidths);
  }, [preferredPaneWidths]);

  useEffect(() => {
    void window.poppinBrowser.command({
      type: 'setLayout',
      topInset: chromeLayout.height,
      leftInset: workspaceCollapsed ? 46 : paneWidths.left + 14,
      rightInset: visibleContextCollapsed ? 46 : paneWidths.right + 14,
      ...(settingsOpen ? { rightInset: Math.max(visibleContextCollapsed ? 46 : paneWidths.right + 14, 350) } : {}),
      bottomInset: commandCollapsed ? 0 : 94 + commandOverlayHeight,
    });
  }, [chromeLayout.height, commandCollapsed, commandOverlayHeight, paneWidths.left, paneWidths.right, settingsOpen, visibleContextCollapsed, workspaceCollapsed]);

  const resizePane = (side: PaneSide, requestedWidth: number) => {
    const otherSide = side === 'left' ? 'right' : 'left';
    const width = clampResizedPaneWidth(side, requestedWidth, viewport.width, paneWidths[otherSide]);
    setPreferredPaneWidths((current) => ({ ...current, [side]: width }));
  };

  const sendCommand = async (command: BrowserCommand) => {
    try {
      const result = await window.poppinBrowser.command(command);
      if (result.ok) {
        setAddressIssue(null);
      } else {
        setAddressIssue(issueForCommand(command, result.message ?? 'That action is not available.', snapshot, activeTab));
      }
    } catch {
      setAddressIssue(issueForCommand(command, 'Poppin could not complete that action.', snapshot, activeTab));
    }
  };

  const withActiveTab = (type: 'back' | 'forward' | 'reload') => {
    if (activeTab) void sendCommand({ type, tabId: activeTab.id });
  };

  const sendWorkspaceCommand = async (command: WorkspaceCommand): Promise<string | null> => {
    try {
      const result = await window.poppinWorkspace.command(command);
      return result.ok ? null : result.message ?? 'Poppin could not complete that action.';
    } catch {
      return 'Poppin could not complete that action.';
    }
  };

  const sendPagesCommand = async (command: PagesCommand): Promise<string | null> => {
    try {
      const result = await window.poppinPages.command(command);
      return result.ok ? null : result.message ?? 'Poppin could not update Pages.';
    } catch {
      return 'Poppin could not update Pages.';
    }
  };

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    if (!activeTab) return;
    setIsEditingAddress(false);
    addressInputRef.current?.blur();
    void sendCommand({ type: 'navigate', tabId: activeTab.id, input: addressDraft });
  };

  const sendTaskCommand = async (command: TaskCommand): Promise<TaskCommandResult> => {
    try {
      return await window.poppinTask.command(command);
    } catch {
      return { ok: false, message: 'Poppin could not reach Codex.' };
    }
  };

  const sendBrowserAgentCommand = async (command: BrowserAgentCommand): Promise<BrowserAgentCommandResult> => {
    try {
      return await window.poppinBrowserAgent.command(command);
    } catch {
      return { ok: false, message: 'Poppin could not control the selected tab.' };
    }
  };

  return (
    <main className={`app-shell chrome-${chromeLayout.density} ${snapshot.isFullScreen ? 'window-fullscreen' : 'window-windowed'} ${commandCollapsed ? 'command-is-collapsed' : ''} ${settingsOpen ? 'settings-open' : ''}`} style={paneStyle}>
      {snapshot.authenticationPopup ? (
        <section className="authentication-overlay-status" aria-label="Secure sign-in overlay">
          <div><strong>{snapshot.authenticationPopup.title}</strong><span>Complete sign-in in the protected overlay. Poppin cannot read credentials.</span></div>
          <button type="button" onClick={() => { void sendCommand({ type: 'cancelAuthenticationPopup' }); }}>Cancel</button>
        </section>
      ) : null}
      {snapshot.linkPreview ? (
        <section className="authentication-overlay-status link-preview-status" aria-label="Link preview overlay">
          <div className="link-preview-description"><strong>{snapshot.linkPreview.title}</strong><span>{snapshot.linkPreview.url}</span></div>
          <button type="button" aria-label="Close" title="Close preview (Esc)" onClick={() => { void sendCommand({ type: 'closeLinkPreview' }); }}><X size={17} /></button>
          <button type="button" aria-label="Open in tab" title="Open preview in a tab" onClick={() => { void sendCommand({ type: 'openLinkPreviewInTab' }); }}><ExternalLink size={16} /></button>
        </section>
      ) : null}
      <header className="browser-chrome">
        <div className="top-row">
          <Brand />
          <BrowserToolbar
            activeTab={activeTab}
            address={address}
            addressError={addressError}
            settings={snapshot.settings}
            settingsOpen={settingsOpen}
            canReopenClosedTab={snapshot.canReopenClosedTab}
            addressInputRef={addressInputRef}
            onAddressChange={(value) => {
              setAddressDraft(value);
              setAddressIssue(null);
            }}
            onAddressFocus={() => {
              setAddressDraft(activeTab?.url ?? '');
              setIsEditingAddress(true);
            }}
            onAddressBlur={() => {
              setIsEditingAddress(false);
            }}
            onBack={() => withActiveTab('back')}
            onForward={() => withActiveTab('forward')}
            onReload={() => withActiveTab('reload')}
            onReopenClosedTab={() => void sendCommand({ type: 'reopenClosedTab' })}
            onSettingsOpenChange={setSettingsOpen}
            onUpdateSettings={(settings) => void sendCommand({ type: 'updateSettings', settings })}
            onSubmit={submitAddress}
          />
        </div>
        <TabStrip
          tabs={visibleTabs}
          groups={snapshot.groups}
          activeTabId={activeTabId}
          onActivate={(tabId) => {
            const nativeTab = pagesSnapshot.tabs.find((candidate) => candidate.id === tabId);
            if (nativeTab) {
              if (browserAgentSnapshot.watching) void sendBrowserAgentCommand({ type: 'leaveWatch' });
              void sendPagesCommand({ type: 'activateTab', tabId });
              return;
            }
            const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
            if (browserAgentSnapshot.watching && !tab?.taskSpaceId) void sendBrowserAgentCommand({ type: 'leaveWatch' });
            void sendPagesCommand({ type: 'deactivateTabs' });
            void sendCommand({ type: 'activate', tabId });
          }}
          onClose={(tabId) => { if (pagesSnapshot.tabs.some((tab) => tab.id === tabId)) void sendPagesCommand({ type: 'closeTab', tabId }); else void sendCommand({ type: 'close', tabId }); }}
          onCreate={() => { void sendPagesCommand({ type: 'deactivateTabs' }); void sendCommand({ type: 'create' }); }}
          onReorder={(tabId, beforeTabId) => { if (pagesSnapshot.tabs.some((tab) => tab.id === tabId)) void sendPagesCommand({ type: 'reorderTab', tabId, beforeTabId: pagesSnapshot.tabs.some((tab) => tab.id === beforeTabId) ? beforeTabId : null }); else void sendCommand({ type: 'reorder', tabId, beforeTabId: snapshot.tabs.some((tab) => tab.id === beforeTabId) ? beforeTabId : null }); }}
          onShowTabMenu={(tabId) => void sendCommand({ type: 'showTabMenu', tabId })}
          onToggleGroup={(groupId) => void sendCommand({ type: 'toggleGroup', groupId })}
          onRenameGroup={(groupId, name) => void sendCommand({ type: 'renameGroup', groupId, name })}
          onShowGroupMenu={(groupId) => void sendCommand({ type: 'showGroupMenu', groupId })}
          agentTaskSpace={browserAgentSnapshot.taskSpace}
          watchingAgentTabs={browserAgentSnapshot.watching}
          onWatchAgentTabs={() => { void sendBrowserAgentCommand({ type: 'watch' }); }}
        />
      </header>
      <WorkspacePane
        collapsed={workspaceCollapsed}
        snapshot={workspaceSnapshot}
        tabs={snapshot.tabs.filter((tab) => !tab.taskSpaceId)}
        pages={pagesSnapshot}
        onCollapseChange={setWorkspaceCollapsed}
        onCreate={(name) => sendWorkspaceCommand({ type: 'createWorkspace', name })}
        onCommand={sendWorkspaceCommand}
        onPagesCommand={sendPagesCommand}
      />
      <ContextPane
        collapsed={visibleContextCollapsed}
        snapshot={workspaceSnapshot}
        taskSnapshot={taskSnapshot}
        onCollapseChange={setContextCollapsed}
        onRefreshTab={(tabId) => { void sendWorkspaceCommand({ type: 'refreshTabContext', tabId }); }}
        activeTab={activeTab}
        onCaptureVisualSelection={async (tabId) => {
          const message = await sendWorkspaceCommand({ type: 'captureVisualSelection', tabId });
          return { ok: message === null, ...(message ? { message } : {}) };
        }}
        onClearVisualSelection={() => { void sendWorkspaceCommand({ type: 'clearVisualSelection' }); }}
        onTaskCommand={sendTaskCommand}
        onOpenResult={() => { if (taskSnapshot.task) void sendPagesCommand({ type: 'openTaskDocument', threadId: taskSnapshot.task.documentId }); }}
        browserAgentSnapshot={browserAgentSnapshot}
        onBrowserAgentCommand={sendBrowserAgentCommand}
        section={visibleContextSection}
        onSectionChange={setContextSection}
      />
      {!workspaceCollapsed ? (
        <PaneResizer
          side="left"
          width={paneWidths.left}
          {...getPaneWidthRange('left', viewport.width, paneWidths.right)}
          onResize={(width) => resizePane('left', width)}
        />
      ) : null}
      {!visibleContextCollapsed ? (
        <PaneResizer
          side="right"
          width={paneWidths.right}
          {...getPaneWidthRange('right', viewport.width, paneWidths.left)}
          onResize={(width) => resizePane('right', width)}
        />
      ) : null}
      {activeNativeTab ? (
        <div className={`native-stage ${workspaceCollapsed ? 'workspace-collapsed' : ''} ${visibleContextCollapsed ? 'context-collapsed' : ''}`}>
          {activeNativeTab.kind === 'database'
            ? <NativeDatabaseView pageId={activeNativeTab.pageId} revision={pagesRevision} onCommand={sendPagesCommand} />
            : <NativePageView pageId={activeNativeTab.pageId} revision={pagesRevision} onCommand={sendPagesCommand} taskSnapshot={taskSnapshot} onTaskCommand={sendTaskCommand} onTaskStarted={() => { setContextCollapsed(false); setContextSection('task'); }} />}
        </div>
      ) : <div className={`browser-stage ${workspaceCollapsed ? 'workspace-collapsed' : ''} ${visibleContextCollapsed ? 'context-collapsed' : ''}`} aria-hidden="true" />}
      <CommandBar snapshot={taskSnapshot} workspace={workspaceSnapshot} collapsed={commandCollapsed} onCollapseChange={setCommandCollapsed} onCommand={sendTaskCommand} onOverlayHeightChange={setCommandOverlayHeight} />
    </main>
  );
}
