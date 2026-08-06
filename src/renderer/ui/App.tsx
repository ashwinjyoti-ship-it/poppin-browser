import { type FormEvent, useEffect, useRef, useState } from 'react';

import type { BrowserCommand, BrowserSnapshot } from '../../shared/browser';
import { Brand } from './Brand';
import { BrowserToolbar } from './BrowserToolbar';
import { TabStrip } from './TabStrip';

const EMPTY_SNAPSHOT: BrowserSnapshot = { tabs: [], activeTabId: '' };

export function App() {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>(EMPTY_SNAPSHOT);
  const [addressDraft, setAddressDraft] = useState('');
  const [addressError, setAddressError] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);

  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
  const address = isEditingAddress ? addressDraft : activeTab?.url ?? '';

  useEffect(() => {
    let mounted = true;
    void window.poppinBrowser.getSnapshot().then((initialSnapshot) => {
      if (mounted) setSnapshot(initialSnapshot);
    });
    const unsubscribeSnapshot = window.poppinBrowser.subscribe(setSnapshot);
    const unsubscribeFocus = window.poppinBrowser.onFocusAddress(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });
    return () => {
      mounted = false;
      unsubscribeSnapshot();
      unsubscribeFocus();
    };
  }, []);

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
      <div className="browser-stage" aria-hidden="true" />
    </main>
  );
}
