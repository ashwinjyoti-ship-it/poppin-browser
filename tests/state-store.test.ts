import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BrowserStateStore, isPersistedBrowserState } from '../src/main/browser/state-store';
import { DEFAULT_WINDOW_STATE } from '../src/main/browser/window-state';
import type { PersistedBrowserStateV1 } from '../src/shared/browser';

const VALID_STATE: PersistedBrowserStateV1 = {
  version: 1,
  tabs: [{ id: 'tab-one', url: 'https://example.com/' }],
  activeTabId: 'tab-one',
  window: DEFAULT_WINDOW_STATE,
};

describe('browser state persistence', () => {
  it('validates a complete versioned state', () => {
    expect(isPersistedBrowserState(VALID_STATE)).toBe(true);
    expect(isPersistedBrowserState({ ...VALID_STATE, activeTabId: 'missing' })).toBe(false);
    expect(isPersistedBrowserState({ ...VALID_STATE, version: 2 })).toBe(false);
  });

  it('writes and restores state atomically', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-state-'));
    const store = new BrowserStateStore(directory);
    await store.save(VALID_STATE);

    expect(await store.load()).toEqual(VALID_STATE);
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(VALID_STATE);
  });

  it('falls back safely for missing or corrupt state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-state-'));
    expect(await new BrowserStateStore(directory).load()).toBeNull();
  });
});

