// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { PAGES_CHANNELS } from '../src/shared/pages';
import { PagesEngine } from '../src/main/pages/pages-engine';
import { PagesStore } from '../src/main/pages/pages-store';

describe('pages engine', () => {
  it('mirrors mutations through the Pages snapshot channel', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-pages-engine-'));
    const store = new PagesStore(path.join(directory, 'poppin.sqlite'));
    const send = vi.fn();
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } };
    const engine = new PagesEngine(window as unknown as Electron.BrowserWindow, store);

    const created = engine.execute({ type: 'createPage', title: 'Native note', kind: 'page' });
    expect(created).toMatchObject({ ok: true, id: expect.any(String) });
    expect(engine.getSnapshot()).toMatchObject({ pages: [{ title: 'Native note', kind: 'page' }] });
    expect(send).toHaveBeenLastCalledWith(PAGES_CHANNELS.snapshot, engine.getSnapshot());
    expect(engine.getPage(created.id!)).toMatchObject({ page: { title: 'Native note' }, blocks: [] });
    store.close();
  });
});
