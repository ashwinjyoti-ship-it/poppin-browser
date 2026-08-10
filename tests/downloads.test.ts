import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DownloadManager, sanitizeFilename, uniqueSavePath } from '../src/main/browser/downloads';
import { downloadPercent, formatDownloadBytes } from '../src/shared/downloads';

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
  });

  it('recognizes common installer and archive download URLs', () => {
    expect(DownloadManager.isLikelyDownloadUrl('https://cdn.example.com/ChatGPT.dmg')).toBe(true);
    expect(DownloadManager.isLikelyDownloadUrl('https://cdn.example.com/app.pkg?arch=arm64')).toBe(true);
    expect(DownloadManager.isLikelyDownloadUrl('https://example.com/releases/app.zip#latest')).toBe(true);
    expect(DownloadManager.isLikelyDownloadUrl('https://example.com/blog/announcing-dmg')).toBe(false);
    expect(DownloadManager.isLikelyDownloadUrl('not a url')).toBe(false);
  });
});
