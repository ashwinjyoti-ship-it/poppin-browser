import { randomUUID } from 'node:crypto';

import {
  DEFAULT_BROWSER_SETTINGS,
  type BrowserSettings,
  type BrowserSnapshot,
  type PersistedBrowserStateV2,
  type PersistedTabState,
  type WindowState,
} from '../../shared/browser';
import {
  CONTINUITY_FORBIDDEN_KEYS,
  CONTINUITY_PACKAGE_VERSION,
  type ContinuityPayloadV1,
  type ContinuityProfileSnapshot,
} from '../../shared/continuity';
import type {
  BrowserSessionSnapshot,
  ContextPackSnapshot,
  RecipeSnapshot,
  TabContextSnapshot,
} from '../../shared/workspace';
import type { TandemContextSnapshot } from '../../shared/tandem';

export interface ContinuityBuildInput {
  profile: ContinuityProfileSnapshot;
  browser: BrowserSnapshot;
  workspaceName: string | null;
  contextPacks: ContextPackSnapshot[];
  browserSessions: BrowserSessionSnapshot[];
  recipes: RecipeSnapshot[];
  tabContexts: TabContextSnapshot[];
  tandemPages: TandemContextSnapshot[];
  memorySelected: boolean;
  now?: string;
}

/** Builds an allowlisted continuity payload. Strips task-owned tabs and forbidden fields. */
export function buildContinuityPayload(input: ContinuityBuildInput): ContinuityPayloadV1 {
  const ordinaryTabs = input.browser.tabs.filter((tab) => !tab.taskSpaceId);
  const groupIds = new Set(ordinaryTabs.map((tab) => tab.groupId).filter((id): id is string => Boolean(id)));
  const groups = input.browser.groups
    .filter((group) => groupIds.has(group.id) || ordinaryTabs.some((tab) => tab.groupId === group.id))
    .map((group) => ({ id: group.id, name: group.name, color: group.color, collapsed: group.collapsed }));
  const groupIdSet = new Set(groups.map((group) => group.id));

  const tabs = ordinaryTabs.map((tab) => ({
    url: tab.url,
    pinned: tab.pinned,
    groupId: tab.groupId && groupIdSet.has(tab.groupId) ? tab.groupId : null,
  }));

  let activeTabIndex = Math.max(0, ordinaryTabs.findIndex((tab) => tab.id === input.browser.activeTabId));
  if (tabs.length === 0) {
    tabs.push({ url: 'poppin://new', pinned: false, groupId: null });
    activeTabIndex = 0;
  }
  if (activeTabIndex < 0 || activeTabIndex >= tabs.length) activeTabIndex = 0;

  const payload: ContinuityPayloadV1 = {
    version: CONTINUITY_PACKAGE_VERSION,
    exportedAt: input.now ?? new Date().toISOString(),
    profileName: input.profile.name,
    browser: {
      tabs,
      groups,
      activeTabIndex,
      settings: { ...input.browser.settings },
    },
    workspace: {
      name: input.workspaceName,
      contextPacks: input.contextPacks.map((pack) => ({
        name: pack.name,
        tabRefs: pack.tabRefs.map((ref) => ({ url: ref.url, title: ref.title })),
        documentIds: [...pack.documentIds],
        tandemPageIds: [...pack.tandemPageIds],
        includeMemory: pack.includeMemory,
      })),
      browserSessions: input.browserSessions.map((session) => ({
        name: session.name,
        tabs: session.tabs.map((tab) => ({ url: tab.url, title: tab.title, pinned: tab.pinned })),
      })),
      recipes: input.recipes.map((recipe) => ({
        name: recipe.name,
        startUrl: recipe.startUrl,
        steps: recipe.steps.map((step) => ({ ...step })),
        enabled: recipe.enabled,
      })),
      tabSelections: input.tabContexts.map((context) => ({ url: context.url, title: context.title })),
      tandemPages: input.tandemPages.map((page) => ({ pageId: page.pageId, title: page.title })),
      memorySelected: input.memorySelected,
    },
  };

  assertPayloadAllowlisted(payload);
  return payload;
}

export function parseContinuityPayload(raw: string): ContinuityPayloadV1 {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('That continuity package is not valid JSON.');
  }
  if (!isContinuityPayloadV1(value)) {
    throw new Error('That continuity package is not a supported Poppin format.');
  }
  assertPayloadAllowlisted(value);
  return value;
}

export function isContinuityPayloadV1(value: unknown): value is ContinuityPayloadV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as ContinuityPayloadV1;
  if (candidate.version !== CONTINUITY_PACKAGE_VERSION) return false;
  if (typeof candidate.exportedAt !== 'string' || typeof candidate.profileName !== 'string') return false;
  if (!candidate.browser || !Array.isArray(candidate.browser.tabs) || candidate.browser.tabs.length === 0) return false;
  if (!Array.isArray(candidate.browser.groups)) return false;
  if (typeof candidate.browser.activeTabIndex !== 'number') return false;
  if (!isBrowserSettings(candidate.browser.settings)) return false;
  if (!candidate.workspace || typeof candidate.workspace !== 'object') return false;
  if (!Array.isArray(candidate.workspace.contextPacks)) return false;
  if (!Array.isArray(candidate.workspace.browserSessions)) return false;
  if (!Array.isArray(candidate.workspace.recipes)) return false;
  if (!Array.isArray(candidate.workspace.tabSelections)) return false;
  if (!Array.isArray(candidate.workspace.tandemPages)) return false;
  if (typeof candidate.workspace.memorySelected !== 'boolean') return false;
  return true;
}

/** Maps a continuity payload onto persisted browser state, preserving local window geometry. */
export function continuityToPersistedBrowserState(
  payload: ContinuityPayloadV1,
  window: WindowState,
): PersistedBrowserStateV2 {
  const groupIdMap = new Map<string, string>();
  const groups = payload.browser.groups.map((group) => {
    const id = randomUUID();
    groupIdMap.set(group.id, id);
    return { id, name: group.name, color: group.color, collapsed: group.collapsed };
  });

  const tabs: PersistedTabState[] = payload.browser.tabs.slice(0, 50).map((tab) => ({
    id: randomUUID(),
    url: tab.url,
    pinned: tab.pinned,
    groupId: tab.groupId ? groupIdMap.get(tab.groupId) ?? null : null,
  }));

  const activeIndex = Math.min(Math.max(0, payload.browser.activeTabIndex), tabs.length - 1);
  return {
    version: 2,
    tabs,
    groups,
    activeTabId: tabs[activeIndex]!.id,
    settings: { ...payload.browser.settings },
    window,
  };
}

export function continuityWorkspaceApplyPlan(payload: ContinuityPayloadV1, now = new Date().toISOString()): {
  workspaceName: string | null;
  memorySelected: boolean;
  contextPacks: ContextPackSnapshot[];
  browserSessions: BrowserSessionSnapshot[];
  recipes: RecipeSnapshot[];
  tabContexts: TabContextSnapshot[];
  /** Informational only — Tandem pages require a live Tandem connection to re-select. */
  tandemPages: ContinuityPayloadV1['workspace']['tandemPages'];
} {
  return {
    workspaceName: payload.workspace.name,
    memorySelected: payload.workspace.memorySelected,
    contextPacks: payload.workspace.contextPacks.map((pack) => ({
      id: randomUUID(),
      name: pack.name,
      tabRefs: pack.tabRefs.map((ref) => ({ ...ref })),
      documentIds: [...pack.documentIds],
      tandemPageIds: [...pack.tandemPageIds],
      includeMemory: pack.includeMemory,
      createdAt: now,
    })),
    browserSessions: payload.workspace.browserSessions.map((session) => ({
      id: randomUUID(),
      name: session.name,
      tabs: session.tabs.map((tab) => ({ ...tab })),
      createdAt: now,
    })),
    recipes: payload.workspace.recipes.map((recipe) => ({
      id: randomUUID(),
      name: recipe.name,
      startUrl: recipe.startUrl,
      steps: recipe.steps.map((step) => ({ ...step })),
      enabled: recipe.enabled,
      createdAt: now,
      updatedAt: now,
    })),
    tabContexts: payload.workspace.tabSelections.map((selection) => ({
      tabId: `continuity:${randomUUID()}`,
      title: selection.title,
      url: selection.url,
      capturedText: '',
      truncated: false,
      capturedAt: now,
    })),
    tandemPages: payload.workspace.tandemPages,
  };
}

export function assertPayloadAllowlisted(payload: ContinuityPayloadV1): void {
  const serialized = JSON.stringify(payload);
  for (const key of CONTINUITY_FORBIDDEN_KEYS) {
    if (new RegExp(`"${key}"\\s*:`, 'i').test(serialized)) {
      throw new Error(`Continuity payload must not include "${key}".`);
    }
  }
}

function isBrowserSettings(value: unknown): value is BrowserSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as BrowserSettings;
  return typeof settings.linkOpening === 'string'
    && typeof settings.focusNewTabs === 'boolean'
    && typeof settings.startup === 'string'
    && typeof settings.newTabPosition === 'string'
    && typeof settings.warnBeforeClosingMultipleTabs === 'boolean'
    && typeof settings.searchEngine === 'string'
    && Object.keys(DEFAULT_BROWSER_SETTINGS).every((key) => key in settings);
}

