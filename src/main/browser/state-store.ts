import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PersistedBrowserStateV1 } from '../../shared/browser';
import { isWindowState } from './window-state';

const STATE_VERSION = 1;

export class BrowserStateStore {
  readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'browser-state.json');
  }

  async load(): Promise<PersistedBrowserStateV1 | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      return isPersistedBrowserState(value) ? value : null;
    } catch {
      return null;
    }
  }

  async save(state: PersistedBrowserStateV1): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

export function isPersistedBrowserState(value: unknown): value is PersistedBrowserStateV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedBrowserStateV1>;
  if (candidate.version !== STATE_VERSION || !Array.isArray(candidate.tabs)) return false;
  if (typeof candidate.activeTabId !== 'string' || !isWindowState(candidate.window)) return false;
  if (candidate.tabs.length === 0 || candidate.tabs.length > 50) return false;

  const ids = new Set<string>();
  for (const tab of candidate.tabs) {
    if (!tab || typeof tab.id !== 'string' || typeof tab.url !== 'string') return false;
    if (ids.has(tab.id)) return false;
    ids.add(tab.id);
  }
  return ids.has(candidate.activeTabId);
}

