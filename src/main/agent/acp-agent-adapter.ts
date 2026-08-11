import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentHarnessDescriptor, AgentModelOption } from '../../shared/agent';
import { AcpConnection, isRecord, type AcpLaunch } from '../acp/acp-connection';
import { locateCodexAcp } from '../acp/acp-locator';
import {
  ACP_ERROR,
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  contentBlockText,
  textBlock,
  type AcpAgentCapabilities,
  type AcpInitializeResponse,
  type AcpMcpServerStdio,
  type AcpNewSessionResponse,
  type AcpPermissionOption,
  type AcpPlanEntry,
  type AcpPromptResponse,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpSessionNotification,
  type AcpSetConfigOptionResponse,
  type AcpToolCall,
  type AcpWriteTextFileRequest,
} from '../acp/acp-protocol';
import { discoverControlsFromSession } from '../acp/acp-session-config';
import { AgentNotInstalledError, AgentSignedOutError } from './agent-errors';
import type {
  AgentAdapter,
  AgentAdapterEvents,
  AgentActivity,
  AgentApprovalDecision,
  AgentApprovalKind,
  AgentConnectionInfo,
  AgentPromptRequest,
  AgentRequestId,
  AgentResumeRequest,
  AgentResumeResult,
  AgentSession,
  AgentSessionRequest,
  AgentToolResult,
  AgentToolSpec,
  AgentTurn,
} from './agent-adapter';

export const CODEX_ACP_DESCRIPTOR: AgentHarnessDescriptor = {
  id: 'codex-acp',
  name: 'Codex (ACP)',
  transport: 'acp',
  availability: 'preview',
  summary: 'Codex over the Agent Client Protocol. The portable path for any ACP-compatible harness.',
};

export const CLAUDE_CODE_DESCRIPTOR: AgentHarnessDescriptor = {
  id: 'claude-code',
  name: 'Claude Code',
  transport: 'acp',
  availability: 'preview',
  summary: 'Claude Code over ACP (`claude-agent-acp`). Browser and Tandem reach it through Poppin MCP.',
};

export const CURSOR_ACP_DESCRIPTOR: AgentHarnessDescriptor = {
  id: 'cursor-acp',
  name: 'Cursor Agent',
  transport: 'acp',
  availability: 'preview',
  summary: 'Cursor Agent over ACP (`agent acp`). Browser and Tandem reach it through Poppin MCP.',
};

/**
 * Fallback model entry when an ACP agent does not publish configOptions/models.
 * Prefer real session configOptions when the agent provides them.
 */
const AGENT_DEFAULT_MODEL_ID = 'agent-default';
const AGENT_DEFAULT_EFFORT = 'agent-default';

export interface AcpAgentAdapterOptions {
  descriptor?: AgentHarnessDescriptor;
  locate?: () => Promise<AcpLaunch | null>;
  createConnection?: (launch: AcpLaunch) => AcpConnection;
  /** Absolute path the agent may read and write through `fs/*`. */
  workspaceRoot?: () => string | null;
  /** True when Poppin can launch its MCP capability bridge for this process. */
  mcpBridgeAvailable?: () => boolean;
  /**
   * Builds `session/new` mcpServers for the given Poppin capability tools.
   * Returns [] when tools cannot be provisioned; Poppin then keeps clientTools honest.
   */
  resolveMcpServers?: (tools: AgentToolSpec[]) => Promise<AcpMcpServerStdio[]>;
}

/**
 * Agent Client Protocol implementation of Poppin's agent boundary.
 *
 * Poppin is the ACP *client*: it advertises client capabilities, owns the
 * session, streams `session/update` into task progress, answers
 * `session/request_permission` through Poppin's approval UI, and serves
 * `fs/read_text_file` / `fs/write_text_file` inside the connected project.
 */
export class AcpAgentAdapter extends EventEmitter<AgentAdapterEvents> implements AgentAdapter {
  readonly descriptor: AgentHarnessDescriptor;

  private connection: AcpConnection | null = null;
  private agentCapabilities: AcpAgentCapabilities = {};
  private agentLabel: string | null = null;
  private protocolVersion = ACP_PROTOCOL_VERSION;
  private activeSessionId = '';
  private activeTurnId = '';
  private turnSequence = 0;
  private sessionCwd = '';
  private readonly permissionOptions = new Map<string, AcpPermissionOption[]>();
  private readonly toolActivityDetail = new Map<string, string>();
  private pendingHistoryPreamble = '';
  private modelConfigId: string | null = null;
  private thoughtConfigId: string | null = null;
  private discoveredModels: AgentModelOption[] = [];
  private discoveredControls = { model: false, reasoning: false };

  constructor(private readonly options: AcpAgentAdapterOptions = {}) {
    super();
    this.descriptor = options.descriptor ?? CODEX_ACP_DESCRIPTOR;
  }

  async connect(): Promise<AgentConnectionInfo> {
    await this.close();
    const launch = await (this.options.locate ?? locateCodexAcp)();
    if (!launch) {
      throw new AgentNotInstalledError(
        `${this.descriptor.name} is not installed. Install its ACP adapter (Codex: @agentclientprotocol/codex-acp, Claude: @agentclientprotocol/claude-agent-acp, Cursor: \`agent\` CLI) or set the matching POPPIN_*_ACP_COMMAND, then reconnect.`,
      );
    }
    const connection = this.options.createConnection?.(launch) ?? new AcpConnection(launch);
    connection.on('notification', (notification) => this.handleNotification(notification));
    connection.on('request', (request) => this.handleRequest(request));
    connection.on('exit', (error) => {
      this.connection = null;
      this.emit('exit', error);
    });
    connection.start();
    this.connection = connection;

    const response = await connection.request<AcpInitializeResponse>(ACP_METHODS.initialize, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        // Poppin serves project reads and writes itself; it does not expose a
        // terminal to the agent, so it must advertise `terminal: false`.
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
      clientInfo: { name: 'poppin-browser', title: 'Poppin Browser', version: '0.1.0' },
    });
    this.protocolVersion = typeof response.protocolVersion === 'number' ? response.protocolVersion : ACP_PROTOCOL_VERSION;
    this.agentCapabilities = response.agentCapabilities ?? {};
    this.agentLabel = response.agentInfo?.title ?? response.agentInfo?.name ?? null;

    const authMethods = Array.isArray(response.authMethods) ? response.authMethods : [];
    if (authMethods.length > 0) {
      const methodId = authMethods[0]?.id;
      if (!methodId) {
        throw new AgentSignedOutError(`${this.descriptor.name} requires sign-in, but offered no auth method.`);
      }
      try {
        await connection.request(ACP_METHODS.authenticate, { methodId }, 60_000);
      } catch (error) {
        const message = error instanceof Error ? error.message : `Sign in to ${this.descriptor.name} failed.`;
        throw new AgentSignedOutError(`${message} Sign in to the agent (for Cursor: \`agent login\`), then reconnect.`);
      }
    }

    await this.discoverSessionControls(connection);

    return {
      accountLabel: this.agentLabel ? `${this.agentLabel} over ACP` : `${this.descriptor.name} over ACP`,
      models: this.discoveredModels.length > 0
        ? this.discoveredModels
        : [{
            id: AGENT_DEFAULT_MODEL_ID,
            name: `${this.agentLabel ?? this.descriptor.name} default`,
            description: 'The model configured inside the selected ACP agent.',
            reasoningEfforts: [AGENT_DEFAULT_EFFORT],
            defaultReasoningEffort: AGENT_DEFAULT_EFFORT,
            isDefault: true,
          }],
      controls: this.discoveredControls,
      capabilities: {
        // Capability tools reach ACP agents only through Poppin's MCP bridge.
        clientTools: this.options.mcpBridgeAvailable?.() === true,
        resumeSession: this.agentCapabilities.loadSession === true,
      },
      detail: `ACP protocol v${this.protocolVersion}`,
    };
  }

  async createSession(request: AgentSessionRequest): Promise<AgentSession> {
    const connection = this.requireConnection();
    const mcpServers = await this.mcpServersFor(request.tools);
    const response = await connection.request<AcpNewSessionResponse>(
      ACP_METHODS.sessionNew,
      { cwd: request.cwd, mcpServers },
      60_000,
    ).catch((error: unknown) => {
      throw translateSessionError(error, this.descriptor.name);
    });
    this.activeSessionId = response.sessionId;
    this.activeTurnId = '';
    this.sessionCwd = request.cwd;
    this.rememberDiscoveredControls(response);
    // ACP has no developer-instructions field: instructions travel with the first
    // prompt as a text content block.
    this.pendingHistoryPreamble = request.instructions;
    await this.applyModelConfig(response.sessionId, request.model);
    return { id: response.sessionId };
  }

  async resumeSession(sessionId: string, request: AgentResumeRequest): Promise<AgentResumeResult> {
    const connection = this.requireConnection();
    this.sessionCwd = request.cwd;
    const mcpServers = await this.mcpServersFor(request.requiresTools || request.tools.length > 0 ? request.tools : []);
    if (this.agentCapabilities.loadSession === true) {
      await connection.request(ACP_METHODS.sessionLoad, { sessionId, cwd: request.cwd, mcpServers }, 60_000)
        .catch((error: unknown) => {
          throw translateSessionError(error, this.descriptor.name);
        });
      this.activeSessionId = sessionId;
      this.activeTurnId = '';
      return { session: { id: sessionId }, toolsAttached: mcpServers.length > 0 };
    }
    const session = await this.createSession(request);
    this.pendingHistoryPreamble = [
      request.instructions,
      request.fallbackHistory.length
        ? `EARLIER CONVERSATION\n${request.fallbackHistory.map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.text}`).join('\n\n')}`
        : '',
    ].filter(Boolean).join('\n\n');
    return { session, toolsAttached: mcpServers.length > 0 };
  }

  async prompt(request: AgentPromptRequest): Promise<AgentTurn> {
    const connection = this.requireConnection();
    this.activeSessionId = request.sessionId;
    this.turnSequence += 1;
    const turnId = `acp-turn-${this.turnSequence}`;
    this.activeTurnId = turnId;
    const preamble = this.pendingHistoryPreamble;
    this.pendingHistoryPreamble = '';
    const blocks = [...(preamble ? [textBlock(preamble)] : []), textBlock(request.prompt)];

    await this.applyModelConfig(request.sessionId, request.model);
    await this.applyThoughtConfig(request.sessionId, request.reasoningEffort);

    // `session/prompt` resolves only when the whole turn ends, so Poppin tracks
    // it in the background and reports the stop reason as a turn result.
    void connection.request<AcpPromptResponse>(
      ACP_METHODS.sessionPrompt,
      { sessionId: request.sessionId, prompt: blocks },
      24 * 60 * 60 * 1_000,
    ).then(
      (response) => this.finishTurn(turnId, response?.stopReason ?? 'end_turn'),
      (error: unknown) => {
        if (this.activeTurnId !== turnId) return;
        this.activeTurnId = '';
        this.emit('event', {
          type: 'turnEnded',
          status: 'failed',
          error: error instanceof Error ? error.message : 'The ACP agent failed to complete the turn.',
        });
      },
    );
    return { id: turnId };
  }

  async cancel(sessionId: string, turnId: string): Promise<void> {
    // ACP cancels the whole session turn; the client's turn id has no wire form.
    void turnId;
    this.connection?.notify(ACP_METHODS.sessionCancel, { sessionId });
  }

  respondApproval(requestId: AgentRequestId, decision: AgentApprovalDecision): void {
    const key = String(requestId);
    const options = this.permissionOptions.get(key) ?? [];
    this.permissionOptions.delete(key);
    if (decision === 'cancel') {
      this.connection?.respond(requestId, { outcome: { outcome: 'cancelled' } });
      return;
    }
    const wanted = decision === 'accept' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
    const option = wanted.map((kind) => options.find((candidate) => candidate.kind === kind)).find(Boolean);
    if (!option) {
      this.connection?.respond(requestId, { outcome: { outcome: 'cancelled' } });
      return;
    }
    this.connection?.respond(requestId, { outcome: { outcome: 'selected', optionId: option.optionId } });
  }

  respondQuestion(requestId: AgentRequestId, answer: string): void {
    // ACP delivers blocking questions through `elicitation/create`, which Poppin
    // does not advertise yet. Nothing should reach this path.
    void answer;
    this.connection?.respondError(requestId, ACP_ERROR.methodNotFound, 'Poppin does not advertise ACP elicitation.');
  }

  respondTool(requestId: AgentRequestId, result: AgentToolResult): void {
    // Poppin capability tools are served through the MCP bridge, not ACP client
    // requests. Nothing should call this path on an ACP harness.
    void result;
    this.connection?.respondError(
      requestId,
      ACP_ERROR.methodNotFound,
      'Poppin capability tools are exposed to ACP agents through MCP, not ACP client tool requests.',
    );
  }

  private async mcpServersFor(tools: AgentToolSpec[]): Promise<AcpMcpServerStdio[]> {
    if (!tools.length || !this.options.resolveMcpServers) return [];
    return this.options.resolveMcpServers(tools);
  }

  rejectRequest(requestId: AgentRequestId, message: string): void {
    this.connection?.respondError(requestId, ACP_ERROR.invalidRequest, message);
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.activeSessionId = '';
    this.activeTurnId = '';
    this.sessionCwd = '';
    this.modelConfigId = null;
    this.thoughtConfigId = null;
    this.discoveredModels = [];
    this.discoveredControls = { model: false, reasoning: false };
    this.permissionOptions.clear();
    this.toolActivityDetail.clear();
    this.pendingHistoryPreamble = '';
    await connection?.close();
  }

  private async discoverSessionControls(connection: AcpConnection): Promise<void> {
    // Probe a throwaway session so the command bar can list real models before
    // the user starts a task. Agents that cannot create a session yet still
    // connect with the neutral default model entry.
    try {
      const probeCwd = this.options.workspaceRoot?.() ?? tmpdir();
      const response = await connection.request<AcpNewSessionResponse>(
        ACP_METHODS.sessionNew,
        { cwd: probeCwd, mcpServers: [] },
        60_000,
      );
      this.rememberDiscoveredControls(response);
    } catch {
      this.discoveredModels = [];
      this.discoveredControls = { model: false, reasoning: false };
      this.modelConfigId = null;
      this.thoughtConfigId = null;
    }
  }

  private rememberDiscoveredControls(response: AcpNewSessionResponse): void {
    const discovered = discoverControlsFromSession(response);
    if (discovered.models.length === 0) return;
    this.discoveredModels = discovered.models;
    this.discoveredControls = discovered.controls;
    this.modelConfigId = discovered.modelConfigId;
    this.thoughtConfigId = discovered.thoughtConfigId;
  }

  private async applyModelConfig(sessionId: string, modelId: string): Promise<void> {
    if (!this.modelConfigId || !modelId || modelId === AGENT_DEFAULT_MODEL_ID) return;
    await this.setConfigOption(sessionId, this.modelConfigId, modelId);
  }

  private async applyThoughtConfig(sessionId: string, effort: string): Promise<void> {
    if (!this.thoughtConfigId || !effort || effort === AGENT_DEFAULT_EFFORT) return;
    await this.setConfigOption(sessionId, this.thoughtConfigId, effort);
  }

  private async setConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    const connection = this.requireConnection();
    try {
      const response = await connection.request<AcpSetConfigOptionResponse>(
        ACP_METHODS.sessionSetConfigOption,
        { sessionId, configId, value },
        30_000,
      );
      if (Array.isArray(response?.configOptions)) {
        this.rememberDiscoveredControls({ sessionId, configOptions: response.configOptions });
      }
    } catch {
      // Some agents accept the session default only; do not fail the turn for that.
    }
  }

  private requireConnection(): AcpConnection {
    if (!this.connection) throw new Error(`${this.descriptor.name} is not connected.`);
    return this.connection;
  }

  private finishTurn(turnId: string, stopReason: AcpPromptResponse['stopReason']): void {
    if (this.activeTurnId !== turnId) return;
    this.activeTurnId = '';
    if (stopReason === 'end_turn') {
      this.emit('event', { type: 'turnEnded', status: 'completed', error: null });
      return;
    }
    if (stopReason === 'cancelled') {
      this.emit('event', { type: 'turnEnded', status: 'interrupted', error: null });
      return;
    }
    this.emit('event', { type: 'turnEnded', status: 'failed', error: stopReasonMessage(stopReason) });
  }

  private handleNotification(notification: { method: string; params: unknown }): void {
    if (notification.method !== ACP_METHODS.sessionUpdate || !isRecord(notification.params)) return;
    const payload = notification.params as unknown as AcpSessionNotification;
    if (this.activeSessionId && payload.sessionId !== this.activeSessionId) return;
    const update = payload.update;
    if (!isRecord(update)) return;
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = contentBlockText(update.content);
        if (text) {
          this.emit('event', {
            type: 'messageDelta',
            itemId: typeof update.messageId === 'string' ? update.messageId : 'agent-message',
            delta: text,
          });
        }
        return;
      }
      case 'agent_thought_chunk': {
        const text = contentBlockText(update.content);
        if (!text) return;
        const id = `thought-${typeof update.messageId === 'string' ? update.messageId : 'current'}`;
        const detail = `${this.toolActivityDetail.get(id) ?? ''}${text}`.slice(-4_000);
        this.toolActivityDetail.set(id, detail);
        this.emit('event', { type: 'activity', activity: { id, kind: 'status', title: 'Reasoning', detail, status: 'running' } });
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const activity = this.activityFromToolCall(update as unknown as AcpToolCall);
        if (activity) this.emit('event', { type: 'activity', activity });
        return;
      }
      case 'plan': {
        const entries = Array.isArray(update.entries) ? (update.entries as AcpPlanEntry[]) : [];
        this.emit('event', {
          type: 'activity',
          activity: { id: 'acp-plan', kind: 'plan', title: 'Plan', detail: renderPlan(entries), status: 'running' },
        });
        return;
      }
      case 'current_mode_update': {
        this.emit('event', {
          type: 'activity',
          activity: {
            id: 'acp-mode',
            kind: 'status',
            title: 'Agent mode changed',
            detail: typeof update.currentModeId === 'string' ? update.currentModeId : '',
            status: 'completed',
          },
        });
        return;
      }
      default:
        return;
    }
  }

  private handleRequest(request: { id: number | string; method: string; params: unknown }): void {
    const params = isRecord(request.params) ? request.params : {};
    switch (request.method) {
      case ACP_METHODS.sessionRequestPermission: {
        const permission = params as unknown as AcpRequestPermissionRequest;
        const options = Array.isArray(permission.options) ? permission.options : [];
        this.permissionOptions.set(String(request.id), options);
        this.emit('request', {
          type: 'approval',
          requestId: request.id,
          kind: approvalKindFor(permission.toolCall),
          title: permission.toolCall?.title || 'The agent needs permission to continue',
          detail: permissionDetail(permission),
          reason: options.length ? options.map((option) => option.name).join(' · ') : null,
        });
        return;
      }
      case ACP_METHODS.fsReadTextFile: {
        void this.readTextFile(request.id, params as unknown as AcpReadTextFileRequest);
        return;
      }
      case ACP_METHODS.fsWriteTextFile: {
        void this.writeTextFile(request.id, params as unknown as AcpWriteTextFileRequest);
        return;
      }
      default:
        this.rejectRequestAsUnsupported(request.id, request.method);
    }
  }

  private rejectRequestAsUnsupported(requestId: number | string, method: string): void {
    this.connection?.respondError(requestId, ACP_ERROR.methodNotFound, `Poppin does not advertise the ${method} client capability.`);
  }

  private async readTextFile(requestId: number | string, params: AcpReadTextFileRequest): Promise<void> {
    const resolved = this.resolveWorkspacePath(params.path);
    if (!resolved) {
      this.connection?.respondError(requestId, ACP_ERROR.invalidParams, 'Poppin only serves files inside the connected project.');
      return;
    }
    try {
      const content = await readFile(resolved, 'utf8');
      const line = typeof params.line === 'number' ? Math.max(1, params.line) : 1;
      const limit = typeof params.limit === 'number' ? Math.max(1, params.limit) : null;
      const lines = content.split('\n');
      const slice = limit === null ? lines.slice(line - 1) : lines.slice(line - 1, line - 1 + limit);
      this.connection?.respond(requestId, { content: slice.join('\n') });
    } catch (error) {
      this.connection?.respondError(requestId, ACP_ERROR.internalError, error instanceof Error ? error.message : 'Poppin could not read that file.');
    }
  }

  private async writeTextFile(requestId: number | string, params: AcpWriteTextFileRequest): Promise<void> {
    const resolved = this.resolveWorkspacePath(params.path);
    if (!resolved) {
      this.connection?.respondError(requestId, ACP_ERROR.invalidParams, 'Poppin only serves files inside the connected project.');
      return;
    }
    try {
      await writeFile(resolved, typeof params.content === 'string' ? params.content : '', 'utf8');
      this.connection?.respond(requestId, {});
    } catch (error) {
      this.connection?.respondError(requestId, ACP_ERROR.internalError, error instanceof Error ? error.message : 'Poppin could not write that file.');
    }
  }

  /** Keeps agent filesystem access inside the session working directory. */
  private resolveWorkspacePath(candidate: unknown): string | null {
    const root = this.options.workspaceRoot?.() ?? this.sessionCwd;
    if (!root || typeof candidate !== 'string' || !candidate) return null;
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, candidate);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return resolved;
  }

  private activityFromToolCall(toolCall: AcpToolCall): AgentActivity | null {
    if (!toolCall.toolCallId) return null;
    const id = `acp-tool-${toolCall.toolCallId}`;
    const detail = toolCallDetail(toolCall) || this.toolActivityDetail.get(id) || '';
    if (detail) this.toolActivityDetail.set(id, detail);
    return {
      id,
      kind: activityKindFor(toolCall.kind),
      title: toolCall.title || 'Agent tool call',
      detail,
      status: activityStatusFor(toolCall.status),
    };
  }
}

function activityKindFor(kind: AcpToolCall['kind']): AgentActivity['kind'] {
  if (kind === 'execute') return 'command';
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'files';
  if (kind === 'think') return 'plan';
  return 'status';
}

function activityStatusFor(status: AcpToolCall['status']): string {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'in_progress') return 'running';
  return 'pending';
}

function toolCallDetail(toolCall: AcpToolCall): string {
  const parts: string[] = [];
  for (const item of toolCall.content ?? []) {
    if (item.type === 'content') parts.push(contentBlockText(item.content));
    else if (item.type === 'diff') parts.push(`${item.path ?? 'file'}: ${(item.newText ?? '').split('\n').length} line(s) written`);
    else if (item.type === 'terminal') parts.push(`terminal ${item.terminalId ?? ''}`.trim());
  }
  return parts.filter(Boolean).join('\n').slice(-4_000);
}

function approvalKindFor(toolCall: AcpToolCall | undefined): AgentApprovalKind {
  if (toolCall?.kind === 'execute') return 'command';
  if (toolCall?.kind === 'edit' || toolCall?.kind === 'delete' || toolCall?.kind === 'move') return 'files';
  return 'permissions';
}

function permissionDetail(permission: AcpRequestPermissionRequest): string {
  const detail = toolCallDetail(permission.toolCall ?? { toolCallId: '' });
  const raw = permission.toolCall?.rawInput;
  if (detail) return detail;
  if (raw === undefined) return permission.toolCall?.title ?? 'The agent requested permission.';
  try {
    return JSON.stringify(raw, null, 2).slice(0, 8_000);
  } catch {
    return permission.toolCall?.title ?? 'The agent requested permission.';
  }
}

function renderPlan(entries: AcpPlanEntry[]): string {
  return entries
    .map((entry) => `${entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '→' : '·'} ${entry.content}`)
    .join('\n')
    .slice(0, 4_000);
}

function stopReasonMessage(stopReason: AcpPromptResponse['stopReason']): string {
  switch (stopReason) {
    case 'max_tokens':
      return 'The agent reached its maximum token budget for this turn.';
    case 'max_turn_requests':
      return 'The agent reached its maximum number of model requests for this turn.';
    case 'refusal':
      return 'The agent refused to continue with this request.';
    default:
      return 'The agent stopped before finishing the turn.';
  }
}

function translateSessionError(error: unknown, harnessName = 'The ACP agent'): Error {
  const message = error instanceof Error ? error.message : `${harnessName} rejected the session.`;
  if (/auth/i.test(message)) return new AgentSignedOutError(`${message} Sign in to the agent, then reconnect.`);
  if (/Missing optional dependency|codex-darwin|reinstall Codex/i.test(message)) {
    return new Error(`${harnessName} could not start Codex. Reinstall with \`npm install -g @openai/codex@latest\`, then reconnect.`);
  }
  if (/spawn Unknown system error|ENOENT|not found/i.test(message)) {
    return new Error(`${harnessName} could not start its underlying CLI. Confirm the agent is installed and on PATH, then reconnect.`);
  }
  return error instanceof Error ? error : new Error(message);
}
