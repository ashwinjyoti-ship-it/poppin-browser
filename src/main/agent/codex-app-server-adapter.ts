import { EventEmitter } from 'node:events';

import type { AgentHarnessDescriptor, AgentModelOption } from '../../shared/agent';
import { CodexAppServer } from '../codex/codex-app-server';
import { locateCodex, type CodexLaunch } from '../codex/codex-locator';
import {
  isRecord,
  type CodexAccount,
  type CodexDynamicToolCallResponse,
  type CodexDynamicToolSpec,
  type CodexModel,
  type CodexThread,
  type CodexThreadItem,
  type JsonObject,
  type RpcNotification,
  type RpcServerRequest,
} from '../codex/protocol';
import { AgentNotInstalledError, AgentSignedOutError } from './agent-errors';
import type {
  AgentAdapter,
  AgentAdapterEvents,
  AgentApprovalDecision,
  AgentConnectionInfo,
  AgentHistoryMessage,
  AgentPromptRequest,
  AgentRequestId,
  AgentResumeRequest,
  AgentResumeResult,
  AgentSession,
  AgentSessionRequest,
  AgentToolResult,
  AgentTurn,
  AgentActivity,
} from './agent-adapter';

const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_ITEM_LENGTH = 60_000;

export const CODEX_APP_SERVER_DESCRIPTOR: AgentHarnessDescriptor = {
  id: 'codex-app-server',
  name: 'Codex',
  transport: 'codex-app-server',
  availability: 'stable',
  summary: 'Codex over its native app-server protocol. The proven Poppin path.',
};

export interface CodexAppServerAdapterOptions {
  locateCodex?: () => Promise<CodexLaunch | null>;
  createServer?: (launch: CodexLaunch) => CodexAppServer;
}

/**
 * Speaks the Codex app-server JSON-RPC dialect and normalizes it onto the
 * harness-agnostic {@link AgentAdapter} surface. This preserves Poppin's proven
 * Codex integration while the ACP path is proved to parity.
 */
export class CodexAppServerAdapter extends EventEmitter<AgentAdapterEvents> implements AgentAdapter {
  readonly descriptor = CODEX_APP_SERVER_DESCRIPTOR;

  private server: CodexAppServer | null = null;
  private activeSessionId = '';
  private activeTurnId = '';
  private toolsAttached = false;
  private pendingPermissionProfile: JsonObject | null = null;
  private pendingQuestionIds: string[] = [];
  private workspaceRoots: string[] = [];

  constructor(private readonly options: CodexAppServerAdapterOptions = {}) {
    super();
  }

  async connect(): Promise<AgentConnectionInfo> {
    await this.close();
    const launch = await (this.options.locateCodex ?? locateCodex)();
    if (!launch) {
      throw new AgentNotInstalledError('Codex is not installed. Install or sign in to the Codex app, then try again.');
    }
    const server = this.options.createServer?.(launch) ?? new CodexAppServer(launch);
    server.on('notification', (notification) => this.handleNotification(notification));
    server.on('request', (request) => this.handleRequest(request));
    server.on('exit', (error) => {
      this.server = null;
      this.emit('exit', error);
    });
    await server.connect();
    this.server = server;
    const [accountResponse, models] = await Promise.all([server.getAccount(), server.listModels()]);
    if (!accountResponse.account) {
      throw new AgentSignedOutError('Sign in to Codex in the Codex or ChatGPT app, then reconnect.');
    }
    return {
      accountLabel: accountLabel(accountResponse.account),
      models: models.filter((model) => !model.hidden).map(toModelOption),
      controls: { model: true, reasoning: true },
      capabilities: { clientTools: true, resumeSession: true },
      detail: null,
    };
  }

  async createSession(request: AgentSessionRequest): Promise<AgentSession> {
    this.workspaceRoots = request.workspaceRoots ?? [];
    const thread = await this.requireServer().startThread({
      cwd: request.cwd,
      model: request.model,
      developerInstructions: request.instructions,
      dynamicTools: request.tools.length ? request.tools.map(toDynamicTool) : undefined,
      workspaceRoots: this.workspaceRoots,
    });
    this.activeSessionId = thread.id;
    this.activeTurnId = '';
    this.toolsAttached = request.tools.length > 0;
    return { id: thread.id };
  }

  async resumeSession(sessionId: string, request: AgentResumeRequest): Promise<AgentResumeResult> {
    const server = this.requireServer();
    this.workspaceRoots = request.workspaceRoots ?? this.workspaceRoots;
    const resumed = await server.resumeThread(sessionId, request.cwd, this.workspaceRoots);
    this.activeSessionId = resumed.id;
    this.activeTurnId = '';
    const toolsAttached = request.toolsAlreadyAttached && this.toolsAttached;
    if (!request.requiresTools || toolsAttached) {
      this.toolsAttached = toolsAttached;
      return { session: { id: resumed.id }, toolsAttached };
    }
    // Codex binds dynamic tools at thread creation. To attach Poppin capabilities
    // to a conversation that started without them, start a replacement thread and
    // replay the conversation into it.
    const replacement = await server.startThread({
      cwd: request.cwd,
      model: request.model,
      developerInstructions: request.instructions,
      dynamicTools: request.tools.map(toDynamicTool),
      workspaceRoots: this.workspaceRoots,
    });
    await server.injectThreadItems(replacement.id, historyItems(resumed, request.fallbackHistory));
    this.activeSessionId = replacement.id;
    this.toolsAttached = true;
    return { session: { id: replacement.id }, toolsAttached: true };
  }

  async prompt(request: AgentPromptRequest): Promise<AgentTurn> {
    const turn = await this.requireServer().startTurn({
      threadId: request.sessionId,
      prompt: request.prompt,
      cwd: request.cwd,
      model: request.model,
      effort: request.reasoningEffort,
      workspaceRoots: this.workspaceRoots,
    });
    this.activeSessionId = request.sessionId;
    this.activeTurnId = turn.id;
    return { id: turn.id };
  }

  async cancel(sessionId: string, turnId: string): Promise<void> {
    await this.server?.interruptTurn(sessionId, turnId);
  }

  respondApproval(requestId: AgentRequestId, decision: AgentApprovalDecision): void {
    const profile = this.pendingPermissionProfile;
    this.pendingPermissionProfile = null;
    if (profile) {
      this.server?.respond(requestId, { permissions: decision === 'accept' ? profile : {}, scope: 'turn' });
      return;
    }
    this.server?.respond(requestId, { decision });
  }

  respondQuestion(requestId: AgentRequestId, answer: string): void {
    const answers = Object.fromEntries(this.pendingQuestionIds.map((id) => [id, { answers: [answer] }]));
    this.pendingQuestionIds = [];
    this.server?.respond(requestId, { answers });
  }

  respondTool(requestId: AgentRequestId, result: AgentToolResult): void {
    const response: CodexDynamicToolCallResponse = {
      success: result.ok,
      contentItems: [{ type: 'inputText', text: result.text }],
    };
    this.server?.respond(requestId, response);
  }

  rejectRequest(requestId: AgentRequestId, message: string): void {
    this.server?.rejectRequest(requestId, message);
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.activeSessionId = '';
    this.activeTurnId = '';
    this.toolsAttached = false;
    this.pendingPermissionProfile = null;
    this.pendingQuestionIds = [];
    await server?.close();
  }

  private requireServer(): CodexAppServer {
    if (!this.server) throw new Error('Codex is not connected.');
    return this.server;
  }

  private handleRequest(request: RpcServerRequest): void {
    if (!isRecord(request.params) || !this.belongsToActiveTurn(request.params)) {
      this.rejectRequest(request.id, 'This request does not belong to the active Poppin task.');
      return;
    }
    const params = request.params;
    if (request.method === 'item/tool/call') {
      this.emit('request', {
        type: 'toolCall',
        requestId: request.id,
        tool: stringValue(params.tool),
        arguments: params.arguments,
      });
      return;
    }
    if (request.method === 'item/tool/requestUserInput') {
      const questions = Array.isArray(params.questions) ? params.questions.filter(isRecord) : [];
      this.pendingQuestionIds = questions.map((question, index) => stringValue(question.id) || `question-${index + 1}`);
      this.emit('request', {
        type: 'question',
        requestId: request.id,
        detail: questions.length
          ? questions.map((question) => stringValue(question.question) || stringValue(question.header)).filter(Boolean).join('\n\n')
          : 'Codex requested a blocking clarification.',
      });
      return;
    }
    if (request.method === 'item/commandExecution/requestApproval') {
      this.emit('request', {
        type: 'approval',
        requestId: request.id,
        kind: 'command',
        title: 'Codex wants to run a command',
        detail: [stringValue(params.command), stringValue(params.cwd)].filter(Boolean).join('\n'),
        reason: nullableString(params.reason),
      });
      return;
    }
    if (request.method === 'item/fileChange/requestApproval') {
      this.emit('request', {
        type: 'approval',
        requestId: request.id,
        kind: 'files',
        title: 'Codex needs additional file access',
        detail: stringValue(params.grantRoot) || 'Outside the connected project boundary',
        reason: nullableString(params.reason),
      });
      return;
    }
    if (request.method === 'item/permissions/requestApproval' && isRecord(params.permissions)) {
      this.pendingPermissionProfile = params.permissions;
      this.emit('request', {
        type: 'approval',
        requestId: request.id,
        kind: 'permissions',
        title: 'Codex requests additional permissions',
        detail: safeJson(params.permissions),
        reason: nullableString(params.reason),
      });
      return;
    }
    this.rejectRequest(request.id, `Poppin does not support the ${request.method} request.`);
  }

  private handleNotification(notification: RpcNotification): void {
    if (!isRecord(notification.params) || !this.belongsToActiveTurn(notification.params)) return;
    const params = notification.params;
    switch (notification.method) {
      case 'item/started':
      case 'item/completed': {
        if (!isRecord(params.item)) return;
        const activity = activityFromItem(params.item as CodexThreadItem, notification.method === 'item/completed');
        if (activity) this.emit('event', { type: 'activity', activity });
        return;
      }
      case 'item/agentMessage/delta': {
        const delta = stringValue(params.delta);
        if (delta) this.emit('event', { type: 'messageDelta', itemId: stringValue(params.itemId) || 'agent-message', delta });
        return;
      }
      case 'item/commandExecution/outputDelta': {
        const delta = stringValue(params.delta);
        if (delta) this.emit('event', { type: 'commandOutputDelta', itemId: stringValue(params.itemId), delta });
        return;
      }
      case 'turn/diff/updated':
        this.emit('event', { type: 'diff', diff: stringValue(params.diff) });
        return;
      case 'error':
        this.emit('event', { type: 'error', message: notificationError(params) });
        return;
      case 'turn/completed': {
        const turn = isRecord(params.turn) ? params.turn : null;
        const status = turn ? stringValue(turn.status) : 'failed';
        if (status === 'completed') {
          this.emit('event', { type: 'turnEnded', status: 'completed', error: null });
        } else if (status === 'interrupted') {
          this.emit('event', { type: 'turnEnded', status: 'interrupted', error: null });
        } else {
          this.emit('event', {
            type: 'turnEnded',
            status: 'failed',
            error: turn && isRecord(turn.error) ? stringValue(turn.error.message) || null : null,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  /** Mirrors Poppin's rule that only the active thread/turn may drive the task. */
  private belongsToActiveTurn(params: JsonObject): boolean {
    const threadId = stringValue(params.threadId);
    if (threadId && this.activeSessionId && threadId !== this.activeSessionId) return false;
    const turnId = stringValue(params.turnId) || (isRecord(params.turn) ? stringValue(params.turn.id) : '');
    if (this.activeTurnId && turnId && this.activeTurnId !== turnId) return false;
    if (!this.activeTurnId && turnId) {
      this.activeTurnId = turnId;
      this.emit('event', { type: 'turnStarted', turnId });
    }
    return true;
  }
}

function toDynamicTool(tool: { name: string; description: string; inputSchema: Record<string, unknown> }): CodexDynamicToolSpec {
  return { type: 'function', name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

function toModelOption(model: CodexModel): AgentModelOption {
  return {
    id: model.model,
    name: model.displayName,
    description: model.description,
    reasoningEfforts: model.supportedReasoningEfforts.map((item) => item.reasoningEffort),
    defaultReasoningEffort: model.defaultReasoningEffort,
    isDefault: model.isDefault,
  };
}

function activityFromItem(item: CodexThreadItem, completed: boolean): AgentActivity | null {
  const status = completed ? 'completed' : 'running';
  switch (item.type) {
    case 'agentMessage':
      return { id: item.id, kind: 'message', title: 'Codex response', detail: stringValue(item.text), status };
    case 'plan':
      return { id: item.id, kind: 'plan', title: 'Plan', detail: stringValue(item.text), status };
    case 'commandExecution':
      return {
        id: item.id,
        kind: 'command',
        title: stringValue(item.command) || 'Run command',
        detail: stringValue(item.aggregatedOutput),
        status: stringValue(item.status) || status,
      };
    case 'fileChange':
      return {
        id: item.id,
        kind: 'files',
        title: 'Changed project files',
        detail: `${Array.isArray(item.changes) ? item.changes.length : 0} file change(s)`,
        status: stringValue(item.status) || status,
      };
    default:
      return null;
  }
}

function historyItems(thread: CodexThread, fallback: AgentHistoryMessage[]): JsonObject[] {
  const items: JsonObject[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items) {
      if (item.type === 'userMessage') {
        const text = (item.content ?? [])
          .filter((content) => content.type === 'text' && typeof content.text === 'string')
          .map((content) => content.text!)
          .join('\n')
          .trim();
        if (text) items.push(responseMessage('user', stripHistoricalAgentTabs(text).slice(0, MAX_HISTORY_ITEM_LENGTH)));
      } else if (item.type === 'agentMessage' && item.text?.trim()) {
        items.push(responseMessage('assistant', item.text.trim().slice(-MAX_HISTORY_ITEM_LENGTH)));
      }
    }
  }
  if (items.length === 0) {
    for (const message of fallback) {
      const text = message.role === 'user' ? message.text.slice(0, MAX_HISTORY_ITEM_LENGTH) : message.text.slice(-MAX_HISTORY_ITEM_LENGTH);
      if (text.trim()) items.push(responseMessage(message.role, text));
    }
  }
  return items.slice(-MAX_HISTORY_ITEMS);
}

function responseMessage(role: 'user' | 'assistant', text: string): JsonObject {
  return { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] };
}

function stripHistoricalAgentTabs(text: string): string {
  return text.replace(/\n\nTASK-OWNED AGENT TABS\n[\s\S]*$/u, '');
}

function accountLabel(account: CodexAccount): string {
  if (account.type === 'chatgpt') return account.email || `ChatGPT ${account.planType}`;
  if (account.type === 'apiKey') return 'OpenAI API key';
  return 'Amazon Bedrock';
}

function notificationError(params: JsonObject): string {
  if (isRecord(params.error) && typeof params.error.message === 'string') return params.error.message;
  return stringValue(params.message) || 'Codex reported an error.';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 8_000);
  } catch {
    return '(Permission details unavailable)';
  }
}
