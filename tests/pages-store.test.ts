// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PagesStore } from '../src/main/pages/pages-store';

async function createStore() {
  const directory = await mkdtemp(path.join(tmpdir(), 'poppin-pages-'));
  const filePath = path.join(directory, 'poppin.sqlite');
  return { store: new PagesStore(filePath), filePath };
}

describe('pages store', () => {
  it('persists a page, stable blocks, versioned selections, and resolved comments', async () => {
    const { store, filePath } = await createStore();
    const page = store.createPage({ id: 'page-one', title: 'Product brief' });
    const block = store.addBlock({
      id: 'block-one', pageId: page.id, type: 'paragraph',
      content: { text: 'The launch is planned for Monday.' },
    });
    const comment = store.addComment({
      id: 'comment-one', pageId: page.id, blockId: block.id,
      selectionQuote: 'planned for Monday', instruction: 'Move this to Tuesday', start: 14, end: 32,
    });

    expect(comment).toMatchObject({
      blockId: 'block-one', status: 'open',
      selection: { quote: 'planned for Monday', blockVersion: 1, start: 14, end: 32 },
    });
    expect(comment.selection.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.resolveComment(comment.id)).toMatchObject({ status: 'resolved', resolvedAt: expect.any(String) });
    expect(store.updateBlock(block.id, 1, { text: 'The launch is planned for Tuesday.' })).toMatchObject({ version: 2 });
    expect(() => store.updateBlock(block.id, 1, { text: 'Stale edit' })).toThrow(/changed/i);
    store.close();

    const restored = new PagesStore(filePath);
    expect(restored.getPage(page.id)).toMatchObject({
      page: { id: 'page-one', kind: 'page' },
      blocks: [{ id: 'block-one', version: 2, content: { text: 'The launch is planned for Tuesday.' } }],
      comments: [{ id: 'comment-one', status: 'resolved', selection: { blockVersion: 1 } }],
      database: null,
    });
    restored.close();
  });

  it('coordinates multi-entity writes in one rollback-safe transaction', async () => {
    const { store } = await createStore();
    expect(() => store.runInTransaction((transaction) => {
      transaction.createPage({ id: 'rollback-page', title: 'Rollback me' });
      transaction.addBlock({ id: 'rollback-block', pageId: 'rollback-page', type: 'paragraph', content: { text: 'Draft' } });
      transaction.addComment({
        pageId: 'another-page', blockId: 'rollback-block', selectionQuote: 'Draft', instruction: 'Fail this transaction',
      });
    })).toThrow(/does not belong/i);
    expect(store.listPages()).toEqual([]);
    store.close();
  });

  it('stores database schema, rows, views, and kind-matched view state', async () => {
    const { store, filePath } = await createStore();
    const database = store.createPage({ id: 'db-one', title: 'Launch tracker', kind: 'database' });
    store.runInTransaction((transaction) => {
      transaction.addDatabaseProperty(database.id, { id: 'name', name: 'Name', type: 'text' });
      transaction.addDatabaseProperty(database.id, { id: 'status', name: 'Status', type: 'select', options: ['Planned', 'Done'] });
      transaction.addDatabaseRow(database.id, { name: 'Homepage', status: 'Planned' }, { id: 'row-one' });
      transaction.addDatabaseView(database.id, {
        id: 'view-one', name: 'Board', viewType: 'board',
        filters: [{ propertyId: 'status', operator: 'equals', value: 'Planned' }],
        viewState: { groupBy: 'status' },
      });
      transaction.saveViewState(database.id, { activeViewId: 'view-one', scrollTop: 180 });
    });
    expect(() => store.addDatabaseRow(database.id, { missing: 'value' })).toThrow(/unknown database property/i);
    store.close();

    const restored = new PagesStore(filePath);
    expect(restored.getPage(database.id)).toMatchObject({
      page: { id: 'db-one', kind: 'database' },
      viewState: { kind: 'database', state: { activeViewId: 'view-one', scrollTop: 180 } },
      database: {
        properties: [{ id: 'name' }, { id: 'status' }],
        rows: [{ id: 'row-one', properties: { name: 'Homepage', status: 'Planned' } }],
        views: [{ id: 'view-one', viewType: 'board', viewState: { groupBy: 'status' } }],
      },
    });
    restored.close();
  });

  it('persists native Page/Database tabs, active kind, tree organization, and context selection', async () => {
    const { store, filePath } = await createStore();
    const parent = store.createPage({ id: 'parent', title: 'Planning' });
    const child = store.createPage({ id: 'child', title: 'Tracker', kind: 'database', parentId: parent.id });
    const pageTab = store.openPage(parent.id);
    const databaseTab = store.openPage(child.id);
    store.renamePage(parent.id, 'Launch planning');
    store.setPageSelected(parent.id, true);
    store.reorderTab(databaseTab.id, pageTab.id);
    expect(store.getActiveTabId()).toBe(databaseTab.id);
    store.close();

    const restored = new PagesStore(filePath);
    expect(restored.listPages()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'parent', title: 'Launch planning', kind: 'page' }),
      expect.objectContaining({ id: 'child', parentId: 'parent', kind: 'database' }),
    ]));
    expect(restored.listTabs().map((tab) => [tab.id, tab.kind])).toEqual([[databaseTab.id, 'database'], [pageTab.id, 'page']]);
    expect(restored.getActiveTabId()).toBe(databaseTab.id);
    expect(restored.listSelectedPageIds()).toEqual(['parent']);
    expect(() => restored.movePage(parent.id, child.id)).toThrow(/descendant/i);
    restored.movePage(child.id, null);
    restored.deletePage(parent.id);
    expect(restored.listSelectedPageIds()).toEqual([]);
    restored.close();
  });

  it('keeps every completed Work turn in one persistent Tandem task document', async () => {
    const { store, filePath } = await createStore();
    const firstTab = store.appendTaskTurn({
      threadId: 'thread-guitars', turnId: 'turn-1', prompt: 'Search for acoustic guitars under ₹10,000 and tell me where I can buy them.',
      result: '| Guitar | Price |\n| --- | --- |\n| A | ₹9,999 |', createdAt: '2026-08-08T12:00:00.000Z',
      sources: [{ title: 'Guitar shop', url: 'https://shop.example/guitars' }],
    });
    const secondTab = store.appendTaskTurn({
      threadId: 'thread-guitars', turnId: 'turn-2', prompt: 'continue', result: 'Added two more verified options.',
      createdAt: '2026-08-08T12:05:00.000Z', sources: [{ title: 'Second shop', url: 'https://two.example/guitars' }],
    });
    expect(secondTab.pageId).toBe(firstTab.pageId);
    expect(store.getPage(firstTab.pageId)?.blocks.map((block) => block.type)).toEqual([
      'task-prompt', 'task-result', 'task-prompt', 'task-result',
    ]);
    store.close();

    const restored = new PagesStore(filePath);
    expect(restored.openTaskDocument('thread-guitars').pageId).toBe(firstTab.pageId);
    expect(restored.getPage(firstTab.pageId)?.blocks[1]?.content).toMatchObject({
      text: expect.stringContaining('| Guitar |'), sources: [{ url: 'https://shop.example/guitars' }],
    });
    restored.close();
  });

  it('applies anchored comments atomically and rejects stale block selections', async () => {
    const { store } = await createStore();
    const page = store.createPage({ title: 'Brief' });
    const block = store.addBlock({ pageId: page.id, type: 'paragraph', content: { text: 'Ship on Monday.' } });
    const comment = store.addComment({ pageId: page.id, blockId: block.id, selectionQuote: 'Monday', instruction: 'Move to Tuesday', start: 8, end: 14 });
    expect(store.applyComment(comment.id, 'Tuesday')).toMatchObject({ status: 'resolved' });
    expect(store.getPage(page.id)?.blocks[0]).toMatchObject({ version: 2, content: { text: 'Ship on Tuesday.' } });

    const stale = store.addComment({ pageId: page.id, blockId: block.id, selectionQuote: 'Tuesday', instruction: 'Move again', start: 8, end: 15 });
    store.updateBlock(block.id, 2, { text: 'Ship next week.' });
    expect(() => store.applyComment(stale.id, 'Friday')).toThrow(/changed/i);
    expect(store.getPage(page.id)?.comments.find((item) => item.id === stale.id)?.status).toBe('open');
    store.close();
  });

  it('stores Memory block content only through the injected OS protector', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-memory-'));
    const filePath = path.join(directory, 'poppin.sqlite');
    const protector = {
      available: () => true,
      encrypt: (text: string) => Buffer.from(`protected:${Buffer.from(text).toString('base64')}`),
      decrypt: (value: Buffer) => Buffer.from(value.toString().slice('protected:'.length), 'base64').toString(),
    };
    const store = new PagesStore(filePath, protector);
    const tab = store.openMemory();
    const memory = store.getPage(tab.pageId)!;
    expect(memory.page.title).toBe('Memory');
    expect(memory.blocks[0]?.content).toEqual({ text: 'Keep durable notes, preferences, and working context here.' });
    store.updateBlock(memory.blocks[0]!.id, 1, { text: 'Private preference: quiet mornings.' });
    store.close();

    const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(filePath));
    expect(bytes.toString()).not.toContain('Private preference: quiet mornings.');
    const restored = new PagesStore(filePath, protector);
    expect(restored.getPage(tab.pageId)?.blocks[0]?.content).toEqual({ text: 'Private preference: quiet mornings.' });
    restored.close();
  });
});
