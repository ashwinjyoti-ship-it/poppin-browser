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
    store.saveProject({
      repositoryPath: '/tmp/project',
      remote: 'https://github.com/example/project.git',
      branch: 'main',
      installCommand: 'npm install',
      devCommand: 'npm run dev',
      previewUrl: 'http://localhost:3000',
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
    expect(restored.getProject()).toMatchObject({ repositoryPath: '/tmp/project', branch: 'main' });
    restored.close();
  });

  it('persists memory-selected state, context packs, and browser sessions across restarts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-workspace-packs-'));
    const filePath = path.join(directory, 'poppin.sqlite');
    const store = new WorkspaceStore(filePath);
    store.createWorkspace('Packs workspace');

    expect(store.isMemorySelected()).toBe(false);
    store.setMemorySelected(true);
    expect(store.isMemorySelected()).toBe(true);

    store.insertContextPack({
      id: 'pack-one',
      name: 'Launch prep',
      tabRefs: [{ url: 'https://example.com/', title: 'Example' }],
      documentIds: ['doc-one'],
      tandemPageIds: ['tandem-42'],
      includeMemory: true,
      createdAt: '2026-08-11T00:00:00.000Z',
    });
    store.insertBrowserSession({
      id: 'sess-one',
      name: 'Morning research',
      tabs: [
        { url: 'https://poppin.example/', title: 'Poppin', pinned: true },
        { url: 'https://example.com/', title: 'Example', pinned: false },
      ],
      createdAt: '2026-08-11T00:00:00.000Z',
    });
    store.close();

    const restored = new WorkspaceStore(filePath);
    expect(restored.isMemorySelected()).toBe(true);
    const packs = restored.listContextPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      id: 'pack-one',
      name: 'Launch prep',
      documentIds: ['doc-one'],
      tandemPageIds: ['tandem-42'],
      includeMemory: true,
    });
    expect(packs[0]?.tabRefs).toEqual([{ url: 'https://example.com/', title: 'Example' }]);

    expect(restored.renameContextPack('pack-one', 'Launch prep v2')).toBe(true);
    expect(restored.getContextPack('pack-one')?.name).toBe('Launch prep v2');
    expect(restored.deleteContextPack('pack-one')).toBe(true);
    expect(restored.listContextPacks()).toEqual([]);

    const sessions = restored.listBrowserSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 'sess-one', name: 'Morning research' });
    expect(sessions[0]?.tabs).toEqual([
      { url: 'https://poppin.example/', title: 'Poppin', pinned: true },
      { url: 'https://example.com/', title: 'Example', pinned: false },
    ]);
    expect(restored.renameBrowserSession('sess-one', 'Morning research v2')).toBe(true);
    expect(restored.getBrowserSession('sess-one')?.name).toBe('Morning research v2');
    expect(restored.deleteBrowserSession('sess-one')).toBe(true);
    expect(restored.listBrowserSessions()).toEqual([]);

    restored.setMemorySelected(false);
    restored.close();

    const roundTrip = new WorkspaceStore(filePath);
    expect(roundTrip.isMemorySelected()).toBe(false);
    roundTrip.close();
  });

  it('persists recipes and supports rename, disable, and delete', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-workspace-recipes-'));
    const filePath = path.join(directory, 'poppin.sqlite');
    const store = new WorkspaceStore(filePath);
    store.createWorkspace('Recipes workspace');

    const steps = [
      { action: 'navigate', target: 'https://example.com/', detail: 'Opened landing page.' },
      { action: 'click', target: 'Sign in', detail: 'Opened the sign-in form.' },
    ];
    store.insertRecipe({
      id: 'recipe-one',
      name: 'Example sign-in',
      startUrl: 'https://example.com/',
      steps,
      enabled: true,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    });
    store.close();

    const restored = new WorkspaceStore(filePath);
    const recipes = restored.listRecipes();
    expect(recipes).toHaveLength(1);
    expect(recipes[0]).toMatchObject({
      id: 'recipe-one',
      name: 'Example sign-in',
      startUrl: 'https://example.com/',
      enabled: true,
    });
    expect(restored.getRecipe('recipe-one')?.steps).toEqual(steps);

    expect(restored.renameRecipe('recipe-one', 'Example sign-in v2')).toBe(true);
    expect(restored.getRecipe('recipe-one')?.name).toBe('Example sign-in v2');

    expect(restored.setRecipeEnabled('recipe-one', false)).toBe(true);
    expect(restored.getRecipe('recipe-one')?.enabled).toBe(false);

    expect(restored.deleteRecipe('recipe-one')).toBe(true);
    expect(restored.listRecipes()).toEqual([]);
    expect(restored.getRecipe('recipe-one')).toBeNull();
    restored.close();
  });

  it('persists the mail inbox URL and user-defined mail skills', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-workspace-mail-'));
    const filePath = path.join(directory, 'poppin.sqlite');
    const store = new WorkspaceStore(filePath);
    store.createWorkspace('Mail workspace');
    store.setMailInboxUrl('https://mail.google.com/');
    store.insertMailSkill({
      id: 'skill-one',
      name: 'Meeting invites',
      rule: 'Do not draft a reply to meeting invites or minutes.',
      enabled: true,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    store.close();

    const restored = new WorkspaceStore(filePath);
    expect(restored.getMailInboxUrl()).toBe('https://mail.google.com/');
    expect(restored.listMailSkills()).toEqual([expect.objectContaining({
      id: 'skill-one',
      name: 'Meeting invites',
      enabled: true,
    })]);
    expect(restored.updateMailSkill('skill-one', { name: 'Meetings' })).toBe(true);
    expect(restored.getMailSkill('skill-one')?.name).toBe('Meetings');
    expect(restored.setMailSkillEnabled('skill-one', false)).toBe(true);
    expect(restored.getMailSkill('skill-one')?.enabled).toBe(false);
    expect(restored.deleteMailSkill('skill-one')).toBe(true);
    expect(restored.listMailSkills()).toEqual([]);
    restored.close();
  });
});
