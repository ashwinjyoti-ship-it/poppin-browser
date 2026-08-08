import { ArrowLeft, ArrowRight, LockKeyhole, RefreshCw, RotateCcw, Search, Settings2, X } from 'lucide-react';
import { type FormEvent, type RefObject } from 'react';

import type { BrowserSettings, BrowserTabSnapshot } from '../../shared/browser';

interface BrowserToolbarProps {
  activeTab: BrowserTabSnapshot | null;
  address: string;
  addressError: string;
  settings: BrowserSettings;
  settingsOpen: boolean;
  canReopenClosedTab: boolean;
  addressInputRef: RefObject<HTMLInputElement | null>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onReopenClosedTab: () => void;
  onSettingsOpenChange: (open: boolean) => void;
  onUpdateSettings: (settings: Partial<BrowserSettings>) => void;
  onSubmit: (event: FormEvent) => void;
}

export function BrowserToolbar({
  activeTab,
  address,
  addressError,
  settings,
  settingsOpen,
  canReopenClosedTab,
  addressInputRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onBack,
  onForward,
  onReload,
  onReopenClosedTab,
  onSettingsOpenChange,
  onUpdateSettings,
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
          aria-label="Browser settings"
          aria-expanded={settingsOpen}
          onClick={() => onSettingsOpenChange(!settingsOpen)}
        >
          <Settings2 size={18} />
        </button>
      </div>

      {settingsOpen ? (
        <BrowserSettingsPanel
          settings={settings}
          canReopenClosedTab={canReopenClosedTab}
          onClose={() => onSettingsOpenChange(false)}
          onReopenClosedTab={onReopenClosedTab}
          onUpdate={onUpdateSettings}
        />
      ) : null}
    </div>
  );
}

interface BrowserSettingsPanelProps {
  settings: BrowserSettings;
  canReopenClosedTab: boolean;
  onClose: () => void;
  onReopenClosedTab: () => void;
  onUpdate: (settings: Partial<BrowserSettings>) => void;
}

function BrowserSettingsPanel({ settings, canReopenClosedTab, onClose, onReopenClosedTab, onUpdate }: BrowserSettingsPanelProps) {
  return (
    <aside className="browser-settings-panel" aria-label="Browser settings">
      <div className="settings-heading">
        <div><span>Browser</span><strong>Settings</strong></div>
        <button type="button" aria-label="Close browser settings" onClick={onClose}><X size={15} /></button>
      </div>

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
    </aside>
  );
}
