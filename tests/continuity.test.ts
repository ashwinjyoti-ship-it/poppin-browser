import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildContinuityPayload,
  continuityToPersistedBrowserState,
  continuityWorkspaceApplyPlan,
  parseContinuityPayload,
} from '../src/main/continuity/payload';
import { ProfileStore } from '../src/main/continuity/profile-store';
import { openContinuityPayload, sealContinuityPayload } from '../src/main/continuity/seal';
import { DEFAULT_WINDOW_STATE } from '../src/main/browser/window-state';
import { WorkspaceStore } from '../src/main/workspace/workspace-store';
import { DEFAULT_BROWSER_SETTINGS } from '../src/shared/browser';
import { CONTINUITY_FORBIDDEN_KEYS } from '../src/shared/continuity';

describe('continuity seal', () => {
  it('round-trips a sealed package and rejects a wrong passphrase', () => {
    const sealed = sealContinuityPayload(JSON.stringify({ hello: 'world' }), 'correct-horse');
    expect(openContinuityPayload(sealed, 'correct-horse')).toContain('hello');
    expect(() => openContinuityPayload(sealed, 'wrong-passphrase')).toThrow(/Wrong passphrase/);
    expect(() => sealContinuityPayload('{}', 'short')).toThrow(/8 characters/);
  });
});

describe('continuity payload', () => {
  const profile = { id: 'profile-1', name: 'Work', createdAt: '2026-08-11T12:00:00.000Z' };

  it('exports allowlisted fields and strips task-owned tabs', () => {
    const payload = buildContinuityPayload({
      profile,
      browser: {
        tabs: [
          {
            id: 'tab-1',
            url: 'https://example.com/',
            title: 'Example',
            faviconUrls: [],
            pinned: true,
            groupId: 'group-1',
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            failure: null,
          },
          {
            id: 'agent-1',
            url: 'https://secret.example/',
            title: 'Agent',
            faviconUrls: [],
            pinned: false,
            groupId: null,
            taskSpaceId: 'space-1',
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            failure: null,
          },
        ],
        groups: [{ id: 'group-1', name: 'Research', color: 'blue', collapsed: false }],
        activeTabId: 'tab-1',
        isFullScreen: false,
        canReopenClosedTab: false,
        settings: DEFAULT_BROWSER_SETTINGS,
        authenticationPopup: null,
        linkPreview: null,
        split: null,
      },
      workspaceName: 'Primary',
      contextPacks: [{
        id: 'pack-1',
        name: 'Briefing',
        tabRefs: [{ url: 'https://example.com/', title: 'Example' }],
        documentIds: ['doc-1'],
        tandemPageIds: ['page-1'],
        includeMemory: true,
        createdAt: '2026-08-11T12:00:00.000Z',
      }],
      browserSessions: [{
        id: 'session-1',
        name: 'Morning',
        tabs: [{ url: 'https://example.com/', title: 'Example', pinned: false }],
        createdAt: '2026-08-11T12:00:00.000Z',
      }],
      recipes: [{
        id: 'recipe-1',
        name: 'Draft',
        startUrl: 'https://mail.example/',
        steps: [{ action: 'navigate', target: 'https://mail.example/', detail: 'Open mail' }],
        enabled: true,
        createdAt: '2026-08-11T12:00:00.000Z',
        updatedAt: '2026-08-11T12:00:00.000Z',
      }],
      tabContexts: [{
        tabId: 'tab-1',
        title: 'Example',
        url: 'https://example.com/',
        capturedText: 'should not appear as a body key dump',
        truncated: false,
        capturedAt: '2026-08-11T12:00:00.000Z',
      }],
      tandemPages: [{
        sourceType: 'tandem-page',
        workspaceId: 'ws',
        pageId: 'page-1',
        title: 'Notes',
        updatedAt: null,
        capturedMarkdown: 'SECRET MARKDOWN',
        capturedAt: '2026-08-11T12:00:00.000Z',
        truncated: false,
        stale: false,
      }],
      memorySelected: true,
      now: '2026-08-11T12:00:00.000Z',
    });

    expect(payload.browser.tabs).toEqual([{ url: 'https://example.com/', pinned: true, groupId: 'group-1' }]);
    expect(payload.workspace.tandemPages).toEqual([{ pageId: 'page-1', title: 'Notes' }]);
    expect(payload.workspace.tabSelections).toEqual([{ url: 'https://example.com/', title: 'Example' }]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('space-1');
    expect(serialized).not.toContain('SECRET MARKDOWN');
    expect(serialized).not.toContain('should not appear as a body key dump');
    for (const key of CONTINUITY_FORBIDDEN_KEYS) {
      expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'i'));
    }

    const sealed = sealContinuityPayload(JSON.stringify(payload), 'office-home-pass');
    const opened = parseContinuityPayload(openContinuityPayload(sealed, 'office-home-pass'));
    expect(opened.profileName).toBe('Work');
    expect(opened.browser.settings.searchEngine).toBe('duckduckgo');
  });

  it('maps import onto persisted browser state without window from the package', () => {
    const payload = buildContinuityPayload({
      profile,
      browser: {
        tabs: [{
          id: 'tab-1',
          url: 'https://example.com/',
          title: 'Example',
          faviconUrls: [],
          pinned: false,
          groupId: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          failure: null,
        }],
        groups: [],
        activeTabId: 'tab-1',
        isFullScreen: false,
        canReopenClosedTab: false,
        settings: { ...DEFAULT_BROWSER_SETTINGS, searchEngine: 'google' },
        authenticationPopup: null,
        linkPreview: null,
        split: null,
      },
      workspaceName: 'Primary',
      contextPacks: [],
      browserSessions: [],
      recipes: [],
      tabContexts: [],
      tandemPages: [],
      memorySelected: false,
    });
    const state = continuityToPersistedBrowserState(payload, DEFAULT_WINDOW_STATE);
    expect(state.settings.searchEngine).toBe('google');
    expect(state.window).toEqual(DEFAULT_WINDOW_STATE);
    expect(state.tabs[0]?.taskSpaceId).toBeUndefined();
  });
});

describe('profile store and workspace continuity apply', () => {
  it('creates a profile registry and applies workspace continuity data', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-continuity-'));
    const profiles = new ProfileStore(directory);
    const { profile, registry } = await profiles.createProfile('Home');
    expect(registry.activeProfileId).toBe(profile.id);
    expect(profiles.resolveDataRoot(registry)).toBe(path.join(directory, 'profiles', profile.id));

    const store = new WorkspaceStore(path.join(directory, 'poppin.sqlite'));
    store.createWorkspace('Old');
    store.insertRecipe({
      id: 'old',
      name: 'Old recipe',
      startUrl: null,
      steps: [{ action: 'navigate', target: 'https://a.example/', detail: 'a' }, { action: 'click', target: 'Go', detail: 'b' }],
      enabled: true,
      createdAt: '2026-08-11T12:00:00.000Z',
      updatedAt: '2026-08-11T12:00:00.000Z',
    });

    const payload = buildContinuityPayload({
      profile,
      browser: {
        tabs: [{
          id: 'tab-1',
          url: 'https://example.com/',
          title: 'Example',
          faviconUrls: [],
          pinned: false,
          groupId: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          failure: null,
        }],
        groups: [],
        activeTabId: 'tab-1',
        isFullScreen: false,
        canReopenClosedTab: false,
        settings: DEFAULT_BROWSER_SETTINGS,
        authenticationPopup: null,
        linkPreview: null,
        split: null,
      },
      workspaceName: 'Imported',
      contextPacks: [],
      browserSessions: [{
        id: 's1',
        name: 'Later',
        tabs: [{ url: 'https://example.com/', title: 'Example', pinned: true }],
        createdAt: '2026-08-11T12:00:00.000Z',
      }],
      recipes: [{
        id: 'r1',
        name: 'New recipe',
        startUrl: 'https://b.example/',
        steps: [{ action: 'navigate', target: 'https://b.example/', detail: 'open' }, { action: 'click', target: 'Ok', detail: 'done' }],
        enabled: true,
        createdAt: '2026-08-11T12:00:00.000Z',
        updatedAt: '2026-08-11T12:00:00.000Z',
      }],
      tabContexts: [],
      tandemPages: [],
      memorySelected: true,
    });

    store.replaceContinuityData(continuityWorkspaceApplyPlan(payload));
    expect(store.getWorkspace()?.name).toBe('Imported');
    expect(store.listRecipes().map((recipe) => recipe.name)).toEqual(['New recipe']);
    expect(store.listBrowserSessions()).toHaveLength(1);
    expect(store.isMemorySelected()).toBe(true);
    store.close();

    await writeFile(path.join(directory, 'marker.txt'), 'ok', 'utf8');
    expect(await readFile(path.join(directory, 'marker.txt'), 'utf8')).toBe('ok');
  });
});
