import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BrowserToolbar } from '../src/renderer/ui/BrowserToolbar';
import { TabStrip } from '../src/renderer/ui/TabStrip';
import type { BrowserTabSnapshot } from '../src/shared/browser';

const TAB: BrowserTabSnapshot = {
  id: 'tab-one',
  title: 'Poppin',
  url: 'https://example.com/',
  faviconUrl: null,
  isLoading: false,
  canGoBack: false,
  canGoForward: true,
  failure: null,
};

describe('browser chrome', () => {
  it('activates, closes, and creates tabs accessibly', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(
      <TabStrip
        tabs={[TAB]}
        activeTabId={TAB.id}
        onActivate={onActivate}
        onClose={onClose}
        onCreate={onCreate}
      />,
    );

    await user.click(screen.getByRole('tab', { name: /poppin/i }));
    await user.click(screen.getByRole('button', { name: /close poppin/i }));
    await user.click(screen.getByRole('button', { name: /new tab/i }));
    expect(onActivate).toHaveBeenCalledWith(TAB.id);
    expect(onClose).toHaveBeenCalledWith(TAB.id);
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('reflects navigation availability and submits the address form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const ref = { current: null };
    render(
      <BrowserToolbar
        activeTab={TAB}
        address={TAB.url}
        addressError=""
        addressInputRef={ref}
        onAddressChange={vi.fn()}
        onAddressFocus={vi.fn()}
        onAddressBlur={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onReload={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: /go back/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /go forward/i })).toBeEnabled();
    await user.type(screen.getByRole('textbox', { name: /address and search/i }), '{enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

