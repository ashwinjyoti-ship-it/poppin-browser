import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BrowserTaskSpace } from '../../shared/browser-agent';

export class BrowserAgentStateStore {
  readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'browser-agent-state.json');
  }

  async load(): Promise<BrowserTaskSpace | null> {
    try {
      return normalizeTaskSpace(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      return null;
    }
  }

  async save(taskSpace: BrowserTaskSpace | null): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ version: 2, taskSpace }, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

export function normalizeTaskSpace(value: unknown): BrowserTaskSpace | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { version?: unknown; taskSpace?: unknown };
  if ((record.version !== 1 && record.version !== 2) || !record.taskSpace || typeof record.taskSpace !== 'object') return null;
  const space = record.taskSpace as Partial<BrowserTaskSpace>;
  if (typeof space.id !== 'string' || typeof space.taskId !== 'string' || typeof space.name !== 'string') return null;
  if (space.owner !== 'agent' && space.owner !== 'user') return null;
  if (!['agent-controlling', 'waiting-for-approval', 'user-controlling', 'paused', 'completed', 'failed-stopped'].includes(space.status ?? '')) return null;
  if (!Array.isArray(space.tabIds) || !space.tabIds.every((id) => typeof id === 'string')) return null;
  if (space.activeTabId !== null && typeof space.activeTabId !== 'string') return null;
  if (typeof space.createdAt !== 'string' || typeof space.updatedAt !== 'string' || typeof space.kept !== 'boolean') return null;
  const tabIds = [...space.tabIds];
  const contextTabIds = record.version === 2 && Array.isArray(space.contextTabIds) && space.contextTabIds.every((id) => typeof id === 'string')
    ? space.contextTabIds.filter((id) => tabIds.includes(id))
    : [...tabIds];
  const explorationTabIds = record.version === 2 && Array.isArray(space.explorationTabIds) && space.explorationTabIds.every((id) => typeof id === 'string')
    ? space.explorationTabIds.filter((id) => tabIds.includes(id))
    : [];
  const mode = record.version === 2 && (space.mode === 'browser-only' || space.mode === 'mixed') ? space.mode : 'mixed';
  return { ...space, mode, tabIds, contextTabIds, explorationTabIds } as BrowserTaskSpace;
}
