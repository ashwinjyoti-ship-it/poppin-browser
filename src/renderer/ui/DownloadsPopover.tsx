import { Download, FolderOpen, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { countProgressingDownloads, formatDownloadBytes, type DownloadItemSnapshot, type DownloadsSnapshot } from '../../shared/downloads';

interface DownloadsPopoverProps {
  snapshot: DownloadsSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: (id: string) => void;
  onReveal: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearFinished?: () => void;
}

/**
 * Compact downloads UI. Replaces the old chrome-height download bar so
 * downloads never steal viewport from the active page. Clicking the toolbar
 * icon opens the popover; a live badge shows the count of downloads still in
 * progress.
 */
export function DownloadsPopover({
  snapshot,
  open,
  onOpenChange,
  onCancel,
  onReveal,
  onDismiss,
  onClearFinished,
}: DownloadsPopoverProps) {
  const activeCount = countProgressingDownloads(snapshot);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false); };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, onOpenChange]);

  const label = activeCount > 0
    ? `Downloads (${activeCount} in progress)`
    : snapshot.items.length > 0
      ? `Downloads (${snapshot.items.length})`
      : 'Downloads';

  return (
    <div className="downloads-menu" ref={wrapperRef}>
      <button
        type="button"
        className="downloads-button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => onOpenChange(!open)}
      >
        <Download size={17} strokeWidth={1.8} />
        {activeCount > 0 ? (
          <span className="downloads-badge" aria-hidden="true">{activeCount}</span>
        ) : null}
      </button>
      {open ? (
        <section
          className="downloads-popover"
          role="dialog"
          aria-label="Downloads"
          aria-live="polite"
        >
          <header className="downloads-popover-heading">
            <strong>Downloads</strong>
            {onClearFinished && snapshot.items.some((item) => item.state !== 'progressing') ? (
              <button type="button" className="downloads-clear" onClick={onClearFinished}>Clear finished</button>
            ) : null}
          </header>
          {snapshot.items.length === 0 ? (
            <p className="downloads-empty">No downloads yet.</p>
          ) : (
            <ul className="downloads-popover-list">
              {snapshot.items.map((item) => (
                <li key={item.id} className={`download-bar-item download-bar-item-${item.state}`}>
                  <DownloadRow item={item} onCancel={onCancel} onReveal={onReveal} onDismiss={onDismiss} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function DownloadRow({
  item,
  onCancel,
  onReveal,
  onDismiss,
}: {
  item: DownloadItemSnapshot;
  onCancel: (id: string) => void;
  onReveal: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const label = statusLabel(item);
  const percent = item.percent;
  return (
    <>
      <div className="download-bar-copy">
        <strong className="download-bar-name" title={item.filename}>{item.filename}</strong>
        <span className="download-bar-meta">{label}</span>
      </div>
      <div
        className="download-bar-track"
        role="progressbar"
        aria-label={`${item.filename} download progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? label : `${percent} percent`}
      >
        <span
          className={`download-bar-fill ${percent === null && item.state === 'progressing' ? 'download-bar-fill-indeterminate' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className="download-bar-actions">
        {item.state === 'completed' ? (
          <button type="button" aria-label={`Show ${item.filename} in Finder`} title="Show in Finder" onClick={() => onReveal(item.id)}>
            <FolderOpen size={14} />
          </button>
        ) : null}
        {item.state === 'progressing' ? (
          <button type="button" aria-label={`Cancel downloading ${item.filename}`} title="Cancel" onClick={() => onCancel(item.id)}>
            <X size={14} />
          </button>
        ) : (
          <button type="button" aria-label={`Dismiss ${item.filename}`} title="Dismiss" onClick={() => onDismiss(item.id)}>
            <X size={14} />
          </button>
        )}
      </div>
    </>
  );
}

function statusLabel(item: DownloadItemSnapshot): string {
  if (item.state === 'completed') return 'Downloaded';
  if (item.state === 'cancelled') return 'Cancelled';
  if (item.state === 'interrupted') return 'Interrupted';
  if (item.percent !== null) {
    return `${item.percent}% · ${formatDownloadBytes(item.receivedBytes)} of ${formatDownloadBytes(item.totalBytes)}`;
  }
  return `${formatDownloadBytes(item.receivedBytes)} downloaded`;
}

