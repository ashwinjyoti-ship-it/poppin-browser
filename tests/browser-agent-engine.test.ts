// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { BrowserAgentEngine, type BrowserAgentPageController } from '../src/main/browser/browser-agent-engine';
import type { BrowserAgentAction } from '../src/shared/browser-agent';

class FakePages implements BrowserAgentPageController {
  tabs = new Set(['approved', 'other']);
  activated: string[] = [];
  performed: Array<{ tabId: string; action: BrowserAgentAction }> = [];
  inspection = { credential: false, consequential: null as string | null, target: 'visible target' };

  hasTab(tabId: string) { return this.tabs.has(tabId); }
  activateTabForAgent(tabId: string) { this.activated.push(tabId); return this.tabs.has(tabId); }
  async inspectAction() { return this.inspection; }
  async performAction(tabId: string, action: BrowserAgentAction) { this.performed.push({ tabId, action }); return 'visible page content'; }
}

function setup() {
  const pages = new FakePages();
  const send = vi.fn();
  const captured = vi.fn();
  const engine = new BrowserAgentEngine({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }, pages, captured);
  return { engine, pages, send, captured };
}

describe('BrowserAgentEngine', () => {
  it('limits every action to explicitly approved tabs and revokes access on stop', async () => {
    const { engine, pages } = setup();
    expect(await engine.execute({ type: 'start', taskId: 'task-1', tabIds: ['approved'] })).toEqual({ ok: true });
    const denied = await engine.execute({ type: 'act', tabId: 'other', action: { type: 'read' } });
    expect(denied).toMatchObject({ ok: false, message: expect.stringMatching(/not approved/i) });
    expect(pages.performed).toHaveLength(0);
    expect(await engine.execute({ type: 'stop' })).toEqual({ ok: true });
    expect(engine.getSnapshot()).toMatchObject({ state: 'stopped', allowedTabIds: [], activeTabId: null });
  });

  it('supports pause, explicit resume, and immediate user takeover', async () => {
    const { engine } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', tabIds: ['approved'] });
    expect(await engine.execute({ type: 'takeOver' })).toEqual({ ok: true });
    expect(engine.getSnapshot().state).toBe('paused');
    expect((await engine.execute({ type: 'act', tabId: 'approved', action: { type: 'scroll', deltaY: 500 } })).ok).toBe(false);
    expect(await engine.execute({ type: 'resume' })).toEqual({ ok: true });
    expect((await engine.execute({ type: 'act', tabId: 'approved', action: { type: 'scroll', deltaY: 500 } })).ok).toBe(true);
  });

  it('never operates credential fields or accepts credential-like typing', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', tabIds: ['approved'] });
    pages.inspection = { credential: true, consequential: null, target: 'password input' };
    expect((await engine.execute({ type: 'act', tabId: 'approved', action: { type: 'click', selector: '#password' } })).message).toMatch(/never reads/i);
    expect((await engine.execute({ type: 'act', tabId: 'approved', action: { type: 'type', selector: '#field', text: 'one-time verification code' } })).message).toMatch(/never types/i);
    expect(pages.performed).toHaveLength(0);
  });

  it('pauses consequential actions and performs them only after exact approval', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', tabIds: ['approved'] });
    pages.inspection = { credential: false, consequential: 'This action may submit a form.', target: 'Send report' };
    const requested = await engine.execute({ type: 'act', tabId: 'approved', action: { type: 'click', selector: '#send' } });
    expect(requested).toEqual({ ok: false, message: 'Approval required.' });
    expect(engine.getSnapshot()).toMatchObject({
      state: 'needs-approval',
      pendingApproval: { target: 'Send report', scope: 'Approved tab approved', consequence: 'This action may submit a form.' },
    });
    expect(pages.performed).toHaveLength(0);
    expect(await engine.execute({ type: 'respondApproval', decision: 'approve' })).toEqual({ ok: true, data: 'visible page content' });
    expect(pages.performed).toHaveLength(1);
  });

  it('reports a rejected critical action as not performed', async () => {
    const { engine, pages } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', tabIds: ['approved'] });
    pages.inspection = { credential: false, consequential: 'This action may send a message.', target: 'Send' };
    await engine.execute({ type: 'act', tabId: 'approved', action: { type: 'click', selector: '#send' } });
    expect(await engine.execute({ type: 'respondApproval', decision: 'reject' })).toEqual({
      ok: false, message: 'Browser action rejected by the user.',
    });
    expect(pages.performed).toHaveLength(0);
  });

  it('stores captured rendered content without exposing another tab', async () => {
    const { engine, captured } = setup();
    await engine.execute({ type: 'start', taskId: 'task-1', tabIds: ['approved'] });
    await engine.execute({ type: 'act', tabId: 'approved', action: { type: 'captureTranscript' } });
    expect(captured).toHaveBeenCalledWith('approved', 'visible page content');
    expect(engine.getSnapshot().log.at(-1)).toMatchObject({ action: 'Read visible transcript', outcome: 'completed' });
  });
});
