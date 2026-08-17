import type { EventEmitter } from 'node:events';

import type { AgentControlSupport, AgentHarnessDescriptor, AgentModelOption } from '../../shared/agent';

/**
 * Normalized agent boundary.
 *
 * Everything above this interface (TaskEngine, capability router, browser and
 * Tandem capabilities) is harness-agnostic. Everything below it is transport
 * specific: `CodexAppServerAdapter` speaks the Codex app-server JSON-RPC dialect,
 * `AcpAgentAdapter` speaks the Agent Client Protocol.
 *
 * Adding another ACP-compatible harness means registering a descriptor — it must
 * never require a second Poppin integration architecture.
 */

export type AgentRequestId = number | string;

/**
 * What the connected harness can actually do. Poppin's capability provisioner
 * reads this so it never promises an environment the harness cannot receive.
 */
export interface AgentHarnessCapabilities {
  /** The harness can be given Poppin capability tools for a session. */
  clientTools: boolean;
  /** The harness can resume a previous session natively. */
  resumeSession: boolean;
}

export interface AgentConnectionInfo {
  accountLabel: string | null;
  models: AgentModelOption[];
  controls: AgentControlSupport;
  capabilities: AgentHarnessCapabilities;
  /** Free-form notes surfaced to the user, e.g. an ACP protocol version. */
  detail: string | null;
}

/** A Poppin capability exposed to the agent as a callable tool. */
export interface AgentToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentSessionRequest {
  cwd: string;
  model: string;
  /** System/developer instructions for the session. */
  instructions: string;
  /** Poppin capability tools that should be callable for this session. */
  tools: AgentToolSpec[];
  /** Extra writable roots besides cwd (Work: Codex skills directory). */
  workspaceRoots?: string[];
}

export interface AgentSession {
  id: string;
}

export interface AgentResumeRequest extends AgentSessionRequest {
  /** Poppin's own record of the conversation, used when a harness cannot resume natively. */
  fallbackHistory: AgentHistoryMessage[];
  /** True when the resumed session must have Poppin's capability tools live. */
  requiresTools: boolean;
  /** Whether the previous session in this adapter already had the tools attached. */
  toolsAlreadyAttached: boolean;
}

export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentResumeResult {
  session: AgentSession;
  /** True when the returned session has Poppin's capability tools attached. */
  toolsAttached: boolean;
}

export interface AgentPromptRequest {
  sessionId: string;
  prompt: string;
  cwd: string;
  model: string;
  reasoningEffort: string;
}

export interface AgentTurn {
  id: string;
}

/** Activity the client renders as task progress. Mirrors ACP `session/update`. */
export type AgentActivityKind = 'message' | 'plan' | 'command' | 'files' | 'status';

export interface AgentActivity {
  id: string;
  kind: AgentActivityKind;
  title: string;
  detail: string;
  status: string;
}

export type AgentTurnStatus = 'completed' | 'interrupted' | 'failed';

export type AgentEvent =
  | { type: 'activity'; activity: AgentActivity }
  | { type: 'messageDelta'; itemId: string; delta: string }
  | { type: 'commandOutputDelta'; itemId: string; delta: string }
  | { type: 'diff'; diff: string }
  | { type: 'turnStarted'; turnId: string }
  | { type: 'turnEnded'; status: AgentTurnStatus; error: string | null }
  | { type: 'error'; message: string };

export type AgentApprovalKind = 'command' | 'files' | 'permissions';

/** Requests that need a Poppin (or user) decision before the agent continues. */
export type AgentRequestEvent =
  | {
      type: 'approval';
      requestId: AgentRequestId;
      kind: AgentApprovalKind;
      title: string;
      detail: string;
      reason: string | null;
    }
  | { type: 'question'; requestId: AgentRequestId; detail: string }
  | { type: 'toolCall'; requestId: AgentRequestId; tool: string; arguments: unknown };

export type AgentApprovalDecision = 'accept' | 'decline' | 'cancel';

export interface AgentToolResult {
  ok: boolean;
  text: string;
}

export interface AgentAdapterEvents {
  event: [AgentEvent];
  request: [AgentRequestEvent];
  exit: [Error | null];
}

export interface AgentAdapter extends EventEmitter<AgentAdapterEvents> {
  readonly descriptor: AgentHarnessDescriptor;
  /** Launch the harness and negotiate capabilities. Rejects with a user-facing message. */
  connect(): Promise<AgentConnectionInfo>;
  createSession(request: AgentSessionRequest): Promise<AgentSession>;
  resumeSession(sessionId: string, request: AgentResumeRequest): Promise<AgentResumeResult>;
  prompt(request: AgentPromptRequest): Promise<AgentTurn>;
  cancel(sessionId: string, turnId: string): Promise<void>;
  respondApproval(requestId: AgentRequestId, decision: AgentApprovalDecision): void;
  respondQuestion(requestId: AgentRequestId, answer: string): void;
  respondTool(requestId: AgentRequestId, result: AgentToolResult): void;
  rejectRequest(requestId: AgentRequestId, message: string): void;
  close(): Promise<void>;
}
