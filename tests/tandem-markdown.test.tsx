// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TandemMarkdown } from '../src/renderer/ui/TandemMarkdown';

describe('TandemMarkdown file links', () => {
  it('opens http(s) links in a Poppin tab', () => {
    const create = vi.fn().mockResolvedValue({ ok: true });
    window.poppinBrowser = { command: create } as unknown as typeof window.poppinBrowser;
    const onFileLink = vi.fn();
    render(
      <TandemMarkdown
        markdown="See [the source](https://example.com/sheet) for details."
        title="Result"
        onFileLink={onFileLink}
      />,
    );
    fireEvent.click(screen.getByRole('link', { name: 'the source' }));
    expect(create).toHaveBeenCalledWith({ type: 'create', input: 'https://example.com/sheet' });
    expect(onFileLink).not.toHaveBeenCalled();
  });

  it('routes a generated-file download link to onFileLink instead of navigating', () => {
    const create = vi.fn();
    window.poppinBrowser = { command: create } as unknown as typeof window.poppinBrowser;
    const onFileLink = vi.fn();
    render(
      <TandemMarkdown
        markdown="[Download excel sheet here](report.xlsx)"
        title="Result"
        onFileLink={onFileLink}
      />,
    );
    const link = screen.getByRole('link', { name: 'Download excel sheet here' });
    fireEvent.click(link);
    expect(onFileLink).toHaveBeenCalledWith('report.xlsx');
    expect(create).not.toHaveBeenCalled();
  });
});
