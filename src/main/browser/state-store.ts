import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_BROWSER_SETTINGS,
  type BrowserGroupColor,
  type BrowserSettings,
  type BrowserTabGroup,
  type PersistedBrowserStateV1,
  type PersistedBrowserStateV2,
  type PersistedTabState,
} from '../../shared/browser';
import { isWindowState } from './window-state';

const GROUP_COLORS = new Set<BrowserGroupColor>(['amber', 'blue', 'green', 'rose', 'violet']);

export class BrowserStateStore {
  readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'browser-state.json');
  }

  async load(): Promise<PersistedBrowserStateV2 | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      return normalizePersistedBrowserState(value);
    } catch {
      return null;
    }
  }

  async save(state: PersistedBrowserStateV2): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

export function isPersistedBrowserState(value: unknown): value is PersistedBrowserStateV1 | PersistedBrowserStateV2 {
  return normalizePersistedBrowserState(value) !== null;
}

export function normalizePersistedBrowserState(value: unknown): PersistedBrowserStateV2 | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    version?: unknown;
    tabs?: unknown;
    groups?: unknown;
    activeTabId?: unknown;
    settings?: unknown;
    window?: unknown;
  };
  if ((candidate.version !== 1 && candidate.version !== 2) || !Array.isArray(candidate.tabs)) return null;
  if (typeof candidate.activeTabId !== 'string' || !isWindowState(candidate.window)) return null;
  if (candidate.tabs.length === 0 || candidate.tabs.length > 50) return null;

  const ids = new Set<string>();
  for (const tab of candidate.tabs) {
    if (!isPersistedTab(tab)) return null;
    if (ids.has(tab.id)) return null;
    ids.add(tab.id);
  }
  if (!ids.has(candidate.activeTabId)) return null;

  if (candidate.version === 1) {
    return {
      version: 2,
      tabs: candidate.tabs.map((tab) => ({ ...(tab as PersistedTabState), pinned: false, groupId: null, taskSpaceId: null })),
      groups: [],
      activeTabId: candidate.activeTabId,
      settings: { ...DEFAULT_BROWSER_SETTINGS },
      window: candidate.window,
    };
  }

  if (!Array.isArray(candidate.groups) || !isBrowserSettings(candidate.settings)) return null;
  const groups = candidate.groups.filter(isBrowserTabGroup);
  if (groups.length !== candidate.groups.length || new Set(groups.map((group) => group.id)).size !== groups.length) return null;
  const groupIds = new Set(groups.map((group) => group.id));
  if (candidate.tabs.some((tab) => tab.groupId && !groupIds.has(tab.groupId))) return null;
  return {
    version: 2,
    tabs: candidate.tabs.map((value) => {
      const tab = value as PersistedTabState;
      return {
        ...tab,
        pinned: tab.pinned === true,
        groupId: tab.groupId ?? null,
        ...(Object.hasOwn(tab, 'taskSpaceId') ? { taskSpaceId: tab.taskSpaceId ?? null } : {}),
        ...(tab.surface === 'tandem-world' ? { surface: tab.surface } : {}),
      };
    }),
    groups,
    activeTabId: candidate.activeTabId,
    settings: normalizeBrowserSettings(candidate.settings),
    window: candidate.window,
  };
}

function isPersistedTab(value: unknown): value is PersistedTabState {
  if (!value || typeof value !== 'object') return false;
  const tab = value as Partial<PersistedTabState>;
  return typeof tab.id === 'string'
    && typeof tab.url === 'string'
    && (tab.pinned === undefined || typeof tab.pinned === 'boolean')
    && (tab.groupId === undefined || tab.groupId === null || typeof tab.groupId === 'string')
    && (tab.taskSpaceId === undefined || tab.taskSpaceId === null || typeof tab.taskSpaceId === 'string')
    && (tab.surface === undefined || tab.surface === 'tandem-world');
}

function isBrowserTabGroup(value: unknown): value is BrowserTabGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Partial<BrowserTabGroup>;
  return typeof group.id === 'string'
    && typeof group.name === 'string'
    && group.name.length > 0
    && Boolean(group.color && GROUP_COLORS.has(group.color))
    && typeof group.collapsed === 'boolean';
}

function isBrowserSettings(value: unknown): value is Partial<BrowserSettings> {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<BrowserSettings>;
  return ['follow-site', 'new-tab', 'same-tab'].includes(settings.linkOpening ?? '')
    && typeof settings.focusNewTabs === 'boolean'
    && ['restore', 'new-tab'].includes(settings.startup ?? '')
    && ['next-to-active', 'end'].includes(settings.newTabPosition ?? '')
    && typeof settings.warnBeforeClosingMultipleTabs === 'boolean'
    && ['duckduckgo', 'google'].includes(settings.searchEngine ?? '');
}

function normalizeBrowserSettings(settings: Partial<BrowserSettings>): BrowserSettings {
  return {
    linkOpening: ['follow-site', 'new-tab', 'same-tab'].includes(settings.linkOpening ?? '')
      ? settings.linkOpening as BrowserSettings['linkOpening']
      : DEFAULT_BROWSER_SETTINGS.linkOpening,
    focusNewTabs: Boolean(settings.focusNewTabs),
    startup: settings.startup === 'new-tab' ? 'new-tab' : 'restore',
    newTabPosition: settings.newTabPosition === 'end' ? 'end' : 'next-to-active',
    warnBeforeClosingMultipleTabs: Boolean(settings.warnBeforeClosingMultipleTabs),
    searchEngine: settings.searchEngine === 'google' ? 'google' : 'duckduckgo',
    tabsStartCollapsed: typeof settings.tabsStartCollapsed === 'boolean'
      ? settings.tabsStartCollapsed
      : DEFAULT_BROWSER_SETTINGS.tabsStartCollapsed,
    drawOutTabsOnHover: typeof settings.drawOutTabsOnHover === 'boolean'
      ? settings.drawOutTabsOnHover
      : DEFAULT_BROWSER_SETTINGS.drawOutTabsOnHover,
  };
}
