export const DOWNLOAD_CHANNELS = {
  command: 'downloads:command',
  getSnapshot: 'downloads:get-snapshot',
  snapshot: 'downloads:snapshot',
} as const;

export const DOWNLOADS_HISTORY_VERSION = 1;
export const DOWNLOADS_HISTORY_LIMIT = 50;

export type DownloadItemState = 'progressing' | 'completed' | 'cancelled' | 'interrupted';

export interface DownloadItemSnapshot {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadItemState;
  /** 0–100 when totalBytes is known; otherwise null. */
  percent: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface PersistedDownloadsHistory {
  version: typeof DOWNLOADS_HISTORY_VERSION;
  items: DownloadItemSnapshot[];
}

export interface DownloadsSnapshot {
  items: DownloadItemSnapshot[];
  /** True while the downloads overlay window is visible above native page views. */
  open?: boolean;
}

export type DownloadsCommand =
  | { type: 'cancel'; id: string }
  | { type: 'reveal'; id: string }
  | { type: 'dismiss'; id: string }
  | { type: 'clearFinished' }
  | { type: 'openOverlay' }
  | { type: 'closeOverlay' };

export interface DownloadsCommandResult {
  ok: boolean;
  message?: string;
}

export interface PoppinDownloadsApi {
  getSnapshot: () => Promise<DownloadsSnapshot>;
  command: (command: DownloadsCommand) => Promise<DownloadsCommandResult>;
  subscribe: (listener: (snapshot: DownloadsSnapshot) => void) => () => void;
}

export const EMPTY_DOWNLOADS_SNAPSHOT: DownloadsSnapshot = { items: [] };

export function downloadPercent(receivedBytes: number, totalBytes: number): number | null {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100)));
}

export function formatDownloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
}

/** Parent folder name from a download save path, for trusted-shell display only. */
export function downloadDestinationFolder(savePath: string): string {
  const normalized = savePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 2] ?? '';
}

/**
 * Count of downloads still transferring. Consumed by the downloads icon in
 * the toolbar to render a live badge and to short-circuit UI updates when
 * nothing is in flight.
 */
export function countProgressingDownloads(snapshot: DownloadsSnapshot): number {
  let count = 0;
  for (const item of snapshot.items) if (item.state === 'progressing') count += 1;
  return count;
}
