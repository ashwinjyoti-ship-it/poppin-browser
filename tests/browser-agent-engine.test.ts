// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BrowserAgentEngine, type BrowserAgentPageController } from '../src/main/browser/browser-agent-engine';
import { BrowserAgentStateStore } from '../src/main/browser/browser-agent-state-store';
import type { BrowserAgentAction } from '../src/shared/browser-agent';

class FakePages implements BrowserAgentPageController {
  tabs = new Set(['approved', 'other']);
  urls = new Map<string, string>([['approved', 'https://example.com'], ['other', 'https://example.com']]);
  activated: string[] = [];
  performed: Array<{ tabId: string; action: BrowserAgentAction }> = [];
  mediaPolicies: Array<{ taskSpaceId: string; blocked: boolean }> = [];
  explorationUrls: string[] = [];
  explorationCount = 0;
  inspection: { credential: boolean; consequential: string | null; takeover?: string | null; target: string } = { credential: false, consequential: null, target: 'visible target' };

  hasTab(tabId: string) { return this.tabs.has(tabId); }
  tabUrl(tabId: string) { return this.urls.get(tabId) ?? null; }
  listOrdinaryTabs() {
    return [...this.tabs].flatMap((id) => {
      if (id.startsWith('agent-')) return [];
      const url = this.urls.get(id);
      return url ? [{ id, url }] : [];
    });
  }
  createTaskSpaceTabs(taskSpaceId: string, sourceTabIds: string[]) {
    return sourceTabIds.map((tabId) => {
      const id = `agent-${tabId}`;
      this.tabs.add(id);
      this.urls.set(id, this.urls.get(tabId) ?? 'https://example.com');
      return id;
    });
  }
  createTaskSpaceExplorationTab(_taskSpaceId: string, url?: string) {
    this.explorationCount += 1;
    this.explorationUrls.push(url ?? '');
    const id = this.explorationCount === 1 ? 'agent-exploration' : `agent-exploration-${this.explorationCount}`;
    this.tabs.add(id);
    this.urls.set(id, url || 'https://example.com');
    return id;
  }
  prepareTabForAgent(tabId: string) { return this.tabs.has(tabId) && tabId.startsWith('agent-'); }
  watchTaskSpace(_taskSpaceId: string, tabId: string | null) { if (tabId) this.activated.push(tabId); return Boolean(tabId && this.tabs.has(tabId)); }
  closeTaskSpaceTab(_taskSpaceId: string, tabId: string) { return this.tabs.delete(tabId); }
  closeTaskSpaceTabs() { for (const id of [...this.tabs]) if (id.startsWith('agent-')) this.tabs.delete(id); }
  setTaskSpaceMediaBlocked(taskSpaceId: string, blocked: boolean) { this.mediaPolicies.push({ taskSpaceId, blocked }); }
  async createSemanticSnapshot(tabId: string, snapshotId: string, taskSpaceId: string) {
    return { snapshotId, taskSpaceId, tabId, documentId: `${tabId}:1`, url: 'https://example.com', title: 'Fixture', createdAt: new Date().toISOString(), nodes: [] };
  }
  isSemanticSnapshotCurrent() { return true; }
  async inspectAction() { return this.inspection; }
  async performAction(tabId: string, action: BrowserAgentAction) { this.performed.push({ tabId, action }); return 'visible page content'; }
}

function agentAct(engine: BrowserAgentEngine, action: BrowserAgentAction, tabId = 'agent-approved') {
  return engine.execute({ type: 'act', taskSpaceId: engine.getSnapshot().taskSpace!.id, tabId, action });
}

function setup() {
  const pages = new FakePages();
  const send = vi.fn();
  const captured = vi.fn();
  const engine = new BrowserAgentEngine({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }, pages, captured);
  return { engine, pages, send, captured };
}

describe('BrowserAgentEngine', () => {
  it('watches the first context clone when mixed work has selected tabs', async () => {
    const { engine, pages } = setup();
    expect(await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] })).toMatchObject({ ok: true });
    expect(engine.getSnapshot().activeTabId).toBe('agent-approved');
    expect(pages.activated[0]).toBe('agent-approved');
  });

  it('limits every action to explicitly approved tabs and revokes access on stop', async () => {
    const { engine, pages } = setup();
    expect(await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] })).toMatchObject({ ok: true });
    expect(engine.getSnapshot().taskSpace).toMatchObject({
      mode: 'mixed', tabIds: ['agent-approved', 'agent-exploration'],
      contextTabIds: ['agent-approved'], explorationTabIds: ['agent-exploration'], activeTabId: 'agent-approved',
    });
    expect(pages.tabs).toEqual(new Set(['approved', 'other', 'agent-approved', 'agent-exploration']));
    const denied = await agentAct(engine, { type: 'read' }, 'other');
    expect(denied).toMatchObject({ ok: false, message: expect.stringMatching(/not approved|task-owned/i) });
    expect(pages.performed).toHaveLength(0);
    expect(await engine.execute({ type: 'stop' })).toEqual({ ok: true });
    expect(engine.getSnapshot()).toMatchObject({ state: 'stopped', taskSpace: { owner: 'user', status: 'failed-stopped' } });
  });

  it('starts browser-only work from a fresh exploration tab without selected tabs', async () => {
    const { engine, pages } = setup();
    expect(await engine.execute({ type: 'start', taskId: 'task-1', mode: 'browser-only', tabIds: [] })).toMatchObject({ ok: true });
    expect(engine.getSnapshot().taskSpace).toMatchObject({
      mode: 'browser-only', tabIds: ['agent-exploration'], contextTabIds: [], explorationTabIds: ['agent-exploration'],
    });
    expect(engine.getSnapshot().watching).toBe(true);
    expect(pages.activated).toEqual(['agent-exploration']);
    expect(pages.explorationUrls).toEqual(['']);
    expect((await agentAct(engine, { type: 'navigate', url: 'https://example.com' }, 'agent-exploration')).ok).toBe(true);
    expect(pages.performed).toContainEqual({ tabId: 'agent-exploration', action: { type: 'navigate', url: 'https://example.com' } });
  });

  it('seeds the exploration Agent Tab with a Mail inbox URL', async () => {
    const { engine, pages } = setup();
    expect(await engine.execute({
      type: 'start', taskId: 'mail-1', name: 'Mail', mode: 'browser-only', tabIds: [], url: 'https://mail.google.com/',
    })).toMatchObject({ ok: true });
    expect(pages.explorationUrls).toEqual(['https://mail.google.com/']);
    expect(engine.getSnapshot()).toMatchObject({
      watching: true,
      taskSpace: { name: 'Mail', mode: 'browser-only', activeTabId: 'agent-exploration' },
    });
    expect(await engine.execute({
      type: 'start', taskId: 'mail-2', name: 'Mail', mode: 'browser-only', tabIds: [], url: 'javascript:alert(1)',
    })).toMatchObject({ ok: false, message: expect.stringMatching(/HTTP and HTTPS/i) });
  });

  it('shows live Agent Tabs by default, follows agent tab changes, and lets the user leave without stopping', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    expect(engine.getSnapshot().watching).toBe(true);
    expect(pages.activated).toEqual(['agent-approved']);
    expect((await agentAct(engine, { type: 'read' }, 'agent-approved')).ok).toBe(true);
    expect(pages.activated).toEqual(['agent-approved', 'agent-approved']);
    expect(await engine.execute({ type: 'leaveWatch' })).toEqual({ ok: true });
    expect(engine.getSnapshot()).toMatchObject({ state: 'running', watching: false });
    expect((await agentAct(engine, { type: 'read' }, 'agent-exploration')).ok).toBe(true);
    expect(pages.activated).toEqual(['agent-approved', 'agent-approved']);
    expect(await engine.execute({ type: 'watch' })).toEqual({ ok: true });
    expect(pages.activated).toEqual(['agent-approved', 'agent-approved', 'agent-exploration']);
  });

  it('retains task-owned tabs after successful completion so a follow-up can resume them', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'browser-only', tabIds: [] });
    expect(engine.getSnapshot().watching).toBe(true);
    engine.complete();
    expect(engine.getSnapshot()).toMatchObject({
      state: 'completed', watching: false,
      taskSpace: { owner: 'user', status: 'completed', kept: false, tabIds: ['agent-exploration'] },
    });
    expect(pages.tabs.has('agent-exploration')).toBe(true);
    expect(await engine.execute({ type: 'resume' })).toEqual({ ok: true });
    expect(engine.getSnapshot()).toMatchObject({
      state: 'running',
      taskSpace: { owner: 'agent', status: 'agent-controlling', id: engine.getSnapshot().taskSpace!.id },
    });
  });

  it('keeps a mailbox Agent Tab after successful completion so the next mail turn can resume it', async () => {
    const { engine, pages } = setup();
    expect(await engine.execute({
      type: 'start', taskId: 'mail-1', name: 'Mail', mode: 'browser-only', tabIds: [], url: 'https://outlook.live.com/mail/',
    })).toMatchObject({ ok: true });
    engine.complete();
    expect(engine.getSnapshot()).toMatchObject({
      state: 'completed', watching: false,
      taskSpace: { owner: 'user', status: 'completed', kept: false, tabIds: ['agent-exploration'] },
    });
    expect(pages.tabs.has('agent-exploration')).toBe(true);
    expect(await engine.execute({ type: 'resume' })).toEqual({ ok: true });
    expect(engine.getSnapshot()).toMatchObject({
      state: 'running',
      taskSpace: { owner: 'agent', status: 'agent-controlling', id: engine.getSnapshot().taskSpace!.id },
    });
    expect((await agentAct(engine, { type: 'read' }, 'agent-exploration')).ok).toBe(true);
  });

  it('preserves tabs only when the user opts in before completion', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'browser-only', tabIds: [] });
    expect(await engine.execute({ type: 'setKeepTabs', keep: true })).toEqual({ ok: true });
    engine.complete();
    expect(engine.getSnapshot()).toMatchObject({
      state: 'completed', watching: false,
      taskSpace: { owner: 'user', status: 'completed', kept: true },
    });
    expect(pages.tabs.has('agent-exploration')).toBe(true);
    expect(pages.mediaPolicies.at(-1)).toMatchObject({ blocked: false });
  });

  it('supports pause, explicit resume, and immediate user takeover', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    expect(await engine.execute({ type: 'takeOver' })).toEqual({ ok: true });
    expect(engine.getSnapshot().state).toBe('paused');
    expect((await agentAct(engine, { type: 'scroll', deltaY: 500 })).ok).toBe(false);
    expect(await engine.execute({ type: 'resume' })).toEqual({ ok: true });
    expect((await agentAct(engine, { type: 'scroll', deltaY: 500 })).ok).toBe(true);
    expect(pages.mediaPolicies.slice(-2)).toEqual([
      expect.objectContaining({ blocked: false }),
      expect.objectContaining({ blocked: true }),
    ]);
  });

  it('opens and closes bounded dynamic exploration tabs inside the active task space', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'browser-only', tabIds: [] });
    for (let index = 0; index < 5; index += 1) {
      expect((await agentAct(engine, { type: 'openTab', url: `https://example.com/${index}` }, 'agent-exploration')).ok).toBe(true);
    }
    expect(engine.getSnapshot().taskSpace?.explorationTabIds).toHaveLength(6);
    expect((await agentAct(engine, { type: 'openTab' }, 'agent-exploration')).message).toMatch(/maximum of 6/i);
    expect((await agentAct(engine, { type: 'closeTab' }, 'agent-exploration-2')).ok).toBe(true);
    expect(engine.getSnapshot().allowedTabIds).not.toContain('agent-exploration-2');
    expect(pages.tabs.has('agent-exploration-2')).toBe(false);
  });

  it('reads sanitized structured metadata without navigating a candidate', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'browser-only', tabIds: [] });
    expect((await agentAct(engine, { type: 'readMetadata' }, 'agent-exploration')).ok).toBe(true);
    expect(pages.performed).toContainEqual({ tabId: 'agent-exploration', action: { type: 'readMetadata' } });
  });

  it('reuses a signed-in human tab instead of pausing for auth on the same site', async () => {
    const { engine, pages } = setup();
    pages.urls.set('approved', 'https://github.com/issues');
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    expect((await agentAct(engine, { type: 'navigate', url: 'https://github.com/login' }, 'agent-exploration'))).toEqual({ ok: true, data: 'visible page content' });
    expect(engine.getSnapshot().state).toBe('running');
    expect(pages.performed).toContainEqual({
      tabId: 'agent-exploration',
      action: { type: 'navigate', url: 'https://github.com/issues' },
    });
  });

  it('still pauses for auth when no signed-in human tab exists for that site', async () => {
    const { engine } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'browser-only', tabIds: [] });
    expect((await agentAct(engine, { type: 'navigate', url: 'https://github.com/login' }, 'agent-exploration')).message).toMatch(/takeover required/i);
    expect(engine.getSnapshot()).toMatchObject({ state: 'paused', taskSpace: { owner: 'user', status: 'user-controlling' } });
  });

  it('never operates credential fields or accepts credential-like typing', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    expect((await agentAct(engine, { type: 'type', selector: '#field', text: 'one-time verification code' })).message).toMatch(/never types/i);
    pages.inspection = { credential: true, consequential: null, target: 'password input' };
    expect((await agentAct(engine, { type: 'click', selector: '#password' })).message).toMatch(/takeover required/i);
    expect(engine.getSnapshot()).toMatchObject({ state: 'paused', taskSpace: { owner: 'user', status: 'user-controlling' } });
    expect(pages.performed).toHaveLength(0);
  });

  it('hands playback controls to the user instead of operating them', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'browser-only', tabIds: [] });
    pages.inspection = { credential: false, consequential: null, takeover: 'Media playback remains under user control.', target: 'Play' };
    expect((await agentAct(engine, { type: 'click', selector: '#play' }, 'agent-exploration')).message).toBe('User takeover required.');
    expect(engine.getSnapshot()).toMatchObject({ state: 'paused', taskSpace: { owner: 'user', status: 'user-controlling' } });
    expect(pages.performed).toHaveLength(0);
    expect(pages.mediaPolicies.at(-1)).toMatchObject({ blocked: false });
  });

  it('binds semantic references to only the latest read snapshot', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    const read = await agentAct(engine, { type: 'read' });
    const snapshot = JSON.parse(read.data!) as { snapshotId: string };
    expect((await agentAct(engine, { type: 'click', ref: 'r1', snapshotId: 'older-snapshot' })).message).toMatch(/stale/i);
    expect(pages.performed).toHaveLength(0);
    expect((await agentAct(engine, { type: 'click', ref: 'r1', snapshotId: snapshot.snapshotId })).ok).toBe(true);
  });

  it('runs a bounded batch and requires terminal page-state verification', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    const read = await agentAct(engine, { type: 'read' });
    const snapshotId = (JSON.parse(read.data!) as { snapshotId: string }).snapshotId;
    const scope = engine.getSnapshot().taskSpace!;
    expect(await engine.execute({ type: 'batch', taskSpaceId: scope.id, tabId: 'agent-approved', snapshotId, steps: [{ action: 'fill', ref: 'r1', text: 'Draft' }] })).toMatchObject({ ok: false, message: expect.stringMatching(/read or assert/i) });
    const result = await engine.execute({
      type: 'batch', taskSpaceId: scope.id, tabId: 'agent-approved', snapshotId,
      steps: [{ action: 'fill', ref: 'r1', text: 'Draft' }, { action: 'read' }],
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.data!)).toMatchObject({ verified: true, steps: [{ step: 0, ok: true }, { step: 1, ok: true }] });
    expect(pages.performed).toContainEqual({ tabId: 'agent-approved', action: expect.objectContaining({ type: 'type', ref: 'r1', text: 'Draft' }) });
  });

  it('stops a batch exactly before a critical step and skips it on rejection', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    const read = await agentAct(engine, { type: 'read' });
    const snapshotId = (JSON.parse(read.data!) as { snapshotId: string }).snapshotId;
    pages.inspection = { credential: false, consequential: 'This action may send a message.', target: 'Send' };
    const scope = engine.getSnapshot().taskSpace!;
    const pending = await engine.execute({
      type: 'batch', taskSpaceId: scope.id, tabId: 'agent-approved', snapshotId,
      steps: [{ action: 'click', ref: 'r1' }, { action: 'read' }],
    });
    expect(pending).toEqual({ ok: false, message: 'Approval required.' });
    expect(pages.performed).toHaveLength(0);
    await engine.execute({ type: 'respondApproval', decision: 'reject' });
    expect(pages.performed).toHaveLength(0);
    expect(engine.getSnapshot().log).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'Batch click', outcome: 'rejected' }), expect.objectContaining({ action: 'Batch read', outcome: 'rejected' })]));
  });

  it('pauses consequential actions and performs them only after exact approval', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    pages.inspection = { credential: false, consequential: 'This action may submit a form.', target: 'Send report' };
    const requested = await agentAct(engine, { type: 'click', selector: '#send' });
    expect(requested).toEqual({ ok: false, message: 'Approval required.' });
    expect(engine.getSnapshot()).toMatchObject({
      state: 'needs-approval',
      pendingApproval: { target: 'Send report', scope: 'Approved tab agent-approved', consequence: 'This action may submit a form.' },
    });
    expect(pages.performed).toHaveLength(0);
    expect(await engine.execute({ type: 'respondApproval', decision: 'approve' })).toEqual({ ok: true, data: 'visible page content' });
    expect(pages.performed).toHaveLength(1);
  });

  it('reports a rejected critical action as not performed', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    pages.inspection = { credential: false, consequential: 'This action may send a message.', target: 'Send' };
    await agentAct(engine, { type: 'click', selector: '#send' });
    expect(await engine.execute({ type: 'respondApproval', decision: 'reject' })).toEqual({
      ok: false, message: 'Browser action rejected by the user.',
    });
    expect(pages.performed).toHaveLength(0);
  });

  it('stores captured rendered content without exposing another tab', async () => {
    const { engine, captured } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', mode: 'mixed', tabIds: ['approved'] });
    await agentAct(engine, { type: 'captureTranscript' });
    expect(captured).toHaveBeenCalledWith('agent-approved', 'visible page content');
    expect(engine.getSnapshot().log.at(-1)).toMatchObject({ action: 'Read visible transcript', outcome: 'completed' });
  });

  it('restores interrupted Agent Tabs as user-controlled without resuming', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-agent-restore-'));
    const store = new BrowserAgentStateStore(directory);
    const now = new Date().toISOString();
    await store.save({
      id: 'space-restored', taskId: 'task-restored', name: 'Restored research', mode: 'mixed', owner: 'agent', status: 'agent-controlling',
      tabIds: ['agent-approved'], contextTabIds: ['agent-approved'], explorationTabIds: [], activeTabId: 'agent-approved', createdAt: now, updatedAt: now, kept: false,
    });
    const pages = new FakePages();
    pages.tabs.add('agent-approved');
    const engine = new BrowserAgentEngine(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } },
      pages,
      undefined,
      store,
    );
    await engine.restore();
    expect(engine.getSnapshot()).toMatchObject({
      state: 'paused', taskId: 'task-restored', taskSpace: { owner: 'user', status: 'user-controlling' },
    });
    expect((await agentAct(engine, { type: 'read' })).message).toMatch(/resume/i);
    expect(pages.performed).toHaveLength(0);
  });
});
