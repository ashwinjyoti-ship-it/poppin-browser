import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole, RefreshCw, Search, X } from 'lucide-react';
import { Fragment, type FormEvent, type RefObject, useState } from 'react';

import type { BrowserTabSnapshot } from '../../shared/browser';

interface BrowserToolbarProps {
  activeTab: BrowserTabSnapshot | null;
  address: string;
  addressError: string;
  googleSignInHelp: boolean;
  addressInputRef: RefObject<HTMLInputElement | null>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onShowGoogleSignInAlternatives: () => void;
  onSubmit: (event: FormEvent) => void;
}

export function BrowserToolbar({
  activeTab,
  address,
  addressError,
  googleSignInHelp,
  addressInputRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onBack,
  onForward,
  onReload,
  onShowGoogleSignInAlternatives,
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

      {googleSignInHelp ? (
        <GoogleSignInAssistance onShowAlternatives={onShowGoogleSignInAlternatives} />
      ) : <div className="toolbar-actions" />}
    </div>
  );
}

function GoogleSignInAssistance({ onShowAlternatives }: { onShowAlternatives: () => void }) {
  const [open, setOpen] = useState(true);

  return (
    <Fragment>
      <div className="toolbar-actions">
        <button
          type="button"
          className="sign-in-help-button"
          aria-label="Google sign-in help"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <KeyRound size={17} />
          <span>Sign-in help</span>
        </button>
      </div>

      {open ? (
        <aside className="google-sign-in-help" aria-label="Google sign-in guidance">
          <KeyRound size={17} aria-hidden="true" />
          <div>
            <strong>Finish signing in to Google</strong>
            <p>Poppin has a separate secure browser session. Show Google’s other methods, then use a phone prompt, security key, or password. Poppin remembers the login after it succeeds.</p>
          </div>
          <button
            type="button"
            className="google-sign-in-fallback"
            onClick={() => {
              onShowAlternatives();
              setOpen(false);
            }}
          >
            Show other methods
          </button>
          <button type="button" className="google-sign-in-close" aria-label="Dismiss Google sign-in help" onClick={() => setOpen(false)}>
            <X size={14} />
          </button>
        </aside>
      ) : null}
    </Fragment>
  );
}
