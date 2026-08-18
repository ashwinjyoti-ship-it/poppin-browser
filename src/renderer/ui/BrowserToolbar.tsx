import { ArrowLeft, ArrowRight, BookOpenText, LayoutGrid, LockKeyhole, RefreshCw, RotateCcw, Search, Settings2, Unplug, X } from 'lucide-react';
import { type FormEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';

import type { BrowserEnteredUrl, BrowserSettings, BrowserTabSnapshot } from '../../shared/browser';
import type { ContinuityCommand, ContinuitySnapshot } from '../../shared/continuity';
import type { TandemSnapshot } from '../../shared/tandem';
import type { TandemSettingsCommand } from '../../shared/settings-overlay';
import { previousHistoryEntries, suggestEnteredUrls } from './url-recall';

interface BrowserToolbarProps {
  activeTab: BrowserTabSnapshot | null;
  enteredUrls?: BrowserEnteredUrl[];
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
  onGoToHistoryIndex?: (index: number) => void;
  onSelectSuggestion?: (url: string) => void;
  onOpenTabSearch?: () => void;
  onOpenTandemBeside?: () => void;
  onSettingsOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onOverlayOpenChange?: (open: boolean) => void;
  /**
   * Downloads trigger. The list opens in a child overlay window so it can
   * paint above native page views without shrinking the viewport.
   */
  downloadsSlot?: ReactNode;
  padOpen?: boolean;
  onTogglePad?: () => void;
}

const BACK_LONG_PRESS_MS = 450;

export function BrowserToolbar({
  activeTab,
  enteredUrls = [],
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
  onGoToHistoryIndex,
  onSelectSuggestion,
  onOpenTabSearch,
  onOpenTandemBeside,
  onSettingsOpenChange,
  onSubmit,
  onOverlayOpenChange,
  downloadsSlot,
  padOpen = false,
  onTogglePad,
}: BrowserToolbarProps) {
  const [backMenuOpen, setBackMenuOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const backMenuRef = useRef<HTMLDivElement>(null);
  const backLongPressRef = useRef(false);
  const backPressTimerRef = useRef<number | null>(null);
  const previousEntries = useMemo(() => previousHistoryEntries(activeTab), [activeTab]);
  const suggestions = useMemo(
    () => (suggestionsOpen ? suggestEnteredUrls(address, enteredUrls) : []),
    [address, enteredUrls, suggestionsOpen],
  );

  useEffect(() => {
    onOverlayOpenChange?.(backMenuOpen || (suggestionsOpen && suggestions.length > 0));
  }, [backMenuOpen, onOverlayOpenChange, suggestions.length, suggestionsOpen]);

  useEffect(() => {
    if (!backMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!backMenuRef.current?.contains(event.target as Node)) setBackMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [backMenuOpen]);

  const clearBackPressTimer = () => {
    if (backPressTimerRef.current !== null) {
      window.clearTimeout(backPressTimerRef.current);
      backPressTimerRef.current = null;
    }
  };

  return (
    <div className="toolbar-controls">
      <div className="navigation-buttons">
        <div className="back-control" ref={backMenuRef}>
          <button
            type="button"
            aria-label="Go back"
            title="Go back (hold for history)"
            aria-expanded={backMenuOpen}
            disabled={!activeTab?.canGoBack && previousEntries.length === 0}
            onPointerDown={() => {
              backLongPressRef.current = false;
              clearBackPressTimer();
              if (previousEntries.length === 0) return;
              backPressTimerRef.current = window.setTimeout(() => {
                backLongPressRef.current = true;
                setBackMenuOpen(true);
              }, BACK_LONG_PRESS_MS);
            }}
            onPointerUp={clearBackPressTimer}
            onPointerLeave={clearBackPressTimer}
            onClick={() => {
              if (backLongPressRef.current) {
                backLongPressRef.current = false;
                return;
              }
              if (backMenuOpen) {
                setBackMenuOpen(false);
                return;
              }
              onBack();
            }}
          >
            <ArrowLeft size={20} strokeWidth={1.8} />
          </button>
          {backMenuOpen && previousEntries.length > 0 ? (
            <ul className="back-history-menu" role="listbox" aria-label="Previous sites in this tab">
              {previousEntries.map((entry) => (
                <li key={`${entry.index}-${entry.url}`}>
                  <button
                    type="button"
                    role="option"
                    onClick={() => {
                      setBackMenuOpen(false);
                      onGoToHistoryIndex?.(entry.index);
                    }}
                  >
                    <strong>{entry.title || entry.url}</strong>
                    <span>{entry.url}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="button" aria-label="Go forward" title="Go forward" disabled={!activeTab?.canGoForward} onClick={onForward}>
          <ArrowRight size={20} strokeWidth={1.8} />
        </button>
        <button type="button" aria-label="Refresh page" title="Refresh page" disabled={!activeTab} onClick={onReload}>
          <RefreshCw size={19} strokeWidth={1.8} />
        </button>
      </div>

      <form
        className={`address-form ${addressError ? 'address-form-error' : ''}`}
        onSubmit={(event) => {
          setSuggestionsOpen(false);
          onSubmit(event);
        }}
      >
        <span className="address-leading" aria-hidden="true">
          {address.startsWith('https://') ? <LockKeyhole size={15} /> : <Search size={16} />}
        </span>
        <input
          ref={addressInputRef}
          value={address}
          onChange={(event) => {
            onAddressChange(event.target.value);
            setSuggestionsOpen(true);
          }}
          onFocus={() => {
            onAddressFocus();
            setSuggestionsOpen(true);
          }}
          onBlur={() => {
            // Delay so suggestion clicks register before the list unmounts.
            window.setTimeout(() => {
              setSuggestionsOpen(false);
              onAddressBlur();
            }, 120);
          }}
          aria-label="Address and search"
          aria-invalid={Boolean(addressError)}
          aria-autocomplete="list"
          aria-expanded={suggestionsOpen && suggestions.length > 0}
          autoComplete="off"
          name="poppin-address"
          placeholder="Search or enter address"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {activeTab?.isLoading ? <span className="address-progress" /> : null}
        {addressError ? <span className="address-error" role="alert">{addressError}</span> : null}
        {suggestionsOpen && suggestions.length > 0 ? (
          <ul className="address-suggestions" role="listbox" aria-label="Previously entered addresses">
            {suggestions.map((suggestion) => (
              <li key={suggestion.url}>
                <button
                  type="button"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSuggestionsOpen(false);
                    onSelectSuggestion?.(suggestion.url);
                  }}
                >
                  <strong>{suggestion.title}</strong>
                  <span>{suggestion.url}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      <div className="toolbar-actions">
        {onOpenTabSearch ? (
          <button
            type="button"
            className="settings-button"
            aria-label="Find in open tabs"
            title="Find in open tabs (⌘F)"
            onClick={onOpenTabSearch}
          >
            <Search size={17} />
          </button>
        ) : null}
        {onOpenTandemBeside ? (
          <button
            type="button"
            className="settings-button"
            aria-label="Tandem beside page"
            title="Keep this page open and annotate in Tandem beside it"
            disabled={!activeTab || activeTab.surface === 'tandem-world'}
            onClick={onOpenTandemBeside}
          >
            <BookOpenText size={17} />
          </button>
        ) : null}
        {onTogglePad ? (
          <button
            type="button"
            className={`settings-button pad-toggle-button pad-toggle-labeled ${padOpen ? 'pad-toggle-button-active' : ''}`}
            aria-label={padOpen ? 'Collapse Poppin Pad' : 'Open Poppin Pad'}
            title={padOpen ? 'Collapse Poppin Pad' : 'Open Poppin Pad canvas'}
            aria-pressed={padOpen}
            onClick={onTogglePad}
          >
            <LayoutGrid size={15} aria-hidden="true" />
            <span>Pad</span>
          </button>
        ) : null}
        {downloadsSlot}
        <button
          type="button"
          className="settings-button"
          aria-label="Poppin settings"
          title="Poppin settings"
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
  continuity?: ContinuitySnapshot;
  onContinuityCommand?: (command: ContinuityCommand) => Promise<string | null>;
}

export function BrowserSettingsPanel({ settings, canReopenClosedTab, onClose, onReopenClosedTab, onUpdate, tandem, onTandemCommand, continuity, onContinuityCommand }: BrowserSettingsPanelProps) {
  return (
    <aside className="browser-settings-panel" aria-label="Poppin settings">
      <div className="settings-heading">
        <div><span>Poppin</span><strong>Settings</strong></div>
        <button type="button" aria-label="Close Poppin settings" title="Close" onClick={onClose}><X size={15} /></button>
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
      {continuity && onContinuityCommand ? <ContinuitySettings snapshot={continuity} onCommand={onContinuityCommand} /> : null}
      {tandem && onTandemCommand ? <TandemSettings snapshot={tandem} onCommand={onTandemCommand} /> : null}
    </aside>
  );
}


function ContinuitySettings({ snapshot, onCommand }: { snapshot: ContinuitySnapshot; onCommand: (command: ContinuityCommand) => Promise<string | null> }) {
  const [profileName, setProfileName] = useState('');
  const [renameName, setRenameName] = useState(snapshot.activeProfile?.name ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (command: ContinuityCommand) => {
    setBusy(true);
    const error = await onCommand(command);
    setBusy(false);
    setMessage(error ?? '');
    return error;
  };

  return (
    <section className="settings-section continuity-settings" aria-labelledby="continuity-settings-heading">
      <div className="settings-section-heading">
        <h3 id="continuity-settings-heading">Profile and continuity</h3>
        <span className={`integration-status${snapshot.continuityReady ? ' integration-status-ready' : ''}`}>
          {snapshot.activeProfile ? snapshot.activeProfile.name : 'No profile'}
        </span>
      </div>
      <p>Create a local profile to export or import tabs, workspace selections, recipes, and settings between Macs. Website logins stay on each Mac.</p>

      {!snapshot.activeProfile ? (
        <>
          <label htmlFor="continuity-profile-name">Profile name</label>
          <input id="continuity-profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Work" autoComplete="off" />
          <button type="button" className="settings-secondary" disabled={busy || !profileName.trim()} onClick={() => { void run({ type: 'createProfile', name: profileName }); }}>
            Create profile
          </button>
        </>
      ) : (
        <>
          <label htmlFor="continuity-rename">Active profile</label>
          <input id="continuity-rename" value={renameName} onChange={(event) => setRenameName(event.target.value)} autoComplete="off" />
          <button type="button" className="settings-secondary" disabled={busy || !renameName.trim() || renameName.trim() === snapshot.activeProfile.name} onClick={() => { void run({ type: 'renameProfile', profileId: snapshot.activeProfile!.id, name: renameName }); }}>
            Rename profile
          </button>
          {snapshot.profiles.length > 1 ? (
            <label>
              Switch profile
              <select
                value={snapshot.activeProfile.id}
                disabled={busy}
                onChange={(event) => { void run({ type: 'switchProfile', profileId: event.target.value }); }}
              >
                {snapshot.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label htmlFor="continuity-passphrase">Continuity passphrase</label>
          <input id="continuity-passphrase" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
          <small>Used only to seal or open a .poppin-continuity file. Not an online account.</small>
          <div className="tandem-actions">
            <button type="button" className="settings-secondary" disabled={busy || passphrase.trim().length < 8} onClick={() => { void run({ type: 'exportContinuity', passphrase }); }}>Export continuity</button>
            <button type="button" className="settings-secondary" disabled={busy || passphrase.trim().length < 8} onClick={() => { void run({ type: 'importContinuity', passphrase }); }}>Import continuity</button>
          </div>
        </>
      )}
      {message ? <span className="form-error" role="alert">{message}</span> : null}
    </section>
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
