import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DownloadBar } from '../src/renderer/ui/DownloadBar';
import { downloadBarHeight, type DownloadsSnapshot } from '../src/shared/downloads';

const SNAPSHOT: DownloadsSnapshot = {
  items: [
    {
      id: 'dl-1',
      filename: 'ChatGPT.dmg',
      url: 'https://example.com/ChatGPT.dmg',
      savePath: '/tmp/ChatGPT.dmg',
      receivedBytes: 75_000_000,
      totalBytes: 100_000_000,
      state: 'progressing',
      percent: 75,
    },
    {
      id: 'dl-2',
      filename: 'Notes.zip',
      url: 'https://example.com/Notes.zip',
      savePath: '/tmp/Notes.zip',
      receivedBytes: 2048,
      totalBytes: 2048,
      state: 'completed',
      percent: 100,
    },
  ],
};

describe('DownloadBar', () => {
  it('renders progress for active downloads and reveal for completed ones', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onReveal = vi.fn();
    const onDismiss = vi.fn();
    render(<DownloadBar snapshot={SNAPSHOT} onCancel={onCancel} onReveal={onReveal} onDismiss={onDismiss} />);

    expect(screen.getByRole('region', { name: /downloads/i })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /chatgpt\.dmg download progress/i })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText(/75% · 71\.5 MB of 95\.4 MB/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel downloading chatgpt\.dmg/i }));
    expect(onCancel).toHaveBeenCalledWith('dl-1');
    await user.click(screen.getByRole('button', { name: /show notes\.zip in finder/i }));
    expect(onReveal).toHaveBeenCalledWith('dl-2');
  });

  it('reserves chrome height only while downloads are visible', () => {
    expect(downloadBarHeight(0)).toBe(0);
    expect(downloadBarHeight(1)).toBe(44);
    expect(downloadBarHeight(2)).toBe(78);
  });
});
