// @vitest-environment node

import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import type { CodexAppServer } from '../src/main/codex/codex-app-server';
import { CodexAppServerAdapter } from '../src/main/agent/codex-app-server-adapter';
import { AgentNotInstalledError, AgentSignedOutError } from '../src/main/agent/agent-errors';
import { AGENT_HARNESSES, createAgentAdapter, DEFAULT_AGENT_HARNESS_ID, describeAgent, isAgentHarnessId } from '../src/main/agent/agent-registry';
import type { AgentEvent, AgentRequestEvent } from '../src/main/agent/agent-adapter';

class FakeCodexServer extends EventEmitter {
  account: unknown = { type: 'chatgpt' as const, email: 'tester@example.com', planType: 'plus' };
  readonly responses: Array<{ id: number | string; result: unknown }> = [];
  readonly rejections: Array<{ id: number | string; message: string }> = [];
  readonly startedThreads: Array<{ dynamicTools: unknown[] | null }> = [];
  injected: unknown[] = [];
  resumeTurns: unknown[] = [];
  turnCount = 0;

  async connect() {}
  async getAccount() { return { account: this.account, requiresOpenaiAuth: true }; }
  async listModels() {
    return [
      { id: 'r1', model: 'gpt-test', displayName: 'GPT Test', description: 'Test', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }], defaultReasoningEffort: 'high', isDefault: true },
      { id: 'r2', model: 'gpt-hidden', displayName: 'Hidden', description: '', hidden: true, supportedReasoningEfforts: [], defaultReasoningEffort: 'low', isDefault: false },
    ];
  }
  async startThread(params: { dynamicTools?: unknown[] | null }) {
    this.startedThreads.push({ dynamicTools: params.dynamicTools ?? null });
    return { id: `thread-${this.startedThreads.length}`, sessionId: 's', preview: '', ephemeral: false };
  }
  async resumeThread() { return { id: 'thread-1', sessionId: 's', preview: '', ephemeral: false, turns: this.resumeTurns }; }
  async injectThreadItems(_threadId: string, items: unknown[]) { this.injected = items; }
  async startTurn() { this.turnCount += 1; return { id: `turn-${this.turnCount}`, status: 'inProgress' as const, error: null }; }
  async interruptTurn() {}
  respond(id: number | string, result: unknown) { this.responses.push({ id, result }); }
  rejectRequest(id: number | string, message: string) { this.rejections.push({ id, message }); }
  async close() {}
}

function setup() {
  const server = new FakeCodexServer();
  const adapter = new CodexAppServerAdapter({
    locateCodex: async () => ({ executable: '/fake/codex', args: [] }),
    createServer: () => server as unknown as CodexAppServer,
  });
  const events: AgentEvent[] = [];
  const requests: AgentRequestEvent[] = [];
  adapter.on('event', (event) => events.push(event));
  adapter.on('request', (request) => requests.push(request));
  return { adapter, server, events, requests };
}

describe('agent registry', () => {
  it('defaults to Codex and lists every selectable harness', () => {
    expect(DEFAULT_AGENT_HARNESS_ID).toBe('codex-app-server');
    expect(AGENT_HARNESSES.map((descriptor) => descriptor.id)).toEqual([
      'codex-app-server',
      'codex-acp',
      'claude-code',
      'cursor-acp',
    ]);
    expect(describeAgent('codex-acp').transport).toBe('acp');
    expect(describeAgent('claude-code').transport).toBe('acp');
    expect(describeAgent('cursor-acp').transport).toBe('acp');
    expect(isAgentHarnessId('codex-acp')).toBe(true);
    expect(isAgentHarnessId('claude-code')).toBe(true);
    expect(isAgentHarnessId('cursor-acp')).toBe(true);
    expect(isAgentHarnessId('gemini-cli')).toBe(false);
  });

  it('builds the transport that matches the selected harness', () => {
    expect(createAgentAdapter('codex-app-server').descriptor.transport).toBe('codex-app-server');
    expect(createAgentAdapter('codex-acp').descriptor.transport).toBe('acp');
    expect(createAgentAdapter('claude-code').descriptor.id).toBe('claude-code');
    expect(createAgentAdapter('cursor-acp').descriptor.id).toBe('cursor-acp');
  });
});

describe('CodexAppServerAdapter', () => {
  it('surfaces install and sign-in problems as distinct errors', async () => {
    await expect(new CodexAppServerAdapter({ locateCodex: async () => null }).connect())
      .rejects.toBeInstanceOf(AgentNotInstalledError);

    const { adapter, server } = setup();
    server.account = null;
    await expect(adapter.connect()).rejects.toBeInstanceOf(AgentSignedOutError);
  });

  it('reports Codex capabilities and hides hidden models', async () => {
    const { adapter } = setup();
    const info = await adapter.connect();
    expect(info.accountLabel).toBe('tester@example.com');
    expect(info.models.map((model) => model.id)).toEqual(['gpt-test']);
    expect(info.controls).toEqual({ model: true, reasoning: true });
    expect(info.capabilities).toEqual({ clientTools: true, resumeSession: true });
  });

  it('normalizes Codex notifications into agent events for the active turn only', async () => {
    const { adapter, server, events } = setup();
    await adapter.connect();
    await adapter.createSession({ cwd: '/work', model: 'gpt-test', instructions: 'do', tools: [] });
    await adapter.prompt({ sessionId: 'thread-1', prompt: 'hi', cwd: '/work', model: 'gpt-test', reasoningEffort: 'high' });

    server.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'i1', delta: 'chunk' } });
    server.emit('notification', { method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'c1', type: 'commandExecution', command: 'npm test', aggregatedOutput: '', status: 'running' } } });
    // A notification from a stale turn must never drive the active task.
    server.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-9', itemId: 'i9', delta: 'stale' } });
    server.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-1', turnId: 'turn-1', turn: { id: 'turn-1', status: 'completed' } } });

    expect(events).toEqual([
      { type: 'messageDelta', itemId: 'i1', delta: 'chunk' },
      { type: 'activity', activity: { id: 'c1', kind: 'command', title: 'npm test', detail: '', status: 'running' } },
      { type: 'turnEnded', status: 'completed', error: null },
    ]);
  });

  it('normalizes approvals and answers them with the Codex permission profile', async () => {
    const { adapter, server, requests } = setup();
    await adapter.connect();
    await adapter.createSession({ cwd: '/work', model: 'gpt-test', instructions: 'do', tools: [] });
    await adapter.prompt({ sessionId: 'thread-1', prompt: 'hi', cwd: '/work', model: 'gpt-test', reasoningEffort: 'high' });

    server.emit('request', {
      id: 4,
      method: 'item/permissions/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', permissions: { network: true }, reason: 'needs network' },
    });
    expect(requests[0]).toMatchObject({ type: 'approval', kind: 'permissions', requestId: 4, reason: 'needs network' });

    adapter.respondApproval(4, 'accept');
    expect(server.responses[0]).toEqual({ id: 4, result: { permissions: { network: true }, scope: 'turn' } });
  });

  it('replays the conversation into a new thread when capability tools must be attached', async () => {
    const { adapter, server } = setup();
    await adapter.connect();
    await adapter.createSession({ cwd: '/work', model: 'gpt-test', instructions: 'do', tools: [] });

    const resumed = await adapter.resumeSession('thread-1', {
      cwd: '/work',
      model: 'gpt-test',
      instructions: 'do',
      tools: [{ name: 'poppin_browser_action', description: 'browse', inputSchema: { type: 'object' } }],
      fallbackHistory: [{ role: 'user', text: 'USER REQUEST\nfind drives' }, { role: 'assistant', text: 'earlier answer' }],
      requiresTools: true,
      toolsAlreadyAttached: false,
    });

    expect(resumed.toolsAttached).toBe(true);
    expect(resumed.session.id).toBe('thread-2');
    expect(server.startedThreads.at(-1)?.dynamicTools).toEqual([
      { type: 'function', name: 'poppin_browser_action', description: 'browse', inputSchema: { type: 'object' } },
    ]);
    expect(server.injected).toHaveLength(2);
  });

  it('keeps the existing thread when the tools are already attached', async () => {
    const { adapter, server } = setup();
    await adapter.connect();
    await adapter.createSession({
      cwd: '/work', model: 'gpt-test', instructions: 'do',
      tools: [{ name: 'poppin_browser_action', description: 'browse', inputSchema: { type: 'object' } }],
    });
    const resumed = await adapter.resumeSession('thread-1', {
      cwd: '/work', model: 'gpt-test', instructions: 'do',
      tools: [{ name: 'poppin_browser_action', description: 'browse', inputSchema: { type: 'object' } }],
      fallbackHistory: [],
      requiresTools: true,
      toolsAlreadyAttached: true,
    });
    expect(resumed).toEqual({ session: { id: 'thread-1' }, toolsAttached: true });
    expect(server.startedThreads).toHaveLength(1);
  });
});
