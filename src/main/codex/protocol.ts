export type JsonObject = Record<string, unknown>;

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
  isDefault: boolean;
}

export type CodexAccount =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: string }
  | { type: 'amazonBedrock'; usesCodexManagedCredentials: boolean };

export interface CodexThread {
  id: string;
  sessionId: string;
  preview: string;
  ephemeral: boolean;
}

export interface CodexTurn {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: { message: string; additionalDetails: string | null } | null;
}

export type CodexThreadItem =
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'plan'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution';
      id: string;
      command: string;
      cwd: string;
      status: string;
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | { type: 'fileChange'; id: string; changes: unknown[]; status: string }
  | { type: string; id: string; [key: string]: unknown };

export interface CodexCommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  availableDecisions?: unknown[] | null;
}

export interface CodexFileApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface RpcServerRequest {
  id: number | string;
  method: string;
  params: unknown;
}

export interface RpcNotification {
  method: string;
  params: unknown;
}

export function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isRpcServerRequest(value: unknown): value is RpcServerRequest {
  return isRecord(value)
    && (typeof value.id === 'number' || typeof value.id === 'string')
    && typeof value.method === 'string';
}

export function isRpcNotification(value: unknown): value is RpcNotification {
  return isRecord(value) && value.id === undefined && typeof value.method === 'string';
}
