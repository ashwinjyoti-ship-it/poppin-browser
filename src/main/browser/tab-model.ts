import { randomUUID } from 'node:crypto';

import type { PersistedTabState } from '../../shared/browser';
import { NEW_TAB_URL, normalizeTabInput } from './url-input';

export function createRestorableTab(input?: string, id: string = randomUUID()): PersistedTabState {
  const normalized = normalizeTabInput(input ?? '');
  return {
    id,
    url: normalized.kind === 'invalid' ? NEW_TAB_URL : normalized.url,
  };
}

export function closeTabModel(
  tabs: PersistedTabState[],
  activeTabId: string,
  closingTabId: string,
  replacementId: string = randomUUID(),
): { tabs: PersistedTabState[]; activeTabId: string } {
  const index = tabs.findIndex((tab) => tab.id === closingTabId);
  if (index < 0) return { tabs, activeTabId };

  const remaining = tabs.filter((tab) => tab.id !== closingTabId);
  if (remaining.length === 0) {
    const replacement = createRestorableTab(undefined, replacementId);
    return { tabs: [replacement], activeTabId: replacement.id };
  }

  if (activeTabId !== closingTabId) return { tabs: remaining, activeTabId };
  const nextIndex = Math.min(index, remaining.length - 1);
  return { tabs: remaining, activeTabId: remaining[nextIndex]?.id ?? remaining[0]!.id };
}
