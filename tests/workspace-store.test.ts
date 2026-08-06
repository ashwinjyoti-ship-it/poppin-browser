// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WorkspaceStore } from '../src/main/workspace/workspace-store';

describe('workspace store', () => {
  it('creates, restores, and renames exactly one workspace', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-workspace-'));
    const filePath = path.join(directory, 'poppin.sqlite');
    const store = new WorkspaceStore(filePath);

    expect(store.getWorkspace()).toBeNull();
    expect(store.createWorkspace('Launch site')).toMatchObject({ id: 'primary', name: 'Launch site' });
    store.upsertDocument({
      id: 'doc-one',
      name: 'brief.md',
      path: '/tmp/brief.md',
      sizeBytes: 20,
      capturedText: null,
      truncated: false,
    });
    expect(store.setDocumentContext('doc-one', true, 'Visible brief', false)).toBe(true);
    store.upsertTabContext({
      tabId: 'tab-one',
      title: 'Example',
      url: 'https://example.com/',
      capturedText: 'Visible page',
      truncated: false,
      capturedAt: '2026-08-06T00:00:00.000Z',
    });
    store.renameWorkspace('Calm launch');
    expect(store.getWorkspace()).toMatchObject({ id: 'primary', name: 'Calm launch' });
    store.close();

    const restored = new WorkspaceStore(filePath);
    expect(restored.getWorkspace()).toMatchObject({ id: 'primary', name: 'Calm launch' });
    expect(restored.listDocuments()).toEqual([
      expect.objectContaining({ id: 'doc-one', selected: true, capturedText: 'Visible brief' }),
    ]);
    expect(restored.listTabContexts()).toEqual([
      expect.objectContaining({ tabId: 'tab-one', capturedText: 'Visible page' }),
    ]);
    restored.close();
  });
});
