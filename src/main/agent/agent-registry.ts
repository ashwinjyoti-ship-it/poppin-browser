import type { AgentHarnessDescriptor, AgentHarnessId } from '../../shared/agent';
import { locateAcpHarness } from '../acp/acp-locator';
import type { AcpMcpServerStdio } from '../acp/acp-protocol';
import type { AgentToolSpec } from './agent-adapter';
import type { AgentAdapter } from './agent-adapter';
import {
  AcpAgentAdapter,
  CLAUDE_CODE_DESCRIPTOR,
  CODEX_ACP_DESCRIPTOR,
  CURSOR_ACP_DESCRIPTOR,
} from './acp-agent-adapter';
import { CodexAppServerAdapter, CODEX_APP_SERVER_DESCRIPTOR, type CodexAppServerAdapterOptions } from './codex-app-server-adapter';

/**
 * The harnesses Poppin can drive.
 *
 * Codex remains the default and is fully supported over its native app-server
 * protocol. ACP entries (Codex ACP, Claude Code, Cursor Agent) share
 * `AcpAgentAdapter` plus Poppin's MCP capability bridge. See
 * `docs/architecture/AGENT_PORTABILITY.md`.
 */
export const AGENT_HARNESSES: AgentHarnessDescriptor[] = [
  CODEX_APP_SERVER_DESCRIPTOR,
  CODEX_ACP_DESCRIPTOR,
  CLAUDE_CODE_DESCRIPTOR,
  CURSOR_ACP_DESCRIPTOR,
];

export const DEFAULT_AGENT_HARNESS_ID: AgentHarnessId = CODEX_APP_SERVER_DESCRIPTOR.id;

export function describeAgent(id: AgentHarnessId): AgentHarnessDescriptor {
  return AGENT_HARNESSES.find((descriptor) => descriptor.id === id) ?? CODEX_APP_SERVER_DESCRIPTOR;
}

export function isAgentHarnessId(value: unknown): value is AgentHarnessId {
  return typeof value === 'string' && AGENT_HARNESSES.some((descriptor) => descriptor.id === value);
}

export function isAcpHarnessId(id: AgentHarnessId): boolean {
  return describeAgent(id).transport === 'acp';
}

export interface AgentFactoryOptions extends CodexAppServerAdapterOptions {
  workspaceRoot?: () => string | null;
  mcpBridgeAvailable?: () => boolean;
  resolveMcpServers?: (tools: AgentToolSpec[]) => Promise<AcpMcpServerStdio[]>;
}

export function createAgentAdapter(id: AgentHarnessId, options: AgentFactoryOptions = {}): AgentAdapter {
  if (isAcpHarnessId(id)) {
    const descriptor = describeAgent(id);
    return new AcpAgentAdapter({
      descriptor,
      locate: async () => locateAcpHarness(id),
      ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
      ...(options.mcpBridgeAvailable ? { mcpBridgeAvailable: options.mcpBridgeAvailable } : {}),
      ...(options.resolveMcpServers ? { resolveMcpServers: options.resolveMcpServers } : {}),
    });
  }
  return new CodexAppServerAdapter(options);
}
