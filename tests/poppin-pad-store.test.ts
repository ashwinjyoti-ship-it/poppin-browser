// @vitest-environment node

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PoppinPadStore } from '../src/main/poppin-pad/poppin-pad-store';

describe('PoppinPadStore', () => {
  it('creates a primary pad and ingests dropped cards', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'poppin-pad-store-'));
    const store = new PoppinPadStore(path.join(directory, 'poppin.sqlite'));

    expect(store.getPadRecord()).toMatchObject({ id: 'primary', title: 'Poppin Pad', collapsed: true });

    const card = store.ingestDrop({ kind: 'text', text: 'error: connection refused at localhost:3000/api' }, 120, 80);
    expect(card.kind).toBe('card');
    expect(card.payload).toMatchObject({ subtype: 'log' });

    store.queueAttachment(card.id);
    expect(store.getPendingAttachments()).toHaveLength(1);

    store.clearCanvas('cards');
    expect(store.listObjects()).toHaveLength(0);
    expect(store.getPendingAttachments()).toHaveLength(0);
  });

  it('persists drawings separately from cards', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'poppin-pad-store-'));
    const store = new PoppinPadStore(path.join(directory, 'poppin.sqlite'));
    const now = new Date().toISOString();

    store.upsertObject({
      id: 'rect-1',
      kind: 'rect',
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      rotation: 0,
      zIndex: 1,
      payload: { stroke: '#000', fill: 'transparent', strokeWidth: 2 },
      createdAt: now,
      updatedAt: now,
    });
    store.ingestDrop({ kind: 'url', url: 'https://example.com' }, 40, 40);

    store.clearCanvas('drawings');
    expect(store.listObjects()).toHaveLength(1);
    expect(store.listObjects()[0]?.kind).toBe('card');
  });
});
