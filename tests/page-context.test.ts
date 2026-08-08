// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { querySelectedDatabase, selectedPageContexts } from '../src/main/pages/page-context';
import { PagesStore } from '../src/main/pages/pages-store';

describe('native Page context', () => {
  it('flattens checked Pages and exposes open anchored instructions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-page-context-'));
    const store = new PagesStore(path.join(directory, 'poppin.sqlite'));
    const page = store.createPage({ title: 'Launch note' });
    const block = store.addBlock({ pageId: page.id, type: 'paragraph', content: { text: 'Ship on Monday.' } });
    store.addComment({ pageId: page.id, blockId: block.id, selectionQuote: 'Monday', instruction: 'Move to Tuesday', start: 8, end: 14 });
    expect(selectedPageContexts(store)).toEqual([]);
    store.setPageSelected(page.id, true);
    expect(selectedPageContexts(store)[0]).toMatchObject({ title: 'Launch note', kind: 'page', content: expect.stringContaining('Move to Tuesday') });
    store.close();
  });

  it('keeps large Databases bounded and rejects queries outside checked context', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-db-context-'));
    const store = new PagesStore(path.join(directory, 'poppin.sqlite'));
    const database = store.createPage({ title: 'Inventory', kind: 'database' });
    const name = store.addDatabaseProperty(database.id, { name: 'Name', type: 'text' });
    for (let index = 0; index < 40; index += 1) store.addDatabaseRow(database.id, { [name.id]: `Item ${index + 1}` });
    expect(() => querySelectedDatabase(store, database.id, 5)).toThrow(/select/i);
    store.setPageSelected(database.id, true);
    const context = selectedPageContexts(store)[0]!;
    expect(context.content).toContain('Use database_query');
    expect(context.content).not.toContain('Item 40');
    const query = querySelectedDatabase(store, database.id, 5);
    expect(query).toContain('Item 5');
    expect(query).not.toContain('Item 6');
    store.close();
  });
});
