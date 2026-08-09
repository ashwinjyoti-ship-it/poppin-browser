/**
 * Agent Client Protocol wire types.
 *
 * Derived from the published ACP JSON schema (`@agentclientprotocol/sdk`,
 * schema/schema.json). Only the surface Poppin actually uses is modelled here so
 * the Electron main bundle stays dependency-free; the field names, method names
 * and enum values match the specification exactly.
 *
 * Spec: https://agentclientprotocol.com/protocol/overview
 */

export const ACP_PROTOCOL_VERSION = 1;

export const ACP_METHODS = {
  initialize: 'initialize',
  authenticate: 'authenticate',
  sessionNew: 'session/new',
  sessionLoad: 'session/load',
  sessionPrompt: 'session/prompt',
  sessionCancel: 'session/cancel',
  sessionSetMode: 'session/set_mode',
  sessionUpdate: 'session/update',
  sessionRequestPermission: 'session/request_permission',
  fsReadTextFile: 'fs/read_text_file',
  fsWriteTextFile: 'fs/write_text_file',
  terminalCreate: 'terminal/create',
} as const;

export interface AcpImplementation {
  name: string;
  title?: string;
  version?: string;
}

export interface AcpFileSystemCapabilities {
  readTextFile: boolean;
  writeTextFile: boolean;
}

export interface AcpClientCapabilities {
  fs: AcpFileSystemCapabilities;
  terminal: boolean;
}

export interface AcpInitializeRequest {
  protocolVersion: number;
  clientCapabilities: AcpClientCapabilities;
  clientInfo: AcpImplementation;
}

export interface AcpPromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export interface AcpMcpCapabilities {
  http?: boolean;
  sse?: boolean;
}

export interface AcpAgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: AcpPromptCapabilities;
  mcpCapabilities?: AcpMcpCapabilities;
}

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string | null;
}

export interface AcpInitializeResponse {
  protocolVersion: number;
  agentCapabilities?: AcpAgentCapabilities;
  agentInfo?: AcpImplementation | null;
  authMethods?: AcpAuthMethod[];
}

export interface AcpEnvVariable {
  name: string;
  value: string;
}

/** Stdio transport is the only transport every ACP agent must support. */
export interface AcpMcpServerStdio {
  name: string;
  command: string;
  args: string[];
  env: AcpEnvVariable[];
}

export interface AcpNewSessionRequest {
  cwd: string;
  mcpServers: AcpMcpServerStdio[];
}

export interface AcpSessionMode {
  id: string;
  name: string;
  description?: string | null;
}

export interface AcpSessionModeState {
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface AcpNewSessionResponse {
  sessionId: string;
  modes?: AcpSessionModeState | null;
}

export interface AcpTextContentBlock {
  type: 'text';
  text: string;
}

export type AcpContentBlock =
  | AcpTextContentBlock
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'audio'; mimeType: string; data: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string | null }
  | { type: 'resource'; resource: { uri: string; text?: string; mimeType?: string | null } };

export interface AcpPromptRequest {
  sessionId: string;
  prompt: AcpContentBlock[];
}

export type AcpStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export interface AcpPromptResponse {
  stopReason: AcpStopReason;
}

export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AcpToolKind =
  | 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';

export interface AcpToolCallContent {
  type: 'content' | 'diff' | 'terminal';
  content?: AcpContentBlock;
  path?: string;
  oldText?: string | null;
  newText?: string;
  terminalId?: string;
}

export interface AcpToolCall {
  toolCallId: string;
  title?: string;
  kind?: AcpToolKind;
  status?: AcpToolCallStatus;
  content?: AcpToolCallContent[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export type AcpPlanEntryStatus = 'pending' | 'in_progress' | 'completed';

export interface AcpPlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: AcpPlanEntryStatus;
}

export type AcpSessionUpdate =
  | { sessionUpdate: 'user_message_chunk'; content: AcpContentBlock; messageId?: string | null }
  | { sessionUpdate: 'agent_message_chunk'; content: AcpContentBlock; messageId?: string | null }
  | { sessionUpdate: 'agent_thought_chunk'; content: AcpContentBlock; messageId?: string | null }
  | ({ sessionUpdate: 'tool_call' } & AcpToolCall)
  | ({ sessionUpdate: 'tool_call_update' } & AcpToolCall)
  | { sessionUpdate: 'plan'; entries: AcpPlanEntry[] }
  | { sessionUpdate: 'current_mode_update'; currentModeId: string }
  | { sessionUpdate: string; [key: string]: unknown };

export interface AcpSessionNotification {
  sessionId: string;
  update: AcpSessionUpdate;
}

export type AcpPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: AcpPermissionOptionKind;
}

export interface AcpRequestPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
}

export type AcpRequestPermissionOutcome =
  | { outcome: 'cancelled' }
  | { outcome: 'selected'; optionId: string };

export interface AcpRequestPermissionResponse {
  outcome: AcpRequestPermissionOutcome;
}

export interface AcpReadTextFileRequest {
  sessionId: string;
  path: string;
  line?: number | null;
  limit?: number | null;
}

export interface AcpWriteTextFileRequest {
  sessionId: string;
  path: string;
  content: string;
}

/** JSON-RPC error codes used by ACP, following the JSON-RPC 2.0 specification. */
export const ACP_ERROR = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  authRequired: -32000,
} as const;

export function textBlock(text: string): AcpTextContentBlock {
  return { type: 'text', text };
}

export function contentBlockText(block: unknown): string {
  if (!block || typeof block !== 'object') return '';
  const value = block as { type?: unknown; text?: unknown; resource?: { text?: unknown } };
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (value.type === 'resource' && value.resource && typeof value.resource.text === 'string') return value.resource.text;
  return '';
}
