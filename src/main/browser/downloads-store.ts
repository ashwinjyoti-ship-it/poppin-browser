import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DOWNLOADS_HISTORY_LIMIT,
  DOWNLOADS_HISTORY_VERSION,
  downloadPercent,
  type DownloadItemSnapshot,
  type DownloadItemState,
  type PersistedDownloadsHistory,
} from '../../shared/downloads';

const FINISHED_STATES = new Set<DownloadItemState>(['completed', 'cancelled', 'interrupted']);

export class DownloadsHistoryStore {
  readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'downloads-history.json');
  }

  async load(): Promise<DownloadItemSnapshot[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      return normalizePersistedDownloadsHistory(value);
    } catch {
      return [];
    }
  }

  async save(items: DownloadItemSnapshot[]): Promise<void> {
    const payload: PersistedDownloadsHistory = {
      version: DOWNLOADS_HISTORY_VERSION,
      items: items
        .filter((item) => FINISHED_STATES.has(item.state))
        .slice(0, DOWNLOADS_HISTORY_LIMIT),
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

export function normalizePersistedDownloadsHistory(value: unknown): DownloadItemSnapshot[] {
  if (!value || typeof value !== 'object') return [];
  const candidate = value as { version?: unknown; items?: unknown };
  if (candidate.version !== DOWNLOADS_HISTORY_VERSION || !Array.isArray(candidate.items)) return [];

  const items: DownloadItemSnapshot[] = [];
  const ids = new Set<string>();
  for (const entry of candidate.items) {
    const item = normalizeDownloadHistoryItem(entry);
    if (!item || ids.has(item.id)) continue;
    ids.add(item.id);
    items.push(item);
    if (items.length >= DOWNLOADS_HISTORY_LIMIT) break;
  }
  return items;
}

function normalizeDownloadHistoryItem(value: unknown): DownloadItemSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DownloadItemSnapshot>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null;
  if (typeof candidate.filename !== 'string' || candidate.filename.length === 0) return null;
  if (typeof candidate.url !== 'string') return null;
  if (typeof candidate.savePath !== 'string' || candidate.savePath.length === 0) return null;
  if (!isNonNegativeNumber(candidate.receivedBytes) || !isFiniteNumber(candidate.totalBytes)) return null;
  if (!FINISHED_STATES.has(candidate.state as DownloadItemState)) return null;
  if (!isFiniteNumber(candidate.startedAt)) return null;
  const endedAt = candidate.endedAt === null || candidate.endedAt === undefined
    ? candidate.startedAt
    : candidate.endedAt;
  if (!isFiniteNumber(endedAt)) return null;

  const receivedBytes = candidate.receivedBytes;
  const totalBytes = candidate.totalBytes;
  return {
    id: candidate.id,
    filename: candidate.filename,
    url: candidate.url,
    savePath: candidate.savePath,
    receivedBytes,
    totalBytes,
    state: candidate.state as DownloadItemState,
    percent: candidate.state === 'completed' && totalBytes <= 0
      ? 100
      : downloadPercent(receivedBytes, totalBytes),
    startedAt: candidate.startedAt,
    endedAt,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
