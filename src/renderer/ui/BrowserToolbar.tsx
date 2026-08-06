import { ArrowLeft, ArrowRight, LockKeyhole, RefreshCw, Search } from 'lucide-react';
import { type FormEvent, type RefObject } from 'react';

import type { BrowserTabSnapshot } from '../../shared/browser';

interface BrowserToolbarProps {
  activeTab: BrowserTabSnapshot | null;
  address: string;
  addressError: string;
  addressInputRef: RefObject<HTMLInputElement | null>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSubmit: (event: FormEvent) => void;
}

export function BrowserToolbar({
  activeTab,
  address,
  addressError,
  addressInputRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onBack,
  onForward,
  onReload,
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

      <div className="toolbar-spacer" aria-hidden="true" />
    </div>
  );
}

