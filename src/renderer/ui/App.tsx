import { type FormEvent, useEffect, useRef, useState } from 'react';

import type { BrowserCommand, BrowserSnapshot } from '../../shared/browser';
import type { WorkspaceCommand, WorkspaceSnapshot } from '../../shared/workspace';
import { Brand } from './Brand';
import { BrowserToolbar } from './BrowserToolbar';
import { TabStrip } from './TabStrip';
import { WorkspacePane } from './WorkspacePane';
import { ContextPane } from './ContextPane';

const EMPTY_SNAPSHOT: BrowserSnapshot = { tabs: [], activeTabId: '' };
const EMPTY_WORKSPACE: WorkspaceSnapshot = { workspace: null, documents: [], tabContexts: [], project: null };

export function App() {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>(EMPTY_SNAPSHOT);
  const [addressDraft, setAddressDraft] = useState('');
  const [addressError, setAddressError] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);

  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
  const address = isEditingAddress ? addressDraft : activeTab?.url ?? '';

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
    const unsubscribeFocus = window.poppinBrowser.onFocusAddress(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });
    return () => {
      mounted = false;
      unsubscribeSnapshot();
      unsubscribeWorkspace();
      unsubscribeFocus();
    };
  }, []);

  useEffect(() => {
    void window.poppinBrowser.command({
      type: 'setLayout',
      leftInset: workspaceCollapsed ? 46 : 300,
      rightInset: contextCollapsed ? 46 : 330,
      bottomInset: 0,
    });
  }, [contextCollapsed, workspaceCollapsed]);

  const sendCommand = async (command: BrowserCommand) => {
    try {
      const result = await window.poppinBrowser.command(command);
      setAddressError(result.ok ? '' : result.message ?? 'That action is not available.');
    } catch {
      setAddressError('Poppin could not complete that action.');
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

  return (
    <main className="app-shell">
      <header className="browser-chrome">
        <div className="top-row">
          <Brand />
          <BrowserToolbar
            activeTab={activeTab}
            address={address}
            addressError={addressError}
            addressInputRef={addressInputRef}
            onAddressChange={(value) => {
              setAddressDraft(value);
              setAddressError('');
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
        onCollapseChange={setContextCollapsed}
        onRefreshTab={(tabId) => { void sendWorkspaceCommand({ type: 'refreshTabContext', tabId }); }}
      />
      <div className={`browser-stage ${workspaceCollapsed ? 'workspace-collapsed' : ''} ${contextCollapsed ? 'context-collapsed' : ''}`} aria-hidden="true" />
    </main>
  );
}
