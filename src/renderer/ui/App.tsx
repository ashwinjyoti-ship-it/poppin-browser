import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from 'react';

import type { BrowserCommand, BrowserSnapshot } from '../../shared/browser';
import type { WorkspaceCommand, WorkspaceSnapshot } from '../../shared/workspace';
import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import { isGoogleAccountsUrl } from '../../shared/google-auth';
import { Brand } from './Brand';
import { BrowserToolbar } from './BrowserToolbar';
import { TabStrip } from './TabStrip';
import { WorkspacePane } from './WorkspacePane';
import { ContextPane } from './ContextPane';
import { CommandBar } from './CommandBar';
import { PaneResizer } from './PaneResizer';
import { getChromeLayout } from './chrome-layout';
import { issueForCommand, visibleAddressIssue, type AddressIssue } from './address-issue';
import {
  clampResizedPaneWidth,
  getPaneWidthRange,
  loadPaneWidths,
  normalizePaneWidths,
  savePaneWidths,
  type PaneSide,
} from './pane-layout';

const EMPTY_SNAPSHOT: BrowserSnapshot = { tabs: [], activeTabId: '' };
const EMPTY_WORKSPACE: WorkspaceSnapshot = { workspace: null, documents: [], tabContexts: [], project: null };
const EMPTY_TASK: TaskSnapshot = { connection: { state: 'checking', message: 'Connecting to Codex…', accountLabel: null, models: [] }, task: null };

export function App() {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>(EMPTY_SNAPSHOT);
  const [addressDraft, setAddressDraft] = useState('');
  const [addressIssue, setAddressIssue] = useState<AddressIssue | null>(null);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [taskSnapshot, setTaskSnapshot] = useState<TaskSnapshot>(EMPTY_TASK);
  const [commandCollapsed, setCommandCollapsed] = useState(false);
  const [preferredPaneWidths, setPreferredPaneWidths] = useState(() => loadPaneWidths(window.localStorage));
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const addressInputRef = useRef<HTMLInputElement>(null);

  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
  const address = isEditingAddress ? addressDraft : activeTab?.url ?? '';
  const addressError = visibleAddressIssue(addressIssue, activeTab);
  const chromeLayout = getChromeLayout(viewport.width, viewport.height);
  const paneWidths = normalizePaneWidths(preferredPaneWidths, viewport.width);
  const paneStyle = {
    '--chrome-height': `${chromeLayout.height}px`,
    '--workspace-pane-width': `${paneWidths.left}px`,
    '--context-pane-width': `${paneWidths.right}px`,
  } as CSSProperties;

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
    void window.poppinTask.getSnapshot().then((initialSnapshot) => {
      if (mounted) setTaskSnapshot(initialSnapshot);
    });
    const unsubscribeTask = window.poppinTask.subscribe(setTaskSnapshot);
    const unsubscribeFocus = window.poppinBrowser.onFocusAddress(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });
    return () => {
      mounted = false;
      unsubscribeSnapshot();
      unsubscribeWorkspace();
      unsubscribeTask();
      unsubscribeFocus();
    };
  }, []);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
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
      rightInset: contextCollapsed ? 46 : paneWidths.right + 14,
      bottomInset: commandCollapsed ? 0 : 94,
    });
  }, [chromeLayout.height, commandCollapsed, contextCollapsed, paneWidths.left, paneWidths.right, workspaceCollapsed]);

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

  return (
    <main className={`app-shell chrome-${chromeLayout.density} ${commandCollapsed ? 'command-is-collapsed' : ''}`} style={paneStyle}>
      <header className="browser-chrome">
        <div className="top-row">
          <Brand />
          <BrowserToolbar
            activeTab={activeTab}
            address={address}
            addressError={addressError}
            googleSignInHelp={Boolean(activeTab && isGoogleAccountsUrl(activeTab.url))}
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
            onShowGoogleSignInAlternatives={() => {
              if (activeTab) void sendCommand({ type: 'showGoogleSignInAlternatives', tabId: activeTab.id });
            }}
            onSubmit={submitAddress}
          />
        </div>
        <TabStrip
          tabs={snapshot.tabs}
          activeTabId={snapshot.activeTabId}
          onActivate={(tabId) => void sendCommand({ type: 'activate', tabId })}
          onClose={(tabId) => void sendCommand({ type: 'close', tabId })}
          onCreate={() => void sendCommand({ type: 'create' })}
        />
      </header>
      <WorkspacePane
        collapsed={workspaceCollapsed}
        snapshot={workspaceSnapshot}
        tabs={snapshot.tabs}
        onCollapseChange={setWorkspaceCollapsed}
        onCreate={(name) => sendWorkspaceCommand({ type: 'createWorkspace', name })}
        onCommand={sendWorkspaceCommand}
      />
      <ContextPane
        collapsed={contextCollapsed}
        snapshot={workspaceSnapshot}
        taskSnapshot={taskSnapshot}
        onCollapseChange={setContextCollapsed}
        onRefreshTab={(tabId) => { void sendWorkspaceCommand({ type: 'refreshTabContext', tabId }); }}
        onTaskCommand={sendTaskCommand}
      />
      {!workspaceCollapsed ? (
        <PaneResizer
          side="left"
          width={paneWidths.left}
          {...getPaneWidthRange('left', viewport.width, paneWidths.right)}
          onResize={(width) => resizePane('left', width)}
        />
      ) : null}
      {!contextCollapsed ? (
        <PaneResizer
          side="right"
          width={paneWidths.right}
          {...getPaneWidthRange('right', viewport.width, paneWidths.left)}
          onResize={(width) => resizePane('right', width)}
        />
      ) : null}
      <div className={`browser-stage ${workspaceCollapsed ? 'workspace-collapsed' : ''} ${contextCollapsed ? 'context-collapsed' : ''}`} aria-hidden="true" />
      <CommandBar snapshot={taskSnapshot} collapsed={commandCollapsed} onCollapseChange={setCommandCollapsed} onCommand={sendTaskCommand} />
    </main>
  );
}
