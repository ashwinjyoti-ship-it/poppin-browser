import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DownloadsPopover } from '../src/renderer/ui/DownloadsPopover';
import { EMPTY_DOWNLOADS_SNAPSHOT, countProgressingDownloads, type DownloadsSnapshot } from '../src/shared/downloads';

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
      startedAt: 1,
      endedAt: null,
    },
    {
      id: 'dl-2',
      filename: 'Notes.zip',
      url: 'https://example.com/Notes.zip',
      savePath: '/Users/ashwin/Downloads/Notes.zip',
      receivedBytes: 2048,
      totalBytes: 2048,
      state: 'completed',
      percent: 100,
      startedAt: 1,
      endedAt: 2,
    },
  ],
};

function Harness({
  snapshot,
  onCancel = vi.fn(),
  onReveal = vi.fn(),
  onDismiss = vi.fn(),
  onClearFinished,
}: {
  snapshot: DownloadsSnapshot;
  onCancel?: (id: string) => void;
  onReveal?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onClearFinished?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DownloadsPopover
      snapshot={snapshot}
      open={open}
      onOpenChange={setOpen}
      onCancel={onCancel}
      onReveal={onReveal}
      onDismiss={onDismiss}
      {...(onClearFinished ? { onClearFinished } : {})}
    />
  );
}

describe('DownloadsPopover', () => {
  it('shows a compact icon with a badge for in-progress downloads', () => {
    render(<Harness snapshot={SNAPSHOT} />);
    const trigger = screen.getByRole('button', { name: /downloads \(1 in progress\)/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('1');
    expect(screen.queryByRole('dialog', { name: /downloads/i })).not.toBeInTheDocument();
  });

  it('opens a popover with per-item progress and reveals completed downloads', async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    const onCancel = vi.fn();
    render(<Harness snapshot={SNAPSHOT} onReveal={onReveal} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /downloads \(1 in progress\)/i }));
    expect(screen.getByRole('dialog', { name: /downloads/i })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: /chatgpt\.dmg download progress/i })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText(/75% · 71\.5 MB of 95\.4 MB/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /notes\.zip download progress/i })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/downloaded · 2\.0 kb · saved to downloads/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show notes\.zip in finder/i }));
    expect(onReveal).toHaveBeenCalledWith('dl-2');
    await user.click(screen.getByRole('button', { name: /cancel downloading chatgpt\.dmg/i }));
    expect(onCancel).toHaveBeenCalledWith('dl-1');
  });

  it('hides the popover and any badge when there are no downloads', () => {
    render(<Harness snapshot={EMPTY_DOWNLOADS_SNAPSHOT} />);
    const trigger = screen.getByRole('button', { name: /^downloads$/i });
    expect(trigger).toBeVisible();
    expect(trigger.querySelector('.downloads-badge')).toBeNull();
  });

  it('keeps completed downloads visible when the user reopens the list', async () => {
    const user = userEvent.setup();
    render(<Harness snapshot={{ items: [SNAPSHOT.items[1]!] }} />);
    await user.click(screen.getByRole('button', { name: /downloads \(1\)/i }));
    expect(screen.getByRole('dialog', { name: /downloads/i })).toBeVisible();
    expect(screen.getByText('Notes.zip')).toBeVisible();
    expect(screen.getByText(/downloaded · 2\.0 kb · saved to downloads/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /show notes\.zip in finder/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /dismiss notes\.zip/i })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: /notes\.zip download progress/i })).toHaveAttribute('aria-valuenow', '100');
  });

  it('counts only downloads still in progress', () => {
    expect(countProgressingDownloads(EMPTY_DOWNLOADS_SNAPSHOT)).toBe(0);
    expect(countProgressingDownloads(SNAPSHOT)).toBe(1);
  });

  it('keeps the shell trigger from painting an in-window panel over the page', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <DownloadsPopover
        snapshot={SNAPSHOT}
        open
        inlinePanel={false}
        onOpenChange={onOpenChange}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /downloads \(1 in progress\)/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('dialog', { name: /downloads/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /downloads \(1 in progress\)/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
