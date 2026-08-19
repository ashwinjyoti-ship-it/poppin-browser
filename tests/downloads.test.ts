import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DownloadLedger } from '../src/main/browser/download-ledger';
import { DownloadManager, sanitizeFilename, uniqueSavePath } from '../src/main/browser/downloads';
import { DownloadsHistoryStore } from '../src/main/browser/downloads-store';
import {
  DOWNLOADS_HISTORY_LIMIT,
  downloadDestinationFolder,
  downloadPercent,
  formatDownloadBytes,
  type DownloadItemSnapshot,
} from '../src/shared/downloads';
import { downloadsOverlayBounds } from '../src/shared/downloads-overlay';

describe('download helpers', () => {
  it('sanitizes unsafe filenames while keeping extensions', () => {
    expect(sanitizeFilename('ChatGPT Desktop.dmg')).toBe('ChatGPT Desktop.dmg');
    expect(sanitizeFilename('../../evil:name?.dmg')).toBe('evil_name_.dmg');
    expect(sanitizeFilename('')).toBe('download');
  });

  it('allocates a unique path when the target already exists', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'poppin-downloads-'));
    writeFileSync(path.join(directory, 'App.dmg'), 'one');
    expect(uniqueSavePath(directory, 'App.dmg')).toBe(path.join(directory, 'App (1).dmg'));
    writeFileSync(path.join(directory, 'App (1).dmg'), 'two');
    expect(uniqueSavePath(directory, 'App.dmg')).toBe(path.join(directory, 'App (2).dmg'));
  });

  it('reports determinate progress only when a total size is known', () => {
    expect(downloadPercent(50, 100)).toBe(50);
    expect(downloadPercent(0, 0)).toBeNull();
    expect(downloadPercent(10, -1)).toBeNull();
    expect(formatDownloadBytes(1536)).toBe('1.5 KB');
    expect(formatDownloadBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(downloadDestinationFolder('/Users/ashwin/Downloads/ChatGPT.dmg')).toBe('Downloads');
    expect(downloadDestinationFolder('C:\\Users\\ashwin\\Downloads\\App.zip')).toBe('Downloads');
  });

  it('recognizes common installer and archive download URLs', () => {
    expect(DownloadManager.isLikelyDownloadUrl('https://cdn.example.com/ChatGPT.dmg')).toBe(true);
    expect(DownloadManager.isLikelyDownloadUrl('https://cdn.example.com/app.pkg?arch=arm64')).toBe(true);
    expect(DownloadManager.isLikelyDownloadUrl('https://example.com/releases/app.zip#latest')).toBe(true);
    expect(DownloadManager.isLikelyDownloadUrl('https://example.com/blog/announcing-dmg')).toBe(false);
    expect(DownloadManager.isLikelyDownloadUrl('not a url')).toBe(false);
  });

  it('places the downloads overlay over the page instead of shrinking it', () => {
    expect(downloadsOverlayBounds({ x: 80, y: 40, width: 1280, height: 800 })).toEqual({
      x: 80 + 1280 - 360 - 18,
      y: 40 + 52,
      width: 360,
      height: 420,
    });
  });
});

describe('download ledger', () => {
  it('keeps completed items until they are dismissed', () => {
    const ledger = new DownloadLedger();
    ledger.begin({
      id: 'dl-1',
      filename: 'App.dmg',
      url: 'https://example.com/App.dmg',
      savePath: '/tmp/App.dmg',
      receivedBytes: 10,
      totalBytes: 100,
      startedAt: 1,
    });
    ledger.updateProgress('dl-1', 50, 100);
    expect(ledger.snapshot().items[0]).toMatchObject({ state: 'progressing', percent: 50, receivedBytes: 50 });

    ledger.finish('dl-1', 'completed', 100, 100, 2);
    expect(ledger.snapshot().items).toHaveLength(1);
    expect(ledger.snapshot().items[0]).toMatchObject({
      state: 'completed',
      percent: 100,
      endedAt: 2,
    });
    expect(ledger.persistable()).toHaveLength(1);

    ledger.dismiss('dl-1');
    expect(ledger.snapshot().items).toHaveLength(0);
    expect(ledger.persistable()).toHaveLength(0);
  });

  it('caps persisted finished history and treats leftover progressing items as interrupted', () => {
    const ledger = new DownloadLedger();
    const records: DownloadItemSnapshot[] = Array.from({ length: DOWNLOADS_HISTORY_LIMIT + 5 }, (_, index) => ({
      id: `dl-${index}`,
      filename: `file-${index}.zip`,
      url: `https://example.com/file-${index}.zip`,
      savePath: `/tmp/file-${index}.zip`,
      receivedBytes: 10,
      totalBytes: 10,
      state: 'completed' as const,
      percent: 100,
      startedAt: index,
      endedAt: index,
    }));
    records.push({
      id: 'live',
      filename: 'partial.bin',
      url: 'https://example.com/partial.bin',
      savePath: '/tmp/partial.bin',
      receivedBytes: 4,
      totalBytes: 10,
      state: 'progressing',
      percent: 40,
      startedAt: 99,
      endedAt: null,
    });
    ledger.hydrate(records);
    expect(ledger.snapshot().items).toHaveLength(DOWNLOADS_HISTORY_LIMIT);
    expect(ledger.snapshot().items.every((item) => item.state !== 'progressing')).toBe(true);
    expect(ledger.get('live')?.state).toBe('interrupted');
  });
});

describe('downloads history store', () => {
  it('writes and restores finished downloads across launches', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-dl-history-'));
    const store = new DownloadsHistoryStore(directory);
    const item: DownloadItemSnapshot = {
      id: 'dl-1',
      filename: 'Notes.zip',
      url: 'https://example.com/Notes.zip',
      savePath: '/tmp/Notes.zip',
      receivedBytes: 2048,
      totalBytes: 2048,
      state: 'completed',
      percent: 100,
      startedAt: 10,
      endedAt: 20,
    };
    await store.save([item, { ...item, id: 'dl-live', state: 'progressing', endedAt: null, percent: 50 }]);
    expect(await store.load()).toEqual([item]);
    expect(await new DownloadsHistoryStore(directory).load()).toEqual([item]);
  });

  it('ignores corrupt history files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-dl-history-'));
    const store = new DownloadsHistoryStore(directory);
    await writeFile(store.filePath, '{not json', 'utf8');
    expect(await store.load()).toEqual([]);
  });
});

describe('DownloadManager history', () => {
  const managers: DownloadManager[] = [];

  afterEach(async () => {
    await Promise.all(managers.map((manager) => manager.dispose()));
    managers.length = 0;
  });

  it('emits live byte progress and keeps the completed row in the snapshot', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-dl-mgr-'));
    const { manager, session, latest } = createManager(directory);
    managers.push(manager);

    const item = new FakeDownloadItem('ChatGPT.dmg', 100);
    session.emit('will-download', {}, item);
    await expect.poll(() => latest.snapshot?.items[0]?.state).toBe('progressing');
    expect(item.setSavePath).toHaveBeenCalled();
    expect(latest.snapshot?.items[0]).toMatchObject({
      filename: 'ChatGPT.dmg',
      percent: 0,
      receivedBytes: 0,
      totalBytes: 100,
    });

    item.setProgress(40);
    await expect.poll(() => latest.snapshot?.items[0]?.percent).toBe(40);
    expect(latest.snapshot?.items[0]).toMatchObject({
      state: 'progressing',
      receivedBytes: 40,
      totalBytes: 100,
    });

    writeFileSync(latest.snapshot!.items[0]!.savePath, 'payload');
    item.complete();
    await expect.poll(() => latest.snapshot?.items[0]?.state).toBe('completed');
    expect(latest.snapshot?.items).toHaveLength(1);
    expect(latest.snapshot?.items[0]).toMatchObject({
      filename: 'ChatGPT.dmg',
      percent: 100,
      receivedBytes: 100,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.getSnapshot().items).toHaveLength(1);
    expect(manager.getSnapshot().items[0]?.state).toBe('completed');
  });

  it('restores completed history after a new manager is created', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-dl-mgr-'));
    const store = new DownloadsHistoryStore(directory);
    const first = createManager(directory, store);
    managers.push(first.manager);

    const item = new FakeDownloadItem('Notes.zip', 8);
    first.session.emit('will-download', {}, item);
    await expect.poll(() => first.latest.snapshot?.items[0]?.savePath).toBeTruthy();
    writeFileSync(first.latest.snapshot!.items[0]!.savePath, 'notes');
    item.complete();
    await expect.poll(() => first.latest.snapshot?.items[0]?.state).toBe('completed');
    await first.manager.dispose();

    const second = createManager(directory, store);
    managers.push(second.manager);
    await second.manager.restoreHistory();
    expect(second.manager.getSnapshot().items).toEqual([
      expect.objectContaining({
        filename: 'Notes.zip',
        state: 'completed',
        percent: 100,
      }),
    ]);
  });

  it('does not auto-remove completed items; dismiss and clear still work', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-dl-mgr-'));
    const { manager, session, latest } = createManager(directory);
    managers.push(manager);

    const item = new FakeDownloadItem('Keep.me', 4);
    session.emit('will-download', {}, item);
    await expect.poll(() => latest.snapshot?.items[0]?.savePath).toBeTruthy();
    writeFileSync(latest.snapshot!.items[0]!.savePath, 'keep');
    item.complete();
    await expect.poll(() => latest.snapshot?.items[0]?.state).toBe('completed');

    expect(manager.execute({ type: 'clearFinished' })).toEqual({ ok: true });
    await expect.poll(() => manager.getSnapshot().items).toEqual([]);
  });
});

function createManager(downloadsDirectory: string, historyStore = new DownloadsHistoryStore(downloadsDirectory)) {
  const session = new EventEmitter();
  const latest: { snapshot: ReturnType<DownloadManager['getSnapshot']> | null } = { snapshot: null };
  const manager = new DownloadManager(
    session as never,
    () => null,
    (snapshot) => {
      latest.snapshot = snapshot;
    },
    { historyStore, downloadsDirectory },
  );
  manager.register();
  return { manager, session, latest, historyStore };
}

class FakeDownloadItem extends EventEmitter {
  receivedBytes = 0;
  readonly setSavePath = vi.fn();
  readonly cancel = vi.fn();
  readonly resume = vi.fn();

  constructor(
    private readonly filename: string,
    private totalBytes: number,
    private readonly url = `https://example.com/${filename}`,
  ) {
    super();
  }

  getFilename(): string {
    return this.filename;
  }

  getURL(): string {
    return this.url;
  }

  getReceivedBytes(): number {
    return this.receivedBytes;
  }

  getTotalBytes(): number {
    return this.totalBytes;
  }

  getPercentComplete(): number {
    return this.totalBytes > 0 ? Math.round((this.receivedBytes / this.totalBytes) * 100) : -1;
  }

  canResume(): boolean {
    return false;
  }

  setProgress(receivedBytes: number, totalBytes = this.totalBytes): void {
    this.receivedBytes = receivedBytes;
    this.totalBytes = totalBytes;
    this.emit('updated', {}, 'progressing');
  }

  complete(): void {
    this.receivedBytes = this.totalBytes;
    this.emit('done', {}, 'completed');
  }
}
