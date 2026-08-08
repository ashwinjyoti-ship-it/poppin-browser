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
});
