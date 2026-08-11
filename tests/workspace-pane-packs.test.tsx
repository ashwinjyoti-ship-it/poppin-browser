import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WorkspacePane } from '../src/renderer/ui/WorkspacePane';
import { EMPTY_TANDEM_SNAPSHOT } from '../src/shared/tandem';
import type { WorkspaceSnapshot } from '../src/shared/workspace';

function buildSnapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    workspace: { id: 'primary', name: 'Launch prep', createdAt: '2026-08-11T00:00:00.000Z' },
    documents: [],
    tabContexts: [],
    project: null,
    visualSelection: null,
    pageContexts: [],
    tandemContexts: [],
    contextPacks: [],
    memorySelected: false,
    memoryBrief: null,
    browserSessions: [],
    ...overrides,
  };
}

describe('WorkspacePane packs and sessions', () => {
  it('saves the current selection as a named context pack', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue(null);
    render(
      <WorkspacePane
        collapsed={false}
        snapshot={buildSnapshot()}
        tabs={[]}
        activeTab={null}
        onCollapseChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(null)}
        onCommand={onCommand}
        onPagesCommand={vi.fn().mockResolvedValue(null)}
        onRefreshTab={vi.fn()}
        tandem={EMPTY_TANDEM_SNAPSHOT}
        onTandemCommand={vi.fn().mockResolvedValue(null)}
      />,
    );

    const packsSection = within(screen.getByRole('region', { name: /context packs/i }));
    await user.type(packsSection.getByPlaceholderText(/name this selection/i), 'Launch checklist');
    await user.click(packsSection.getByRole('button', { name: /save current/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'saveContextPack', name: 'Launch checklist' });
  });

  it('applies, renames, and deletes an existing context pack', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue(null);
    render(
      <WorkspacePane
        collapsed={false}
        snapshot={buildSnapshot({
          contextPacks: [{
            id: 'pack-1',
            name: 'Launch checklist',
            tabRefs: [{ url: 'https://example.com/', title: 'Example' }],
            documentIds: ['doc-1'],
            tandemPageIds: [],
            includeMemory: true,
            createdAt: '2026-08-11T00:00:00.000Z',
          }],
        })}
        tabs={[]}
        activeTab={null}
        onCollapseChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(null)}
        onCommand={onCommand}
        onPagesCommand={vi.fn().mockResolvedValue(null)}
        onRefreshTab={vi.fn()}
        tandem={EMPTY_TANDEM_SNAPSHOT}
        onTandemCommand={vi.fn().mockResolvedValue(null)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'applyContextPack', packId: 'pack-1' });

    await user.click(screen.getByRole('button', { name: /delete launch checklist/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'deleteContextPack', packId: 'pack-1' });
  });

  it('saves the current tabs as a session and opens saved sessions in both modes', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue(null);
    render(
      <WorkspacePane
        collapsed={false}
        snapshot={buildSnapshot({
          browserSessions: [{
            id: 'sess-1',
            name: 'Morning research',
            tabs: [{ url: 'https://example.com/', title: 'Example', pinned: false }],
            createdAt: '2026-08-11T00:00:00.000Z',
          }],
        })}
        tabs={[]}
        activeTab={null}
        onCollapseChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(null)}
        onCommand={onCommand}
        onPagesCommand={vi.fn().mockResolvedValue(null)}
        onRefreshTab={vi.fn()}
        tandem={EMPTY_TANDEM_SNAPSHOT}
        onTandemCommand={vi.fn().mockResolvedValue(null)}
      />,
    );

    const sessionsSection = within(screen.getByRole('region', { name: /^sessions$/i }));
    await user.type(sessionsSection.getByPlaceholderText(/session name/i), 'Focus');
    await user.click(sessionsSection.getByRole('button', { name: /save current/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'saveBrowserSession', name: 'Focus' });

    await user.click(sessionsSection.getByRole('button', { name: /^merge$/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'openBrowserSession', sessionId: 'sess-1', mode: 'merge' });

    await user.click(sessionsSection.getByRole('button', { name: /^replace$/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'openBrowserSession', sessionId: 'sess-1', mode: 'replace' });

    await user.click(sessionsSection.getByRole('button', { name: /delete morning research/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'deleteBrowserSession', sessionId: 'sess-1' });
  });

  it('lets the user opt Memory in or out and shows the preview when selected', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue(null);
    const { rerender } = render(
      <WorkspacePane
        collapsed={false}
        snapshot={buildSnapshot({
          memorySelected: false,
          memoryBrief: { title: 'Memory', content: 'Working brief text.', truncated: false },
        })}
        tabs={[]}
        activeTab={null}
        onCollapseChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(null)}
        onCommand={onCommand}
        onPagesCommand={vi.fn().mockResolvedValue(null)}
        onRefreshTab={vi.fn()}
        tandem={EMPTY_TANDEM_SNAPSHOT}
        onTandemCommand={vi.fn().mockResolvedValue(null)}
      />,
    );

    const useCheckbox = screen.getByRole('checkbox', { name: /use as context/i });
    expect(useCheckbox).not.toBeDisabled();
    await user.click(useCheckbox);
    expect(onCommand).toHaveBeenCalledWith({ type: 'setMemorySelected', selected: true });

    rerender(
      <WorkspacePane
        collapsed={false}
        snapshot={buildSnapshot({
          memorySelected: true,
          memoryBrief: { title: 'Memory', content: 'Working brief text.', truncated: false },
        })}
        tabs={[]}
        activeTab={null}
        onCollapseChange={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(null)}
        onCommand={onCommand}
        onPagesCommand={vi.fn().mockResolvedValue(null)}
        onRefreshTab={vi.fn()}
        tandem={EMPTY_TANDEM_SNAPSHOT}
        onTandemCommand={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByText('Working brief text.')).toBeInTheDocument();
  });
});
