import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  app,
  type BrowserWindow,
  type DownloadItem,
  type Session,
  shell,
} from 'electron';

import {
  EMPTY_DOWNLOADS_SNAPSHOT,
  type DownloadsCommand,
  type DownloadsCommandResult,
  type DownloadsSnapshot,
} from '../../shared/downloads';
import { DownloadLedger } from './download-ledger';
import type { DownloadsHistoryStore } from './downloads-store';

const LIKELY_DOWNLOAD_EXTENSION = /\.(dmg|pkg|zip|exe|msi|deb|rpm|7z|rar|gz|tgz|xz|iso|pdf|csv|xlsx?|docx?|pptx?|mp[34]|mov|mkv|avi|apk|ipa|tar|bz2)(\?|#|$)/i;
const PROGRESS_POLL_MS = 200;

export interface DownloadManagerOptions {
  historyStore?: DownloadsHistoryStore;
  downloadsDirectory?: string;
  now?: () => number;
}

/**
 * Owns Chromium downloads for the browsing session. Without an explicit
 * will-download handler that sets an absolute save path, WebContentsView
 * downloads (especially target=_blank / redirected DMGs) can finish with a
 * missing or truncated file. This manager always pins a unique path under
 * the user's Downloads folder before bytes are written.
 *
 * Finished items stay in the ledger until the user dismisses or clears them,
 * and are persisted so the dropdown still shows history after relaunch.
 */
export class DownloadManager {
  private readonly ledger = new DownloadLedger();
  private readonly liveItems = new Map<string, DownloadItem>();
  private readonly windowRef: () => BrowserWindow | null;
  private readonly historyStore: DownloadsHistoryStore | undefined;
  private readonly downloadsDirectory: string | undefined;
  private readonly now: () => number;
  private emitTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private progressTimer: NodeJS.Timeout | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private registered = false;

  constructor(
    private readonly browserSession: Session,
    getWindow: () => BrowserWindow | null,
    private readonly onSnapshot: (snapshot: DownloadsSnapshot) => void,
    options: DownloadManagerOptions = {},
  ) {
    this.windowRef = getWindow;
    this.historyStore = options.historyStore;
    this.downloadsDirectory = options.downloadsDirectory;
    this.now = options.now ?? Date.now;
  }

  register(): void {
    if (this.registered) return;
    this.registered = true;
    this.browserSession.on('will-download', (_event, item) => {
      this.begin(item);
    });
  }

  async restoreHistory(): Promise<void> {
    if (!this.historyStore) return;
    const items = await this.historyStore.load();
    if (items.length === 0) return;
    this.ledger.hydrate(items);
    this.emitSoon();
  }

  getSnapshot(): DownloadsSnapshot {
    return this.ledger.size ? this.ledger.snapshot() : EMPTY_DOWNLOADS_SNAPSHOT;
  }

  execute(command: DownloadsCommand): DownloadsCommandResult {
    if (command.type === 'openOverlay' || command.type === 'closeOverlay') {
      return { ok: false, message: 'Downloads overlay is owned by the Poppin shell.' };
    }

    if (command.type === 'clearFinished') {
      this.ledger.clearFinished();
      this.emitSoon();
      this.persistSoon();
      return { ok: true };
    }

    const entry = this.ledger.get(command.id);
    if (!entry) return { ok: false, message: 'That download is no longer available.' };

    if (command.type === 'cancel') {
      const live = this.liveItems.get(command.id);
      if (entry.state === 'progressing' && live) live.cancel();
      return { ok: true };
    }

    if (command.type === 'dismiss') {
      const live = this.liveItems.get(command.id);
      if (entry.state === 'progressing' && live) live.cancel();
      this.forget(command.id);
      this.emitSoon();
      this.persistSoon();
      return { ok: true };
    }

    if (!entry.savePath || !existsSync(entry.savePath)) {
      return { ok: false, message: 'The downloaded file could not be found.' };
    }
    shell.showItemInFolder(entry.savePath);
    return { ok: true };
  }

  async dispose(): Promise<void> {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.stopProgressPump();
    await this.flushPersist();
  }

  /** Prefer downloadURL over opening a tab when the link is clearly a file. */
  static isLikelyDownloadUrl(url: string): boolean {
    try {
      return LIKELY_DOWNLOAD_EXTENSION.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  private begin(item: DownloadItem): void {
    const filename = sanitizeFilename(item.getFilename() || 'download');
    const savePath = uniqueSavePath(this.downloadsDirectory ?? app.getPath('downloads'), filename);
    // Must be synchronous inside will-download or Electron falls back to an
    // unreliable save-dialog path for sandboxed WebContentsViews.
    item.setSavePath(savePath);

    const id = randomUUID();
    this.ledger.begin({
      id,
      filename: path.basename(savePath),
      url: item.getURL(),
      savePath,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      startedAt: this.now(),
    });
    this.liveItems.set(id, item);
    this.ensureProgressPump();
    this.emitSoon();

    item.on('updated', (_event, state) => {
      if (!this.ledger.get(id)) return;
      const resumable = state === 'interrupted' && item.canResume();
      if (resumable) item.resume();
      this.ledger.updateProgress(
        id,
        item.getReceivedBytes(),
        item.getTotalBytes(),
        state === 'interrupted' && !resumable ? 'interrupted' : 'progressing',
      );
      this.ensureProgressPump();
      this.emitSoon();
    });

    item.once('done', (_event, state) => {
      this.liveItems.delete(id);
      const current = this.ledger.get(id);
      if (!current) {
        this.ensureProgressPump();
        return;
      }
      let nextState: 'completed' | 'cancelled' | 'interrupted' = state === 'completed'
        ? 'completed'
        : state === 'cancelled'
          ? 'cancelled'
          : 'interrupted';
      // If Chromium reports completion but the file never landed, surface it.
      if (nextState === 'completed' && !existsSync(current.savePath)) {
        nextState = 'interrupted';
      }
      this.ledger.finish(id, nextState, item.getReceivedBytes(), item.getTotalBytes(), this.now());
      this.ensureProgressPump();
      this.emitSoon();
      this.persistSoon();

      const window = this.windowRef();
      if (nextState === 'completed' && window && !window.isDestroyed()) {
        app.dock?.bounce('informational');
      }
    });
  }

  private forget(id: string): void {
    this.liveItems.delete(id);
    this.ledger.dismiss(id);
    this.ensureProgressPump();
  }

  private ensureProgressPump(): void {
    const hasLiveProgress = [...this.liveItems.keys()].some((id) => this.ledger.get(id)?.state === 'progressing');
    if (hasLiveProgress && !this.progressTimer) {
      this.progressTimer = setInterval(() => this.pumpProgress(), PROGRESS_POLL_MS);
    } else if (!hasLiveProgress) {
      this.stopProgressPump();
    }
  }

  private stopProgressPump(): void {
    if (!this.progressTimer) return;
    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private pumpProgress(): void {
    let changed = false;
    for (const [id, item] of this.liveItems) {
      const entry = this.ledger.get(id);
      if (!entry || entry.state !== 'progressing') continue;
      const receivedBytes = item.getReceivedBytes();
      const totalBytes = item.getTotalBytes();
      if (receivedBytes === entry.receivedBytes && totalBytes === entry.totalBytes) continue;
      this.ledger.updateProgress(id, receivedBytes, totalBytes);
      changed = true;
    }
    if (changed) this.emitSoon();
  }

  private emitSoon(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.onSnapshot(this.getSnapshot());
    }, 50);
  }

  private persistSoon(): void {
    if (!this.historyStore) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushPersist();
    }, 100);
  }

  private flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const store = this.historyStore;
    if (!store) return this.persistQueue;
    const items = this.ledger.persistable();
    this.persistQueue = this.persistQueue
      .then(() => store.save(items))
      .catch(() => undefined);
    return this.persistQueue;
  }
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name)
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code < 32 || '<>:"|?*/\\'.includes(character)) return '_';
      return character;
    })
    .join('')
    .trim();
  return base.length > 0 ? base.slice(0, 180) : 'download';
}

export function uniqueSavePath(directory: string, filename: string): string {
  const safe = sanitizeFilename(filename);
  const parsed = path.parse(safe);
  let candidate = path.join(directory, safe);
  let index = 1;
  while (existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return candidate;
}
