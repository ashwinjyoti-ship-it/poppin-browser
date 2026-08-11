import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TabStrip } from '../src/renderer/ui/TabStrip';

const TABS = [
  { id: 'tab-1', title: 'One', url: 'https://example.com/one' },
  { id: 'tab-2', title: 'Two', url: 'https://example.com/two' },
];

describe('vertical tab rail hover draw-out', () => {
  it('draws tabs out on hover while collapsed and pins them open', async () => {
    const user = userEvent.setup();
    const onCollapseChange = vi.fn();
    const onHoverPeekChange = vi.fn();
    render(
      <TabStrip
        orientation="vertical"
        collapsed
        drawOutOnHover
        onCollapseChange={onCollapseChange}
        onHoverPeekChange={onHoverPeekChange}
        tabs={TABS}
        groups={[]}
        activeTabId="tab-1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onShowGroupMenu={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Open tabs' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'One' })).not.toBeInTheDocument();
    expect(onHoverPeekChange).toHaveBeenLastCalledWith(false);

    await user.hover(screen.getByLabelText('Tabs collapsed'));
    expect(await screen.findByRole('tab', { name: 'One' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Keep tabs open' })).toBeVisible();
    expect(onHoverPeekChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Keep tabs open' }));
    expect(onCollapseChange).toHaveBeenCalledWith(false);
  });

  it('keeps the collapsed rail closed when hover draw-out is disabled', async () => {
    const user = userEvent.setup();
    render(
      <TabStrip
        orientation="vertical"
        collapsed
        drawOutOnHover={false}
        onCollapseChange={vi.fn()}
        tabs={TABS}
        groups={[]}
        activeTabId="tab-1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onReorder={vi.fn()}
        onShowTabMenu={vi.fn()}
        onToggleGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onShowGroupMenu={vi.fn()}
      />,
    );

    await user.hover(screen.getByLabelText('Tabs collapsed'));
    expect(screen.queryByRole('tab', { name: 'One' })).not.toBeInTheDocument();
  });
});
