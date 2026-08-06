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
    store.renameWorkspace('Calm launch');
    expect(store.getWorkspace()).toMatchObject({ id: 'primary', name: 'Calm launch' });
    store.close();

    const restored = new WorkspaceStore(filePath);
    expect(restored.getWorkspace()).toMatchObject({ id: 'primary', name: 'Calm launch' });
    restored.close();
  });
});
