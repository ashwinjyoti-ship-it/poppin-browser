export const DOWNLOAD_CHANNELS = {
  command: 'downloads:command',
  getSnapshot: 'downloads:get-snapshot',
  snapshot: 'downloads:snapshot',
} as const;

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
}

export interface DownloadsSnapshot {
  items: DownloadItemSnapshot[];
}

export type DownloadsCommand =
  | { type: 'cancel'; id: string }
  | { type: 'reveal'; id: string }
  | { type: 'dismiss'; id: string }
  | { type: 'clearFinished' };

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

/** Visible chrome height reserved when download rows are showing. */
export function downloadBarHeight(itemCount: number): number {
  if (itemCount <= 0) return 0;
  return 10 + itemCount * 34;
}
