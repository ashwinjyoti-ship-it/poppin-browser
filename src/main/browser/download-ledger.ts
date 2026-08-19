import {
  DOWNLOADS_HISTORY_LIMIT,
  downloadPercent,
  type DownloadItemSnapshot,
  type DownloadItemState,
  type DownloadsSnapshot,
} from '../../shared/downloads';

export interface DownloadRecord {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadItemState;
  startedAt: number;
  endedAt: number | null;
}

const FINISHED_STATES = new Set<DownloadItemState>(['completed', 'cancelled', 'interrupted']);

/**
 * In-memory download history. Completed items stay until the user dismisses
 * or clears them; the Chromium DownloadItem is not the source of truth.
 */
export class DownloadLedger {
  private readonly items = new Map<string, DownloadRecord>();

  get size(): number {
    return this.items.size;
  }

  get(id: string): DownloadRecord | undefined {
    return this.items.get(id);
  }

  hydrate(records: DownloadItemSnapshot[]): void {
    this.items.clear();
    for (const record of records) {
      const next = snapshotToRecord(record);
      if (!next) continue;
      if (next.state === 'progressing') {
        next.state = 'interrupted';
        next.endedAt = next.endedAt ?? next.startedAt;
      }
      this.items.set(next.id, next);
    }
    this.capFinished();
  }

  begin(record: Omit<DownloadRecord, 'state' | 'endedAt'> & { state?: DownloadItemState }): DownloadRecord {
    const entry: DownloadRecord = {
      ...record,
      state: record.state ?? 'progressing',
      endedAt: null,
    };
    this.items.set(entry.id, entry);
    return entry;
  }

  updateProgress(id: string, receivedBytes: number, totalBytes: number, state?: DownloadItemState): DownloadRecord | undefined {
    const entry = this.items.get(id);
    if (!entry) return undefined;
    if (entry.state === 'completed' || entry.state === 'cancelled') return entry;
    entry.receivedBytes = receivedBytes;
    entry.totalBytes = totalBytes;
    if (state) entry.state = state;
    return entry;
  }

  finish(id: string, state: Exclude<DownloadItemState, 'progressing'>, receivedBytes: number, totalBytes: number, endedAt: number): DownloadRecord | undefined {
    const entry = this.items.get(id);
    if (!entry) return undefined;
    entry.receivedBytes = receivedBytes;
    entry.totalBytes = totalBytes;
    entry.state = state;
    entry.endedAt = endedAt;
    this.capFinished();
    return entry;
  }

  dismiss(id: string): boolean {
    return this.items.delete(id);
  }

  clearFinished(): void {
    for (const [id, entry] of this.items) {
      if (entry.state !== 'progressing') this.items.delete(id);
    }
  }

  snapshot(): DownloadsSnapshot {
    return { items: this.ordered().map(toSnapshot) };
  }

  persistable(): DownloadItemSnapshot[] {
    return this.ordered()
      .filter((entry) => FINISHED_STATES.has(entry.state))
      .slice(0, DOWNLOADS_HISTORY_LIMIT)
      .map(toSnapshot);
  }

  private ordered(): DownloadRecord[] {
    const records = Array.from(this.items.values());
    const progressing = records
      .filter((entry) => entry.state === 'progressing')
      .sort((left, right) => right.startedAt - left.startedAt);
    const finished = records
      .filter((entry) => entry.state !== 'progressing')
      .sort((left, right) => (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt));
    return [...progressing, ...finished];
  }

  private capFinished(): void {
    const finished = this.ordered().filter((entry) => entry.state !== 'progressing');
    for (const extra of finished.slice(DOWNLOADS_HISTORY_LIMIT)) {
      this.items.delete(extra.id);
    }
  }
}

export function toSnapshot(entry: DownloadRecord): DownloadItemSnapshot {
  return {
    id: entry.id,
    filename: entry.filename,
    url: entry.url,
    savePath: entry.savePath,
    receivedBytes: entry.receivedBytes,
    totalBytes: entry.totalBytes,
    state: entry.state,
    percent: entry.state === 'completed' && entry.totalBytes <= 0
      ? 100
      : downloadPercent(entry.receivedBytes, entry.totalBytes),
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
  };
}

function snapshotToRecord(value: DownloadItemSnapshot): DownloadRecord | null {
  if (!value.id || !value.filename) return null;
  return {
    id: value.id,
    filename: value.filename,
    url: value.url,
    savePath: value.savePath,
    receivedBytes: value.receivedBytes,
    totalBytes: value.totalBytes,
    state: value.state,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
  };
}
