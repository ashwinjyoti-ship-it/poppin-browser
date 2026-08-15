import { ExternalLink, Columns2, Mail, X } from 'lucide-react';
import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from 'react';

import { DEFAULT_BROWSER_SETTINGS, type BrowserCommand, type BrowserCommandResult, type BrowserSnapshot } from '../../shared/browser';
import type { WorkspaceCommand, WorkspaceCommandResult, WorkspaceSnapshot } from '../../shared/workspace';
import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import type { BrowserAgentCommand, BrowserAgentCommandResult, BrowserAgentSnapshot } from '../../shared/browser-agent';
import type { PagesCommand, PagesSnapshot } from '../../shared/pages';
import { EMPTY_TANDEM_SNAPSHOT, type TandemCommand, type TandemSnapshot, isTandemWorldBrowserUrl } from '../../shared/tandem';
import { EMPTY_DOWNLOADS_SNAPSHOT, type DownloadsSnapshot } from '../../shared/downloads';
import { EMPTY_POPPIN_PAD_SNAPSHOT, type PoppinPadCommand, type PoppinPadCommandResult, type PoppinPadSnapshot } from '../../shared/poppin-pad';
import { Brand } from './Brand';
import { BrowserToolbar } from './BrowserToolbar';
import { TabStrip } from './TabStrip';
import { DownloadsPopover } from './DownloadsPopover';
import { WorkspacePane } from './WorkspacePane';
import { TaskTabView } from './TaskTabView';
import { AgentDock } from './AgentDock';
import { PoppinPadPane } from './PoppinPadPane';
import { CommandBar } from './CommandBar';
import { PaneResizer } from './PaneResizer';
import { NativePageView } from './NativePageView';
import { NativeDatabaseView } from './NativeDatabaseView';
import { MailSection } from './MailSection';
import { TabSearchBar } from './TabSearchBar';
import { getChromeLayout, getTitlebarLeftInset, resolveChromeHeight, TAB_SEARCH_RESULTS_INSET } from './chrome-layout';
import { issueForCommand, visibleAddressIssue, type AddressIssue } from './address-issue';
import { browserApprovalAttentionKey, taskAttentionKey } from './task-attention';
import { getAgentDockPresentation, getTaskTabStatus } from './task-surface';
import { isReusableMailAgentSession, mailInboxTabId } from '../../shared/mail';
import {
  browserLeftInset,
  browserRightInset,
  clampResizedLeftPaneWidth,
  clampResizedRightPaneWidth,
  COLLAPSED_RAIL_WIDTH,
  getFocusedRightPaneWidth,
  getLeftPaneWidthRange,
  getRightPaneWidthRange,
  loadLeftPaneWidth,
  loadRightPaneWidth,
  normalizeLeftPaneWidth,
  normalizeRightPaneWidth,
  saveLeftPaneWidth,
  saveRightPaneWidth,
} from './pane-layout';

const EMPTY_SNAPSHOT: BrowserSnapshot = {
  tabs: [], groups: [], activeTabId: '', isFullScreen: false, canReopenClosedTab: false,
  settings: { ...DEFAULT_BROWSER_SETTINGS },
  enteredUrls: [],
  authenticationPopup: null,
  linkPreview: null,
  split: null,
};
const EMPTY_WORKSPACE: WorkspaceSnapshot = {
  workspace: null,
  documents: [],
  tabContexts: [],
  project: null,
  visualSelection: null,
  contextPacks: [],
  memorySelected: false,
  memoryBrief: null,
  browserSessions: [],
  recipes: [],
  mailInboxUrl: null,
  mailSkills: [],
};
const EMPTY_TASK: TaskSnapshot = { connection: { state: 'checking', message: 'Connecting to Codex…', accountLabel: null, models: [] }, task: null };
const EMPTY_BROWSER_AGENT: BrowserAgentSnapshot = { state: 'idle', taskId: null, taskSpace: null, watching: false, allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null, log: [] };
const EMPTY_PAGES: PagesSnapshot = { pages: [], tabs: [], activeTabId: null, selectedPageIds: [] };
const TASK_TAB_ID = 'task-reply';
/** Bounded dock reservations: compact status pill versus approval/control card. */
const AGENT_DOCK_PILL_HEIGHT = 48;
const AGENT_DOCK_CARD_HEIGHT = 126;

export function App() {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>(EMPTY_SNAPSHOT);
  const [addressDraft, setAddressDraft] = useState('');
  const [addressIssue, setAddressIssue] = useState<AddressIssue | null>(null);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  // A fresh browser opens for browsing first. The workspace pane expands on demand.
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
  const [taskTabActive, setTaskTabActive] = useState(false);
  const [mailActive, setMailActive] = useState(false);
  const [taskSnapshot, setTaskSnapshot] = useState<TaskSnapshot>(EMPTY_TASK);
  const [browserAgentSnapshot, setBrowserAgentSnapshot] = useState<BrowserAgentSnapshot>(EMPTY_BROWSER_AGENT);
  const [pagesSnapshot, setPagesSnapshot] = useState<PagesSnapshot>(EMPTY_PAGES);
  const [tandemSnapshot, setTandemSnapshot] = useState<TandemSnapshot>(EMPTY_TANDEM_SNAPSHOT);
  const [downloadsSnapshot, setDownloadsSnapshot] = useState<DownloadsSnapshot>(EMPTY_DOWNLOADS_SNAPSHOT);
  const [pagesRevision, setPagesRevision] = useState(0);
  const [commandCollapsed, setCommandCollapsed] = useState(false);
  const [commandOverlayHeight, setCommandOverlayHeight] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [urlOverlayOpen, setUrlOverlayOpen] = useState(false);
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const [preferredLeftPaneWidth, setPreferredLeftPaneWidth] = useState(() => loadLeftPaneWidth(window.localStorage));
  const [preferredRightPaneWidth, setPreferredRightPaneWidth] = useState(() => loadRightPaneWidth(window.localStorage));
  const [padSnapshot, setPadSnapshot] = useState<PoppinPadSnapshot>(EMPTY_POPPIN_PAD_SNAPSHOT);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const addressInputRef = useRef<HTMLInputElement>(null);

  const activeNativeTab = pagesSnapshot.tabs.find((tab) => tab.id === pagesSnapshot.activeTabId) ?? null;
  const activeNativeTabId = activeNativeTab?.id ?? null;
  const browserActiveTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
  const activeTab = activeNativeTab || taskTabActive || mailActive ? null : browserActiveTab;
  const browserTabs = snapshot.tabs.filter((tab) => !tab.taskSpaceId || (browserAgentSnapshot.watching && tab.taskSpaceId === browserAgentSnapshot.taskSpace?.id));
  const visibleTabs = [
    ...browserTabs.map((tab) => ({
      ...tab,
      kind: tab.surface === 'tandem-world' || isTandemWorldBrowserUrl(tab.url, tandemSnapshot.connection.baseUrl)
        ? 'tandem' as const
        : 'browser' as const,
    })),
    ...(taskSnapshot.task ? [{
      id: TASK_TAB_ID,
      title: taskSnapshot.task.kind === 'code' ? 'Review' : 'Reply',
      kind: 'task' as const,
      taskKind: taskSnapshot.task.kind,
      taskStatus: getTaskTabStatus(taskSnapshot.task),
      taskSpaceId: browserAgentSnapshot.taskSpace?.id ?? 'task-only',
    }] : []),
    ...pagesSnapshot.tabs.map((tab) => ({ id: tab.id, title: tab.title, kind: tab.kind })),
  ];
  const activeTabId = taskTabActive ? TASK_TAB_ID : mailActive ? '' : (activeNativeTab?.id ?? snapshot.activeTabId);
  const address = isEditingAddress ? addressDraft : activeTab?.url ?? (activeNativeTab ? `${activeNativeTab.kind}://${activeNativeTab.pageId}` : '');
  const addressError = visibleAddressIssue(addressIssue, activeTab);
  const chromeLayout = getChromeLayout(viewport.width, viewport.height);
  const chromeHeight = resolveChromeHeight(chromeLayout, tabSearchOpen);
  const leftPaneWidth = normalizeLeftPaneWidth(preferredLeftPaneWidth, viewport.width);
  const padCollapsed = padSnapshot.pad.collapsed;
  const padActive = padSnapshot.pad.active;
  const watchingAgentTabs = browserAgentSnapshot.watching;
  const layoutWorkspaceCollapsed = watchingAgentTabs || workspaceCollapsed;
  const layoutPadCollapsed = watchingAgentTabs || padCollapsed;
  const padLayoutSnapshot = watchingAgentTabs
    ? { ...padSnapshot, pad: { ...padSnapshot.pad, collapsed: true, active: false } }
    : padSnapshot;
  // Focus mode expands into leftover window space; otherwise honor the resized preference.
  const rightPaneWidth = padActive && !watchingAgentTabs
    ? getFocusedRightPaneWidth(viewport.width, leftPaneWidth, layoutWorkspaceCollapsed)
    : normalizeRightPaneWidth(
      preferredRightPaneWidth,
      viewport.width,
      leftPaneWidth,
      layoutWorkspaceCollapsed,
    );
  const effectiveRightPaneWidth = layoutPadCollapsed ? COLLAPSED_RAIL_WIDTH : rightPaneWidth;
  const dockPresentation = getAgentDockPresentation({
    taskSnapshot,
    browserAgentSnapshot,
    activeBrowserTaskSpaceId: activeNativeTab || taskTabActive ? null : browserActiveTab?.taskSpaceId ?? null,
    taskTabActive,
    commandCollapsed,
  });
  const showAgentDock = dockPresentation !== 'hidden';
  const agentDockHeight = dockPresentation === 'card'
    ? AGENT_DOCK_CARD_HEIGHT
    : dockPresentation === 'pill' ? AGENT_DOCK_PILL_HEIGHT : 0;
  const paneStyle = {
    '--chrome-height': `${chromeHeight}px`,
    '--titlebar-left-inset': `${getTitlebarLeftInset(chromeLayout.density, snapshot.isFullScreen)}px`,
    '--workspace-pane-width': `${leftPaneWidth}px`,
    '--poppin-pad-width': `${effectiveRightPaneWidth}px`,
    '--command-overlay-height': `${commandOverlayHeight}px`,
    '--agent-dock-height': `${agentDockHeight}px`,
  } as CSSProperties;
  const attentionKey = taskAttentionKey(taskSnapshot) || browserApprovalAttentionKey(browserAgentSnapshot) || null;
  const [seenAttentionKey, setSeenAttentionKey] = useState<string | null>(null);
  // Jump to the task tab the moment something new needs the user, without
  // forcing them to stay there — the dock keeps working from any other tab.
  // Adjusting state during render (React's documented pattern for "reset/react
  // to a changed value") rather than in an effect avoids an extra render pass.
  if (attentionKey !== seenAttentionKey) {
    setSeenAttentionKey(attentionKey);
    if (attentionKey) {
      setMailActive(false);
      setTaskTabActive(true);
    }
  }

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
    void window.poppinTandem.getSnapshot().then((initialSnapshot) => {
      if (mounted) setTandemSnapshot(initialSnapshot);
    });
    const unsubscribeTandem = window.poppinTandem.subscribe((nextSnapshot) => {
      if (mounted) setTandemSnapshot(nextSnapshot);
    });
    const unsubscribeFocus = window.poppinBrowser.onFocusAddress(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });
    void window.poppinSettings.getSnapshot().then((initialSnapshot) => {
      if (mounted) setSettingsOpen(initialSnapshot.open);
    });
    const unsubscribeSettings = window.poppinSettings.subscribe((nextSnapshot) => {
      if (mounted) setSettingsOpen(nextSnapshot.open);
    });
    void window.poppinDownloads.getSnapshot().then((initialSnapshot) => {
      if (mounted) setDownloadsSnapshot(initialSnapshot);
    });
    const unsubscribeDownloads = window.poppinDownloads.subscribe((nextSnapshot) => {
      if (mounted) setDownloadsSnapshot(nextSnapshot);
    });
    void window.poppinPad.getSnapshot().then((initialSnapshot) => {
      if (mounted) setPadSnapshot(initialSnapshot);
    });
    const unsubscribePad = window.poppinPad.subscribe((nextSnapshot) => {
      if (mounted) setPadSnapshot(nextSnapshot);
    });
    return () => {
      mounted = false;
      unsubscribeSnapshot();
      unsubscribeWorkspace();
      unsubscribeTask();
      unsubscribeBrowserAgent();
      unsubscribePages();
      unsubscribeTandem();
      unsubscribeFocus();
      unsubscribeSettings();
      unsubscribeDownloads();
      unsubscribePad();
    };
  }, []);

  useEffect(() => {
    void window.poppinBrowser.command({ type: 'setContentVisible', visible: activeNativeTabId === null && !taskTabActive && !mailActive });
  }, [activeNativeTabId, taskTabActive, mailActive]);

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
    saveLeftPaneWidth(window.localStorage, preferredLeftPaneWidth);
  }, [preferredLeftPaneWidth]);

  useEffect(() => {
    saveRightPaneWidth(window.localStorage, preferredRightPaneWidth);
  }, [preferredRightPaneWidth]);

  useEffect(() => {
    if (!padActive) void window.poppinPad.command({ type: 'setWidth', width: rightPaneWidth });
  }, [padActive, rightPaneWidth]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setTabSearchOpen(true);
      }
      if (event.key === 'Escape' && tabSearchOpen) setTabSearchOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tabSearchOpen]);

  useEffect(() => {
    const topInset = chromeHeight + (urlOverlayOpen ? 280 : 0) + (tabSearchOpen ? TAB_SEARCH_RESULTS_INSET : 0);
    const leftInset = browserLeftInset(leftPaneWidth, layoutWorkspaceCollapsed);
    const rightInset = browserRightInset(effectiveRightPaneWidth, downloadsOpen);
    const bottomInset = commandCollapsed ? 64 : 94 + commandOverlayHeight + agentDockHeight;
    void window.poppinBrowser.command({
      type: 'setLayout',
      // The address suggestions dropdown spans near the full width under the
      // toolbar, so it needs the page pushed down to stay uncovered.
      topInset,
      leftInset,
      rightInset,
      // Keep a strip for the collapsed reopen control; native views paint above DOM otherwise.
      bottomInset,
    });
  }, [agentDockHeight, chromeHeight, commandCollapsed, commandOverlayHeight, downloadsOpen, effectiveRightPaneWidth, leftPaneWidth, tabSearchOpen, urlOverlayOpen, layoutWorkspaceCollapsed, layoutPadCollapsed, viewport]);

  const resizeLeftPane = (requestedWidth: number) => {
    setPreferredLeftPaneWidth(clampResizedLeftPaneWidth(requestedWidth, viewport.width));
  };

  const resizeRightPane = (requestedWidth: number) => {
    const width = clampResizedRightPaneWidth(requestedWidth, viewport.width, leftPaneWidth, layoutWorkspaceCollapsed);
    setPreferredRightPaneWidth(width);
    void window.poppinPad.command({ type: 'setWidth', width });
    if (padActive) void window.poppinPad.command({ type: 'setActive', active: false });
  };

  const sendPadCommand = async (command: PoppinPadCommand): Promise<PoppinPadCommandResult> => {
    try {
      if (command.type === 'setActive' && command.active) {
        const focused = getFocusedRightPaneWidth(viewport.width, leftPaneWidth, layoutWorkspaceCollapsed);
        // Keep preferred width so exiting Focus restores the user's resized size.
        await window.poppinPad.command({ type: 'setWidth', width: focused });
      } else if (command.type === 'setActive' && !command.active) {
        const restored = normalizeRightPaneWidth(preferredRightPaneWidth, viewport.width, leftPaneWidth, layoutWorkspaceCollapsed);
        await window.poppinPad.command({ type: 'setWidth', width: restored });
      }
      return await window.poppinPad.command(command);
    } catch {
      return { ok: false, message: 'Poppin Pad could not complete that action.' };
    }
  };

  const togglePad = () => {
    const nextCollapsed = !padCollapsed;
    void sendPadCommand({ type: 'setCollapsed', collapsed: nextCollapsed });
  };

  const sendCommand = async (command: BrowserCommand): Promise<BrowserCommandResult> => {
    try {
      const result = await window.poppinBrowser.command(command);
      if (result.ok) {
        setAddressIssue(null);
      } else {
        setAddressIssue(issueForCommand(command, result.message ?? 'That action is not available.', snapshot, activeTab));
      }
      return result;
    } catch {
      setAddressIssue(issueForCommand(command, 'Poppin could not complete that action.', snapshot, activeTab));
      return { ok: false, message: 'Poppin could not complete that action.' };
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

  const sendWorkspaceCommandResult = async (command: WorkspaceCommand): Promise<WorkspaceCommandResult> => {
    try {
      return await window.poppinWorkspace.command(command);
    } catch {
      return { ok: false, message: 'Poppin could not complete that action.' };
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

  const sendTandemCommand = async (command: TandemCommand): Promise<string | null> => {
    try {
      const result = await window.poppinTandem.command(command);
      if (result.ok && command.type === 'openWorld') {
        setTaskTabActive(false);
        setWorkspaceCollapsed(true);
        void window.poppinSettings.command({ type: 'close' });
        void window.poppinPages.command({ type: 'deactivateTabs' });
      }
      return result.ok ? null : result.message ?? 'Poppin could not complete that Tandem action.';
    } catch {
      return 'Poppin could not reach Tandem.';
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
      const result = await window.poppinTask.command(command);
      if (result.ok && command.type === 'finishTask') setTaskTabActive(false);
      if (result.ok && (command.type === 'startTask' || command.type === 'continueTask')) {
        setMailActive(false);
        setTaskTabActive(true);
      }
      return result;
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
    <main className={`app-shell chrome-${chromeLayout.density} ${snapshot.isFullScreen ? 'window-fullscreen' : 'window-windowed'} ${commandCollapsed ? 'command-is-collapsed' : ''}`} style={paneStyle}>
      {snapshot.authenticationPopup ? (
        <section className="authentication-overlay-status" aria-label="Secure sign-in overlay">
          <div>
            <strong>{snapshot.authenticationPopup.title || 'Secure sign-in'}</strong>
          </div>
          <button type="button" onClick={() => { void sendCommand({ type: 'cancelAuthenticationPopup' }); }}>Cancel</button>
        </section>
      ) : null}
      {snapshot.linkPreview ? (
        <section className="authentication-overlay-status link-preview-status" aria-label="Link preview overlay">
          <div className="link-preview-description"><strong>{snapshot.linkPreview.title}</strong><span>{snapshot.linkPreview.url}</span></div>
          <button type="button" aria-label="Close" title="Close preview (Esc)" onClick={() => { void sendCommand({ type: 'closeLinkPreview' }); }}><X size={17} /></button>
          <button type="button" aria-label="Peek compare" title="Compare beside current page" onClick={() => { void sendCommand({ type: 'openLinkPreviewInSplit' }); }}><Columns2 size={16} /></button>
          <button type="button" aria-label="Open in tab" title="Open preview in a tab" onClick={() => { void sendCommand({ type: 'openLinkPreviewInTab' }); }}><ExternalLink size={16} /></button>
        </section>
      ) : null}
      {snapshot.split ? (
        <section className="split-chrome" aria-label="Sticky split">
          <div>
            <strong>{snapshot.split.mode === 'tandem-beside' ? 'Tandem beside page' : snapshot.split.mode === 'peek-compare' ? 'Peek compare' : 'Sticky split'}</strong>
            <span>Two live pages side by side</span>
          </div>
          <button type="button" onClick={() => { void sendCommand({ type: 'swapSplit' }); }}>Swap</button>
          <button type="button" onClick={() => { void sendCommand({ type: 'closeSplit' }); }}>Close split</button>
        </section>
      ) : null}
      <header className="browser-chrome">
        <div className="top-row">
          <Brand />
          <button
            type="button"
            className={`mail-chrome-button ${mailActive ? 'mail-chrome-button-active' : ''}`}
            aria-label="Poppin Mail"
            aria-pressed={mailActive}
            title="Poppin Mail"
            onClick={() => {
              setMailActive((open) => {
                const next = !open;
                if (next) {
                  setTaskTabActive(false);
                  void sendPagesCommand({ type: 'deactivateTabs' });
                }
                return next;
              });
            }}
          >
            <Mail size={16} strokeWidth={1.8} />
          </button>
          <BrowserToolbar
            activeTab={activeTab}
            enteredUrls={snapshot.enteredUrls}
            address={address}
            addressError={addressError}
            settingsOpen={settingsOpen}
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
            onGoToHistoryIndex={(index) => {
              if (!activeTab) return;
              void sendCommand({ type: 'goToHistoryIndex', tabId: activeTab.id, index });
            }}
            onSelectSuggestion={(url) => {
              if (!activeTab) return;
              setAddressDraft(url);
              setIsEditingAddress(false);
              void sendCommand({ type: 'navigate', tabId: activeTab.id, input: url });
            }}
            onOverlayOpenChange={setUrlOverlayOpen}
            onOpenTabSearch={() => setTabSearchOpen(true)}
            padOpen={!padCollapsed}
            onTogglePad={togglePad}
            onOpenTandemBeside={() => {
              // Tandem beside needs a live Tandem World tab to split against.
              // Rather than silently failing when one has never been opened,
              // open it first (or send the user to connect Tandem).
              if (tandemSnapshot.connection.state !== 'ready') {
                void window.poppinSettings.command({ type: 'open' });
                return;
              }
              void (async () => {
                if (!tandemSnapshot.worldOpen) {
                  const error = await sendTandemCommand({ type: 'openWorld' });
                  if (error) return;
                }
                void sendCommand({ type: 'openTandemBeside' });
              })();
            }}
            onSettingsOpenChange={(open) => { void window.poppinSettings.command({ type: open ? 'open' : 'close' }); }}
            onSubmit={submitAddress}
            downloadsSlot={
              <DownloadsPopover
                snapshot={downloadsSnapshot}
                open={downloadsOpen}
                onOpenChange={setDownloadsOpen}
                onCancel={(id) => { void window.poppinDownloads.command({ type: 'cancel', id }); }}
                onReveal={(id) => { void window.poppinDownloads.command({ type: 'reveal', id }); }}
                onDismiss={(id) => { void window.poppinDownloads.command({ type: 'dismiss', id }); }}
                onClearFinished={() => { void window.poppinDownloads.command({ type: 'clearFinished' }); }}
              />
            }
          />
        </div>
        <TabSearchBar open={tabSearchOpen} onOpenChange={setTabSearchOpen} onCommand={sendCommand} />
        <TabStrip
          tabs={visibleTabs}
          groups={snapshot.groups}
          activeTabId={activeTabId}
          onActivate={(tabId) => {
            if (tabId === TASK_TAB_ID) {
              setMailActive(false);
              setTaskTabActive(true);
              return;
            }
            setMailActive(false);
            setTaskTabActive(false);
            const nativeTab = pagesSnapshot.tabs.find((candidate) => candidate.id === tabId);
            if (nativeTab) {
              if (browserAgentSnapshot.watching) void sendBrowserAgentCommand({ type: 'leaveWatch' });
              void sendPagesCommand({ type: 'activateTab', tabId });
              return;
            }
            const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
            if (tab && (tab.surface === 'tandem-world' || isTandemWorldBrowserUrl(tab.url, tandemSnapshot.connection.baseUrl))) setWorkspaceCollapsed(true);
            if (browserAgentSnapshot.watching && !tab?.taskSpaceId) void sendBrowserAgentCommand({ type: 'leaveWatch' });
            void sendPagesCommand({ type: 'deactivateTabs' });
            void sendCommand({ type: 'activate', tabId });
          }}
          onClose={(tabId) => {
            if (tabId === TASK_TAB_ID) { setTaskTabActive(false); return; }
            if (pagesSnapshot.tabs.some((tab) => tab.id === tabId)) void sendPagesCommand({ type: 'closeTab', tabId });
            else if (snapshot.tabs.some((tab) => tab.id === tabId && (tab.surface === 'tandem-world' || isTandemWorldBrowserUrl(tab.url, tandemSnapshot.connection.baseUrl)))) void sendTandemCommand({ type: 'closeWorld' });
            else void sendCommand({ type: 'close', tabId });
          }}
          onCreate={() => { void sendPagesCommand({ type: 'deactivateTabs' }); void sendCommand({ type: 'create' }); }}
          onReorder={(tabId, beforeTabId) => { if (pagesSnapshot.tabs.some((tab) => tab.id === tabId)) void sendPagesCommand({ type: 'reorderTab', tabId, beforeTabId: pagesSnapshot.tabs.some((tab) => tab.id === beforeTabId) ? beforeTabId : null }); else void sendCommand({ type: 'reorder', tabId, beforeTabId: snapshot.tabs.some((tab) => tab.id === beforeTabId) ? beforeTabId : null }); }}
          onShowTabMenu={(tabId) => void sendCommand({ type: 'showTabMenu', tabId })}
          onToggleGroup={(groupId) => void sendCommand({ type: 'toggleGroup', groupId })}
          onRenameGroup={(groupId, name) => void sendCommand({ type: 'renameGroup', groupId, name })}
          onShowGroupMenu={(groupId) => void sendCommand({ type: 'showGroupMenu', groupId })}
          agentTaskSpace={browserAgentSnapshot.taskSpace}
          watchingAgentTabs={browserAgentSnapshot.watching}
          onWatchAgentTabs={() => { void sendBrowserAgentCommand({ type: 'watch' }); }}
          tandemReady={tandemSnapshot.connection.state === 'ready'}
          tandemMessage={tandemSnapshot.connection.message}
          tandemWorldOpen={tandemSnapshot.worldOpen}
          onOpenTandemWorld={() => {
            void sendTandemCommand({ type: 'openWorld' });
          }}
        />
      </header>
      <WorkspacePane
        collapsed={layoutWorkspaceCollapsed}
        snapshot={workspaceSnapshot}
        tabs={snapshot.tabs.filter((tab) => !tab.taskSpaceId)}
        activeTab={activeTab}
        onCollapseChange={setWorkspaceCollapsed}
        onCreate={(name) => sendWorkspaceCommand({ type: 'createWorkspace', name })}
        onCommand={sendWorkspaceCommand}
        onPagesCommand={sendPagesCommand}
        onRefreshTab={(tabId) => { void sendWorkspaceCommand({ type: 'refreshTabContext', tabId }); }}
        onCaptureVisualSelection={async (tabId) => {
          const message = await sendWorkspaceCommand({ type: 'captureVisualSelection', tabId });
          return { ok: message === null, ...(message ? { message } : {}) };
        }}
        onClearVisualSelection={() => { void sendWorkspaceCommand({ type: 'clearVisualSelection' }); }}
        tandem={tandemSnapshot}
        onTandemCommand={sendTandemCommand}
        onOpenSettings={() => { void window.poppinSettings.command({ type: 'open' }); }}
        onRunRecipe={(prompt) => {
          setMailActive(false);
          setTaskTabActive(true);
          const connection = taskSnapshot.connection;
          const model = connection.models[0]?.id ?? 'gpt-5';
          const effort = 'medium';
          const canContinue = Boolean(taskSnapshot.task && !taskSnapshot.task.pendingApproval
            && ['Needs Approval', 'Completed', 'Failed', 'Cancelled'].includes(taskSnapshot.task.state));
          if (canContinue) {
            void sendTaskCommand({ type: 'continueTask', prompt });
            return;
          }
          void sendTaskCommand({ type: 'startTask', prompt, model, reasoningEffort: effort, kind: 'work', useBrowser: true });
        }}
      />
      {!layoutWorkspaceCollapsed ? (
        <PaneResizer
          side="left"
          width={leftPaneWidth}
          {...getLeftPaneWidthRange(viewport.width)}
          onResize={resizeLeftPane}
        />
      ) : null}
      {!layoutPadCollapsed ? (
        <PaneResizer
          side="right"
          width={rightPaneWidth}
          {...getRightPaneWidthRange(viewport.width, leftPaneWidth, layoutWorkspaceCollapsed)}
          onResize={resizeRightPane}
        />
      ) : null}
      <PoppinPadPane
        snapshot={padLayoutSnapshot}
        onCollapseChange={() => undefined}
        onCommand={sendPadCommand}
      />
      {mailActive ? (
        <div className={`task-stage ${layoutWorkspaceCollapsed ? 'workspace-collapsed' : ''}`}>
          <MailSection
            workspace={workspaceSnapshot}
            tabs={snapshot.tabs}
            onCommand={sendWorkspaceCommandResult}
            onOpenInbox={async (url) => {
              const existingId = mailInboxTabId(snapshot.tabs, url);
              const existingTab = snapshot.tabs.find((tab) => tab.id === existingId);
              const reusable = isReusableMailAgentSession(url, snapshot.tabs, browserAgentSnapshot)
                && Boolean(existingTab?.taskSpaceId && browserAgentSnapshot.taskSpace?.tabIds.includes(existingTab.id));
              if (reusable) {
                setMailActive(false);
                setTaskTabActive(false);
                void sendPagesCommand({ type: 'deactivateTabs' });
                if (browserAgentSnapshot.state === 'paused' || browserAgentSnapshot.state === 'completed' || browserAgentSnapshot.state === 'stopped') {
                  const resumed = await sendBrowserAgentCommand({ type: 'resume' });
                  if (!resumed.ok) return resumed;
                }
                return sendBrowserAgentCommand({ type: 'watch' });
              }
              const result = await sendBrowserAgentCommand({
                type: 'start',
                taskId: `mail-${crypto.randomUUID()}`,
                name: 'Mail',
                mode: 'browser-only',
                tabIds: [],
                url,
              });
              if (result.ok) {
                setMailActive(false);
                setTaskTabActive(false);
                void sendPagesCommand({ type: 'deactivateTabs' });
              }
              return result.ok ? result : { ok: false, message: result.message ?? 'Could not open Mail as Agent Tabs.' };
            }}
          />
        </div>
      ) : taskTabActive ? (
        <div className={`task-stage ${layoutWorkspaceCollapsed ? 'workspace-collapsed' : ''}`}>
          <TaskTabView
            taskSnapshot={taskSnapshot}
            workspace={workspaceSnapshot}
            browserAgentSnapshot={browserAgentSnapshot}
            onTaskCommand={sendTaskCommand}
            onBrowserAgentCommand={sendBrowserAgentCommand}
            onWorkspaceCommand={sendWorkspaceCommandResult}
          />
        </div>
      ) : activeNativeTab ? (
        <div className={`native-stage ${layoutWorkspaceCollapsed ? 'workspace-collapsed' : ''}`}>
          {activeNativeTab.kind === 'database'
            ? <NativeDatabaseView pageId={activeNativeTab.pageId} revision={pagesRevision} onCommand={sendPagesCommand} />
            : <NativePageView pageId={activeNativeTab.pageId} revision={pagesRevision} onCommand={sendPagesCommand} taskSnapshot={taskSnapshot} onTaskCommand={sendTaskCommand} onTaskStarted={() => { setMailActive(false); setTaskTabActive(true); }} />}
        </div>
      ) : <div className={`browser-stage ${layoutWorkspaceCollapsed ? 'workspace-collapsed' : ''}`} aria-hidden="true" />}
      {showAgentDock ? (
        <AgentDock
          taskSnapshot={taskSnapshot}
          browserAgentSnapshot={browserAgentSnapshot}
          onTaskCommand={sendTaskCommand}
          onBrowserAgentCommand={sendBrowserAgentCommand}
          onOpenTaskTab={() => { setMailActive(false); setTaskTabActive(true); }}
        />
      ) : null}
      <CommandBar snapshot={taskSnapshot} workspace={workspaceSnapshot} pad={padSnapshot} collapsed={commandCollapsed} onCollapseChange={setCommandCollapsed} onCommand={sendTaskCommand} onPadCommand={sendPadCommand} onOverlayHeightChange={setCommandOverlayHeight} />
    </main>
  );
}
