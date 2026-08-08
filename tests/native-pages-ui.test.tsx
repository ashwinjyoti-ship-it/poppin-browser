import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeDatabaseView } from '../src/renderer/ui/NativeDatabaseView';
import { NativePageView } from '../src/renderer/ui/NativePageView';
import { PagesSection } from '../src/renderer/ui/PagesSection';
import type { PageDocumentSnapshot, PoppinPagesApi } from '../src/shared/pages';
import type { TaskSnapshot } from '../src/shared/task';

const READY_TASK: TaskSnapshot = {
  connection: { state: 'ready', message: 'Ready', accountLabel: 'Test', models: [{ id: 'gpt', name: 'GPT', description: '', reasoningEfforts: ['medium'], defaultReasoningEffort: 'medium', isDefault: true }] },
  task: null,
};
const COMPLETED_TASK: TaskSnapshot = {
  ...READY_TASK,
  task: {
    state: 'Completed', kind: 'work', prompt: 'Earlier work', model: 'gpt', reasoningEffort: 'medium',
    documentId: 'document-1', threadId: 'thread-1', turnId: 'turn-1', baselineCommit: '', progress: [], pendingApproval: null,
    result: 'Done', diff: '', error: null,
    browserRun: { required: false, state: 'not-required', taskSpaceId: null, successfulActionCount: 0, retryCount: 0, lastActionAt: null, sources: [] },
    createdAt: '', updatedAt: '',
  },
};

describe('native Pages UI', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'poppinPages', {
      configurable: true,
      value: { exportPage: vi.fn().mockResolvedValue({ ok: true }) } as Partial<PoppinPagesApi>,
    });
  });

  it('creates, context-selects, and opens items from the Pages tree', async () => {
    const user = userEvent.setup();
    const command = vi.fn().mockResolvedValue(null);
    render(<PagesSection snapshot={{
      pages: [{ id: 'page-1', title: 'Plan', kind: 'page', parentId: null, createdAt: '', updatedAt: '' }],
      tabs: [], activeTabId: null, selectedPageIds: [],
    }} onCommand={command} />);
    await user.click(screen.getByRole('button', { name: 'Plan' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /^Page$/ }));
    await user.click(screen.getByRole('button', { name: /^Database$/ }));
    expect(command).toHaveBeenCalledWith({ type: 'openPage', pageId: 'page-1' });
    expect(command).toHaveBeenCalledWith({ type: 'setPageSelected', pageId: 'page-1', selected: true });
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'createPage', kind: 'page' }));
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'createPage', kind: 'database' }));
  });

  it('edits stable blocks, anchors a selection instruction, and can send it through Task', async () => {
    const user = userEvent.setup();
    const page: PageDocumentSnapshot = {
      page: { id: 'page-1', title: 'Plan', kind: 'page', parentId: null, createdAt: '', updatedAt: '' },
      blocks: [{ id: 'block-1', pageId: 'page-1', type: 'paragraph', content: { text: 'Ship on Monday.' }, position: 0, version: 1, createdAt: '', updatedAt: '' }],
      comments: [{ id: 'comment-1', pageId: 'page-1', blockId: 'block-1', instruction: 'Move it', status: 'open', createdAt: '', updatedAt: '', resolvedAt: null, selection: { quote: 'Monday', hash: 'hash', blockVersion: 1, start: 8, end: 14 } }],
      viewState: null, database: null,
    };
    Object.assign(window.poppinPages, { getPage: vi.fn().mockResolvedValue(page) });
    const pageCommand = vi.fn().mockResolvedValue(null);
    const taskCommand = vi.fn().mockResolvedValue({ ok: true });
    const onTaskStarted = vi.fn();
    render(<NativePageView pageId="page-1" revision={0} onCommand={pageCommand} taskSnapshot={READY_TASK} onTaskCommand={taskCommand} onTaskStarted={onTaskStarted} />);
    const editor = await screen.findByRole('textbox', { name: 'Page text block' });
    await user.clear(editor);
    await user.type(editor, 'Ship on Tuesday.');
    fireEvent.blur(editor);
    expect(pageCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'updateBlock', blockId: 'block-1', expectedVersion: 1, content: { text: 'Ship on Tuesday.' } }));
    await user.click(screen.getByRole('button', { name: /Ask Codex/i }));
    expect(pageCommand).toHaveBeenCalledWith({ type: 'setPageSelected', pageId: 'page-1', selected: true });
    expect(taskCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'startTask', kind: 'work', prompt: expect.stringContaining('comment-1') }));
    expect(onTaskStarted).toHaveBeenCalledOnce();
  });

  it('renders a Work turn as a formatted Tandem document instead of raw Markdown', async () => {
    const page: PageDocumentSnapshot = {
      page: { id: 'task-page', title: 'Acoustic guitars under ₹10,000', kind: 'page', parentId: null, createdAt: '', updatedAt: '' },
      blocks: [
        { id: 'prompt-1', pageId: 'task-page', type: 'task-prompt', content: { text: 'Search for acoustic guitars under ₹10,000.', createdAt: '2026-08-08T12:00:00Z' }, position: 0, version: 1, createdAt: '', updatedAt: '' },
        { id: 'result-1', pageId: 'task-page', type: 'task-result', content: { text: '**Top choices**\n\n| Guitar | Price |\n| --- | --- |\n| Model A | ₹9,999 |', sources: [{ title: 'Shop', url: 'https://shop.example/guitar' }] }, position: 1, version: 1, createdAt: '', updatedAt: '' },
      ],
      comments: [], viewState: null, database: null,
    };
    Object.assign(window.poppinPages, { getPage: vi.fn().mockResolvedValue(page) });
    render(<NativePageView pageId="task-page" revision={0} onCommand={vi.fn().mockResolvedValue(null)} taskSnapshot={COMPLETED_TASK} onTaskCommand={vi.fn()} onTaskStarted={vi.fn()} />);
    expect(await screen.findByText('Top choices')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Scrollable table' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('link', { name: 'Shop' })).toHaveAttribute('href', 'https://shop.example/guitar');
    expect(screen.queryByText('| Guitar | Price |')).not.toBeInTheDocument();
  });

  it('adds Database columns and rows and edits a cell', async () => {
    const user = userEvent.setup();
    const database: PageDocumentSnapshot = {
      page: { id: 'db-1', title: 'Stock', kind: 'database', parentId: null, createdAt: '', updatedAt: '' },
      blocks: [], comments: [], viewState: null,
      database: {
        properties: [{ id: 'name', databaseId: 'db-1', name: 'Name', type: 'text', options: [], position: 0 }],
        rows: [{ id: 'row-1', databaseId: 'db-1', properties: { name: 'Guitar' }, position: 0, createdAt: '', updatedAt: '' }],
        views: [],
      },
    };
    Object.assign(window.poppinPages, { getPage: vi.fn().mockResolvedValue(database) });
    const command = vi.fn().mockResolvedValue(null);
    render(<NativeDatabaseView pageId="db-1" revision={0} onCommand={command} />);
    const cell = await screen.findByRole('textbox', { name: 'Name row 1' });
    await user.clear(cell);
    await user.type(cell, 'Acoustic guitar');
    fireEvent.blur(cell);
    expect(command).toHaveBeenCalledWith({ type: 'updateDatabaseRow', rowId: 'row-1', properties: { name: 'Acoustic guitar' } });
    await user.type(screen.getByRole('textbox', { name: 'New column name' }), 'Price');
    await user.click(screen.getByRole('button', { name: /Add column/i }));
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'addDatabaseProperty', databaseId: 'db-1', name: 'Price' }));
    await user.click(screen.getByRole('button', { name: /Add row/i }));
    expect(command).toHaveBeenCalledWith({ type: 'addDatabaseRow', databaseId: 'db-1', properties: {} });
  });

  it('resolves a Page instruction in the existing completed Codex conversation', async () => {
    const user = userEvent.setup();
    const page: PageDocumentSnapshot = {
      page: { id: 'page-1', title: 'Plan', kind: 'page', parentId: null, createdAt: '', updatedAt: '' },
      blocks: [{ id: 'block-1', pageId: 'page-1', type: 'paragraph', content: { text: 'Ship Monday.' }, position: 0, version: 1, createdAt: '', updatedAt: '' }],
      comments: [{ id: 'comment-1', pageId: 'page-1', blockId: 'block-1', instruction: 'Move it', status: 'open', createdAt: '', updatedAt: '', resolvedAt: null, selection: { quote: 'Monday', hash: 'hash', blockVersion: 1, start: 5, end: 11 } }],
      viewState: null, database: null,
    };
    Object.assign(window.poppinPages, { getPage: vi.fn().mockResolvedValue(page) });
    const taskCommand = vi.fn().mockResolvedValue({ ok: true });
    render(<NativePageView pageId="page-1" revision={0} onCommand={vi.fn().mockResolvedValue(null)} taskSnapshot={COMPLETED_TASK} onTaskCommand={taskCommand} onTaskStarted={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Ask Codex/i }));
    expect(taskCommand).toHaveBeenCalledWith({ type: 'continueTask', prompt: expect.stringContaining('comment-1') });
  });
});
