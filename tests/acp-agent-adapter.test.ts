// @vitest-environment node

import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AcpConnection } from '../src/main/acp/acp-connection';
import { ACP_METHODS, ACP_PROTOCOL_VERSION } from '../src/main/acp/acp-protocol';
import { AcpAgentAdapter } from '../src/main/agent/acp-agent-adapter';
import { AgentNotInstalledError } from '../src/main/agent/agent-errors';
import type { AgentEvent, AgentRequestEvent } from '../src/main/agent/agent-adapter';

interface Responded {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

class FakeAcpConnection extends EventEmitter {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly notifications: Array<{ method: string; params: unknown }> = [];
  readonly responses: Responded[] = [];
  started = false;
  closed = false;
  /** Resolvers for `session/prompt`, which only settles at the end of a turn. */
  promptResolvers: Array<(value: unknown) => void> = [];

  initializeResponse: unknown = {
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
    agentInfo: { name: 'codex-acp', version: '1.1.14' },
  };

  sessionNewResponse: unknown = { sessionId: 'acp-session-1' };

  start() { this.started = true; }
  get connected() { return this.started && !this.closed; }
  get stderrTail() { return ''; }

  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === ACP_METHODS.initialize) return this.initializeResponse;
    if (method === ACP_METHODS.authenticate) return {};
    if (method === ACP_METHODS.sessionNew) return this.sessionNewResponse;
    if (method === ACP_METHODS.sessionLoad) return {};
    if (method === ACP_METHODS.sessionSetConfigOption) {
      return { configOptions: (this.sessionNewResponse as { configOptions?: unknown }).configOptions ?? [] };
    }
    if (method === ACP_METHODS.sessionPrompt) {
      return new Promise((resolve) => this.promptResolvers.push(resolve));
    }
    return {};
  }

  notify(method: string, params?: unknown) { this.notifications.push({ method, params: params ?? null }); }
  respond(id: number | string, result: unknown) { this.responses.push({ id, result }); }
  respondError(id: number | string, code: number, message: string) { this.responses.push({ id, error: { code, message } }); }
  async close() { this.closed = true; }

  update(update: unknown, sessionId = 'acp-session-1') {
    this.emit('notification', { method: ACP_METHODS.sessionUpdate, params: { sessionId, update } });
  }
}

function setup(options: {
  workspaceRoot?: () => string | null;
  mcpBridgeAvailable?: () => boolean;
  resolveMcpServers?: (tools: import('../src/main/agent/agent-adapter').AgentToolSpec[]) => Promise<import('../src/main/acp/acp-protocol').AcpMcpServerStdio[]>;
} = {}) {
  const connection = new FakeAcpConnection();
  const adapter = new AcpAgentAdapter({
    locate: async () => ({ executable: '/fake/codex-acp', args: [] }),
    createConnection: () => connection as unknown as AcpConnection,
    ...options,
  });
  const events: AgentEvent[] = [];
  const requests: AgentRequestEvent[] = [];
  adapter.on('event', (event) => events.push(event));
  adapter.on('request', (request) => requests.push(request));
  return { adapter, connection, events, requests };
}

describe('AcpAgentAdapter', () => {
  it('reports a missing ACP adapter as not installed rather than failing obscurely', async () => {
    const adapter = new AcpAgentAdapter({ locate: async () => null });
    await expect(adapter.connect()).rejects.toBeInstanceOf(AgentNotInstalledError);
  });

  it('advertises only the client capabilities Poppin actually serves', async () => {
    const { adapter, connection } = setup();
    const info = await adapter.connect();
    const initialize = connection.requests.find((entry) => entry.method === ACP_METHODS.initialize);
    expect(initialize?.params).toMatchObject({
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'poppin-browser' },
    });
    // Without session configOptions, Poppin keeps a neutral default and hides selectors.
    expect(info.controls).toEqual({ model: false, reasoning: false });
    expect(info.models).toHaveLength(1);
    // Without an MCP bridge, Poppin must not promise Browser/Tandem tools.
    expect(info.capabilities.clientTools).toBe(false);
    expect(info.capabilities.resumeSession).toBe(true);
  });

  it('authenticates when required and surfaces ACP model configOptions', async () => {
    const { adapter, connection } = setup();
    connection.initializeResponse = {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: 'cursor-agent', title: 'Cursor Agent' },
      authMethods: [{ id: 'cursor_login', name: 'Cursor Login' }],
    };
    connection.sessionNewResponse = {
      sessionId: 'probe-session',
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'default[]',
        options: [
          { value: 'default[]', name: 'Auto' },
          { value: 'grok-4.5[effort=high,fast=true]', name: 'grok-4.5' },
          { value: 'composer-2.5[fast=true]', name: 'composer-2.5' },
        ],
      }],
    };

    const info = await adapter.connect();
    expect(connection.requests.some((entry) => entry.method === ACP_METHODS.authenticate)).toBe(true);
    expect(info.controls).toEqual({ model: true, reasoning: false });
    expect(info.models.map((model) => model.name)).toEqual(['Auto', 'grok-4.5', 'composer-2.5']);

    await adapter.createSession({
      cwd: '/work',
      model: 'grok-4.5[effort=high,fast=true]',
      instructions: '',
      tools: [],
    });
    expect(connection.requests.some((entry) => (
      entry.method === ACP_METHODS.sessionSetConfigOption
      && (entry.params as { value?: string }).value === 'grok-4.5[effort=high,fast=true]'
    ))).toBe(true);
  });

  it('advertises clientTools and provisions mcpServers when the MCP bridge is available', async () => {
    const { adapter, connection } = setup({
      mcpBridgeAvailable: () => true,
      resolveMcpServers: async () => [{
        name: 'poppin',
        command: 'node',
        args: ['/tmp/poppin-mcp-server.mjs'],
        env: [
          { name: 'POPPIN_CAPABILITY_SOCKET', value: '/tmp/poppin.sock' },
          { name: 'POPPIN_CAPABILITY_TOKEN', value: 'token' },
        ],
      }],
    });
    const info = await adapter.connect();
    expect(info.capabilities.clientTools).toBe(true);

    await adapter.createSession({
      cwd: '/work',
      model: 'agent-default',
      instructions: 'BE CAREFUL',
      tools: [{ name: 'tandem', description: 'Tandem', inputSchema: { type: 'object' } }],
    });
    const taskSession = connection.requests.filter((entry) => entry.method === ACP_METHODS.sessionNew).at(-1);
    expect(taskSession?.params).toMatchObject({
      cwd: '/work',
      mcpServers: [{ name: 'poppin', command: expect.any(String) }],
    });
  });

  it('creates a session and sends instructions with the first prompt', async () => {
    const { adapter, connection } = setup();
    await adapter.connect();
    const session = await adapter.createSession({ cwd: '/work', model: 'agent-default', instructions: 'BE CAREFUL', tools: [] });
    expect(session.id).toBe('acp-session-1');
    expect(connection.requests.filter((entry) => entry.method === ACP_METHODS.sessionNew).at(-1)?.params)
      .toEqual({ cwd: '/work', mcpServers: [] });

    await adapter.prompt({ sessionId: session.id, prompt: 'Research prices', cwd: '/work', model: 'agent-default', reasoningEffort: 'agent-default' });
    const prompt = connection.requests.find((entry) => entry.method === ACP_METHODS.sessionPrompt);
    expect(prompt?.params).toEqual({
      sessionId: 'acp-session-1',
      prompt: [{ type: 'text', text: 'BE CAREFUL' }, { type: 'text', text: 'Research prices' }],
    });
  });

  it('streams session/update notifications into normalized activity', async () => {
    const { adapter, connection, events } = setup();
    await adapter.connect();
    await adapter.createSession({ cwd: '/work', model: 'agent-default', instructions: '', tools: [] });

    connection.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' }, messageId: 'm1' });
    connection.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' }, messageId: 'm1' });
    connection.update({ sessionUpdate: 'plan', entries: [{ content: 'Search', priority: 'high', status: 'in_progress' }] });
    connection.update({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'npm test',
      kind: 'execute',
      status: 'in_progress',
      content: [{ type: 'content', content: { type: 'text', text: 'running' } }],
    });

    expect(events.filter((event) => event.type === 'messageDelta')).toEqual([
      { type: 'messageDelta', itemId: 'm1', delta: 'Hello ' },
      { type: 'messageDelta', itemId: 'm1', delta: 'world' },
    ]);
    const plan = events.find((event) => event.type === 'activity' && event.activity.kind === 'plan');
    expect(plan).toMatchObject({ activity: { detail: '→ Search' } });
    const command = events.find((event) => event.type === 'activity' && event.activity.kind === 'command');
    expect(command).toMatchObject({ activity: { title: 'npm test', status: 'running', detail: 'running' } });
  });

  it('ignores session updates that belong to a different session', async () => {
    const { adapter, connection, events } = setup();
    await adapter.connect();
    await adapter.createSession({ cwd: '/work', model: 'agent-default', instructions: '', tools: [] });
    connection.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'stray' } }, 'other-session');
    expect(events.filter((event) => event.type === 'messageDelta')).toHaveLength(0);
  });

  it('maps stop reasons onto Poppin turn outcomes', async () => {
    const { adapter, connection, events } = setup();
    await adapter.connect();
    await adapter.createSession({ cwd: '/work', model: 'agent-default', instructions: '', tools: [] });
    await adapter.prompt({ sessionId: 'acp-session-1', prompt: 'go', cwd: '/work', model: 'agent-default', reasoningEffort: 'agent-default' });
    connection.promptResolvers[0]?.({ stopReason: 'refusal' });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'turnEnded')).toBe(true));
    expect(events.at(-1)).toMatchObject({ type: 'turnEnded', status: 'failed' });
  });

  it('cancels through session/cancel', async () => {
    const { adapter, connection } = setup();
    await adapter.connect();
    await adapter.createSession({ cwd: '/work', model: 'agent-default', instructions: '', tools: [] });
    await adapter.cancel('acp-session-1', 'acp-turn-1');
    expect(connection.notifications).toContainEqual({ method: ACP_METHODS.sessionCancel, params: { sessionId: 'acp-session-1' } });
  });

  it('answers session/request_permission with the option kind Poppin decided on', async () => {
    const { adapter, connection, requests } = setup();
    await adapter.connect();
    await adapter.createSession({ cwd: '/work', model: 'agent-default', instructions: '', tools: [] });
    connection.emit('request', {
      id: 7,
      method: ACP_METHODS.sessionRequestPermission,
      params: {
        sessionId: 'acp-session-1',
        toolCall: { toolCallId: 't2', title: 'Delete build output', kind: 'delete' },
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });
    expect(requests[0]).toMatchObject({ type: 'approval', requestId: 7, kind: 'files', title: 'Delete build output' });

    adapter.respondApproval(7, 'accept');
    expect(connection.responses[0]).toEqual({ id: 7, result: { outcome: { outcome: 'selected', optionId: 'allow' } } });
  });

  it('refuses client methods it did not advertise', async () => {
    const { adapter, connection } = setup();
    await adapter.connect();
    connection.emit('request', { id: 9, method: 'terminal/create', params: {} });
    expect(connection.responses[0]?.error?.message).toContain('terminal/create');
  });

  it('serves fs/read_text_file and fs/write_text_file inside the workspace only', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'poppin-acp-fs-'));
    await writeFile(path.join(root, 'notes.md'), 'line one\nline two\n');
    const { adapter, connection } = setup({ workspaceRoot: () => root });
    await adapter.connect();
    await adapter.createSession({ cwd: root, model: 'agent-default', instructions: '', tools: [] });

    connection.emit('request', { id: 1, method: ACP_METHODS.fsReadTextFile, params: { sessionId: 'acp-session-1', path: 'notes.md' } });
    await vi.waitFor(() => expect(connection.responses).toHaveLength(1));
    expect(connection.responses[0]).toEqual({ id: 1, result: { content: 'line one\nline two\n' } });

    connection.emit('request', { id: 2, method: ACP_METHODS.fsWriteTextFile, params: { sessionId: 'acp-session-1', path: 'out.md', content: 'written' } });
    await vi.waitFor(() => expect(connection.responses).toHaveLength(2));
    expect(await readFile(path.join(root, 'out.md'), 'utf8')).toBe('written');

    connection.emit('request', { id: 3, method: ACP_METHODS.fsReadTextFile, params: { sessionId: 'acp-session-1', path: '../escape.txt' } });
    await vi.waitFor(() => expect(connection.responses).toHaveLength(3));
    expect(connection.responses[2]?.error?.message).toContain('inside the connected project');
  });
});
