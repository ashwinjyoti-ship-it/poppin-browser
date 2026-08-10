import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BrowserStateStore, isPersistedBrowserState } from '../src/main/browser/state-store';
import { DEFAULT_WINDOW_STATE } from '../src/main/browser/window-state';
import { DEFAULT_BROWSER_SETTINGS, type PersistedBrowserStateV1, type PersistedBrowserStateV2 } from '../src/shared/browser';

const VALID_STATE: PersistedBrowserStateV2 = {
  version: 2,
  tabs: [{ id: 'tab-one', url: 'https://example.com/', pinned: false, groupId: null, surface: 'tandem-world' }],
  groups: [],
  activeTabId: 'tab-one',
  settings: DEFAULT_BROWSER_SETTINGS,
  window: DEFAULT_WINDOW_STATE,
};

const LEGACY_STATE: PersistedBrowserStateV1 = {
  version: 1,
  tabs: [{ id: 'tab-one', url: 'https://example.com/' }],
  activeTabId: 'tab-one',
  window: DEFAULT_WINDOW_STATE,
};

describe('browser state persistence', () => {
  it('validates a complete versioned state', () => {
    expect(isPersistedBrowserState(VALID_STATE)).toBe(true);
    expect(isPersistedBrowserState({ ...VALID_STATE, tabs: [{ ...VALID_STATE.tabs[0], surface: 'unknown' }] })).toBe(false);
    expect(isPersistedBrowserState({ ...VALID_STATE, activeTabId: 'missing' })).toBe(false);
    expect(isPersistedBrowserState({ ...VALID_STATE, version: 3 })).toBe(false);
  });

  it('migrates version one sessions without losing tabs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-state-'));
    const store = new BrowserStateStore(directory);
    await (store as unknown as { save(state: PersistedBrowserStateV2): Promise<void> }).save({
      ...VALID_STATE,
      tabs: LEGACY_STATE.tabs,
    });
    const written = JSON.parse(await readFile(store.filePath, 'utf8')) as Record<string, unknown>;
    written.version = 1;
    delete written.groups;
    delete written.settings;
    await import('node:fs/promises').then(({ writeFile }) => writeFile(store.filePath, JSON.stringify(written), 'utf8'));
    expect(await store.load()).toMatchObject({ version: 2, tabs: [{ id: 'tab-one', pinned: false, groupId: null }] });
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
