import { ArrowLeft, ArrowRight, LockKeyhole, RefreshCw, RotateCcw, Search, Settings2, Unplug, X } from 'lucide-react';
import { type FormEvent, type RefObject, useState } from 'react';

import type { BrowserSettings, BrowserTabSnapshot } from '../../shared/browser';
import type { TandemSnapshot } from '../../shared/tandem';
import type { TandemSettingsCommand } from '../../shared/settings-overlay';

interface BrowserToolbarProps {
  activeTab: BrowserTabSnapshot | null;
  address: string;
  addressError: string;
  settingsOpen: boolean;
  addressInputRef: RefObject<HTMLInputElement | null>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSettingsOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent) => void;
}

export function BrowserToolbar({
  activeTab,
  address,
  addressError,
  settingsOpen,
  addressInputRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onBack,
  onForward,
  onReload,
  onSettingsOpenChange,
  onSubmit,
}: BrowserToolbarProps) {
  return (
    <div className="toolbar-controls">
      <div className="navigation-buttons">
        <button type="button" aria-label="Go back" disabled={!activeTab?.canGoBack} onClick={onBack}>
          <ArrowLeft size={20} strokeWidth={1.8} />
        </button>
        <button type="button" aria-label="Go forward" disabled={!activeTab?.canGoForward} onClick={onForward}>
          <ArrowRight size={20} strokeWidth={1.8} />
        </button>
        <button type="button" aria-label="Refresh page" disabled={!activeTab} onClick={onReload}>
          <RefreshCw size={19} strokeWidth={1.8} />
        </button>
      </div>

      <form className={`address-form ${addressError ? 'address-form-error' : ''}`} onSubmit={onSubmit}>
        <span className="address-leading" aria-hidden="true">
          {address.startsWith('https://') ? <LockKeyhole size={15} /> : <Search size={16} />}
        </span>
        <input
          ref={addressInputRef}
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          onFocus={onAddressFocus}
          onBlur={onAddressBlur}
          aria-label="Address and search"
          aria-invalid={Boolean(addressError)}
          placeholder="Search or enter address"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {activeTab?.isLoading ? <span className="address-progress" /> : null}
        {addressError ? <span className="address-error" role="alert">{addressError}</span> : null}
      </form>

      <div className="toolbar-actions">
        <button
          type="button"
          className="settings-button"
          aria-label="Poppin settings"
          aria-expanded={settingsOpen}
          onClick={() => onSettingsOpenChange(!settingsOpen)}
        >
          <Settings2 size={18} />
        </button>
      </div>
    </div>
  );
}

interface BrowserSettingsPanelProps {
  settings: BrowserSettings;
  canReopenClosedTab: boolean;
  onClose: () => void;
  onReopenClosedTab: () => void;
  onUpdate: (settings: Partial<BrowserSettings>) => void;
  tandem?: TandemSnapshot;
  onTandemCommand?: (command: TandemSettingsCommand) => Promise<string | null>;
}

export function BrowserSettingsPanel({ settings, canReopenClosedTab, onClose, onReopenClosedTab, onUpdate, tandem, onTandemCommand }: BrowserSettingsPanelProps) {
  return (
    <aside className="browser-settings-panel" aria-label="Poppin settings">
      <div className="settings-heading">
        <div><span>Poppin</span><strong>Settings</strong></div>
        <button type="button" aria-label="Close Poppin settings" onClick={onClose}><X size={15} /></button>
      </div>

      <section className="settings-section" aria-labelledby="browser-settings-heading">
        <h3 id="browser-settings-heading">Browser</h3>
        <label>
          Links open in
          <select value={settings.linkOpening} onChange={(event) => onUpdate({ linkOpening: event.target.value as BrowserSettings['linkOpening'] })}>
            <option value="follow-site">Follow website; preview other sites</option>
            <option value="new-tab">Always a new tab</option>
            <option value="same-tab">Always the current tab</option>
          </select>
        </label>
        <label>
          New tabs appear
          <select value={settings.newTabPosition} onChange={(event) => onUpdate({ newTabPosition: event.target.value as BrowserSettings['newTabPosition'] })}>
            <option value="next-to-active">Next to the active tab</option>
            <option value="end">At the end</option>
          </select>
        </label>
        <label>
          On startup
          <select value={settings.startup} onChange={(event) => onUpdate({ startup: event.target.value as BrowserSettings['startup'] })}>
            <option value="restore">Restore previous session</option>
            <option value="new-tab">Open a new tab</option>
          </select>
        </label>
        <label>
          Search engine
          <select value={settings.searchEngine} onChange={(event) => onUpdate({ searchEngine: event.target.value as BrowserSettings['searchEngine'] })}>
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="google">Google</option>
          </select>
        </label>

        <label className="settings-toggle">
          <input type="checkbox" checked={settings.focusNewTabs} onChange={(event) => onUpdate({ focusNewTabs: event.target.checked })} />
          Switch to newly opened tabs
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={settings.warnBeforeClosingMultipleTabs} onChange={(event) => onUpdate({ warnBeforeClosingMultipleTabs: event.target.checked })} />
          Warn before closing multiple tabs
        </label>

        <button type="button" className="settings-secondary" disabled={!canReopenClosedTab} onClick={onReopenClosedTab}>
          <RotateCcw size={14} /> Reopen closed tab
        </button>
      </section>
      {tandem && onTandemCommand ? <TandemSettings snapshot={tandem} onCommand={onTandemCommand} /> : null}
    </aside>
  );
}

function TandemSettings({ snapshot, onCommand }: { snapshot: TandemSnapshot; onCommand: (command: TandemSettingsCommand) => Promise<string | null> }) {
  const [baseUrl, setBaseUrl] = useState(snapshot.connection.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (command: TandemSettingsCommand) => {
    setBusy(true);
    const error = await onCommand(command);
    setBusy(false);
    setMessage(error ?? '');
    return error;
  };

  return (
    <section className="settings-section tandem-settings" aria-labelledby="tandem-settings-heading">
      <div className="settings-section-heading">
        <h3 id="tandem-settings-heading">Tandem integration</h3>
        <span className={`integration-status integration-status-${snapshot.connection.state}`}>{snapshot.connection.state}</span>
      </div>
      <p>{snapshot.connection.message}</p>
      <label htmlFor="tandem-settings-address">Tandem address</label>
      <input id="tandem-settings-address" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://tandem.example.com" autoComplete="off" />
      <label htmlFor="tandem-settings-key">API key</label>
      <input id="tandem-settings-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={snapshot.connection.hasCredential ? 'Stored securely — paste to replace' : 'udm_…'} autoComplete="off" />
      <small>The key is sealed in the macOS Keychain and never reaches Tandem World or another web page.</small>
      <div className="tandem-actions">
        <button type="button" className="settings-secondary" disabled={busy || !baseUrl.trim() || !apiKey.trim()} onClick={() => { void run({ type: 'connect', baseUrl, apiKey }).then((error) => { if (!error) setApiKey(''); }); }}>{snapshot.connection.state === 'ready' ? 'Update connection' : 'Connect Tandem'}</button>
        {snapshot.connection.hasCredential ? <button type="button" className="settings-secondary" disabled={busy} onClick={() => { void run({ type: 'refreshConnection' }); }}><RefreshCw size={13} /> Retry</button> : null}
        {snapshot.connection.hasCredential ? <button type="button" className="settings-secondary settings-danger" disabled={busy} onClick={() => { void run({ type: 'disconnect' }); }}><Unplug size={13} /> Disconnect</button> : null}
      </div>
      {message ? <span className="form-error" role="alert">{message}</span> : null}
    </section>
  );
}
