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
  downloadPercent,
  EMPTY_DOWNLOADS_SNAPSHOT,
  type DownloadItemSnapshot,
  type DownloadItemState,
  type DownloadsCommand,
  type DownloadsCommandResult,
  type DownloadsSnapshot,
} from '../../shared/downloads';

const FINISHED_RETENTION_MS = 12_000;
const LIKELY_DOWNLOAD_EXTENSION = /\.(dmg|pkg|zip|exe|msi|deb|rpm|7z|rar|gz|tgz|xz|iso|pdf|csv|xlsx?|docx?|pptx?|mp[34]|mov|mkv|avi|apk|ipa|tar|bz2)(\?|#|$)/i;

interface TrackedDownload {
  id: string;
  item: DownloadItem;
  filename: string;
  url: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadItemState;
  clearTimer: NodeJS.Timeout | null;
}

/**
 * Owns Chromium downloads for the browsing session. Without an explicit
 * will-download handler that sets an absolute save path, WebContentsView
 * downloads (especially target=_blank / redirected DMGs) can finish with a
 * missing or truncated file. This manager always pins a unique path under
 * the user's Downloads folder before bytes are written.
 */
export class DownloadManager {
  private readonly items = new Map<string, TrackedDownload>();
  private readonly windowRef: () => BrowserWindow | null;
  private emitTimer: NodeJS.Timeout | null = null;
  private registered = false;

  constructor(
    private readonly browserSession: Session,
    getWindow: () => BrowserWindow | null,
    private readonly onSnapshot: (snapshot: DownloadsSnapshot) => void,
  ) {
    this.windowRef = getWindow;
  }

  register(): void {
    if (this.registered) return;
    this.registered = true;
    this.browserSession.on('will-download', (_event, item) => {
      this.begin(item);
    });
  }

  getSnapshot(): DownloadsSnapshot {
    return {
      items: Array.from(this.items.values(), (entry) => toSnapshot(entry)),
    };
  }

  execute(command: DownloadsCommand): DownloadsCommandResult {
    if (command.type === 'openOverlay' || command.type === 'closeOverlay') {
      return { ok: false, message: 'Downloads overlay is owned by the Poppin shell.' };
    }

    if (command.type === 'clearFinished') {
      for (const [id, entry] of this.items) {
        if (entry.state === 'progressing') continue;
        this.forget(id);
      }
      this.emitSoon();
      return { ok: true };
    }

    const entry = this.items.get(command.id);
    if (!entry) return { ok: false, message: 'That download is no longer available.' };

    if (command.type === 'cancel') {
      if (entry.state === 'progressing') entry.item.cancel();
      return { ok: true };
    }

    if (command.type === 'dismiss') {
      if (entry.state === 'progressing') entry.item.cancel();
      this.forget(command.id);
      this.emitSoon();
      return { ok: true };
    }

    if (!entry.savePath || !existsSync(entry.savePath)) {
      return { ok: false, message: 'The downloaded file could not be found.' };
    }
    shell.showItemInFolder(entry.savePath);
    return { ok: true };
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
    const savePath = uniqueSavePath(app.getPath('downloads'), filename);
    // Must be synchronous inside will-download or Electron falls back to an
    // unreliable save-dialog path for sandboxed WebContentsViews.
    item.setSavePath(savePath);

    const id = randomUUID();
    const entry: TrackedDownload = {
      id,
      item,
      filename: path.basename(savePath),
      url: item.getURL(),
      savePath,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      state: 'progressing',
      clearTimer: null,
    };
    this.items.set(id, entry);
    this.emitSoon();

    item.on('updated', (_event, state) => {
      const current = this.items.get(id);
      if (!current) return;
      current.receivedBytes = item.getReceivedBytes();
      current.totalBytes = item.getTotalBytes();
      if (state === 'interrupted') {
        current.state = 'interrupted';
        if (item.canResume()) item.resume();
      } else {
        current.state = 'progressing';
      }
      this.emitSoon();
    });

    item.once('done', (_event, state) => {
      const current = this.items.get(id);
      if (!current) return;
      current.receivedBytes = item.getReceivedBytes();
      current.totalBytes = item.getTotalBytes();
      current.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
      // If Chromium reports completion but the file never landed, surface it.
      if (current.state === 'completed' && !existsSync(current.savePath)) {
        current.state = 'interrupted';
      }
      this.scheduleForget(id);
      this.emitSoon();

      const window = this.windowRef();
      if (current.state === 'completed' && window && !window.isDestroyed()) {
        app.dock?.bounce('informational');
      }
    });
  }

  private scheduleForget(id: string): void {
    const entry = this.items.get(id);
    if (!entry || entry.clearTimer) return;
    entry.clearTimer = setTimeout(() => {
      this.forget(id);
      this.emitSoon();
    }, FINISHED_RETENTION_MS);
  }

  private forget(id: string): void {
    const entry = this.items.get(id);
    if (!entry) return;
    if (entry.clearTimer) clearTimeout(entry.clearTimer);
    this.items.delete(id);
  }

  private emitSoon(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.onSnapshot(this.items.size ? this.getSnapshot() : EMPTY_DOWNLOADS_SNAPSHOT);
    }, 50);
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

function toSnapshot(entry: TrackedDownload): DownloadItemSnapshot {
  return {
    id: entry.id,
    filename: entry.filename,
    url: entry.url,
    savePath: entry.savePath,
    receivedBytes: entry.receivedBytes,
    totalBytes: entry.totalBytes,
    state: entry.state,
    percent: downloadPercent(entry.receivedBytes, entry.totalBytes),
  };
}
