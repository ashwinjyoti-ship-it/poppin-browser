import { FolderOpen, X } from 'lucide-react';

import { formatDownloadBytes, type DownloadItemSnapshot, type DownloadsSnapshot } from '../../shared/downloads';

interface DownloadBarProps {
  snapshot: DownloadsSnapshot;
  onCancel: (id: string) => void;
  onReveal: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function DownloadBar({ snapshot, onCancel, onReveal, onDismiss }: DownloadBarProps) {
  if (snapshot.items.length === 0) return null;

  return (
    <section className="download-bar" aria-label="Downloads" aria-live="polite">
      <ul className="download-bar-list">
        {snapshot.items.map((item) => (
          <li key={item.id} className={`download-bar-item download-bar-item-${item.state}`}>
            <DownloadRow item={item} onCancel={onCancel} onReveal={onReveal} onDismiss={onDismiss} />
          </li>
        ))}
      </ul>
    </section>
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
