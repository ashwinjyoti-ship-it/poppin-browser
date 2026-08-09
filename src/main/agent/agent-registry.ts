import type { AgentHarnessDescriptor, AgentHarnessId } from '../../shared/agent';
import type { AgentAdapter } from './agent-adapter';
import { AcpAgentAdapter, CODEX_ACP_DESCRIPTOR } from './acp-agent-adapter';
import { CodexAppServerAdapter, CODEX_APP_SERVER_DESCRIPTOR, type CodexAppServerAdapterOptions } from './codex-app-server-adapter';

/**
 * The harnesses Poppin can drive.
 *
 * Codex remains the default and is fully supported over its native app-server
 * protocol. The ACP entry is the portable path: connecting Claude Code, Gemini
 * CLI, OpenCode or any other ACP agent is a new descriptor plus a locator, not a
 * new Poppin integration architecture. See
 * `docs/architecture/AGENT_PORTABILITY.md`.
 */
export const AGENT_HARNESSES: AgentHarnessDescriptor[] = [
  CODEX_APP_SERVER_DESCRIPTOR,
  CODEX_ACP_DESCRIPTOR,
];

export const DEFAULT_AGENT_HARNESS_ID: AgentHarnessId = CODEX_APP_SERVER_DESCRIPTOR.id;

export function describeAgent(id: AgentHarnessId): AgentHarnessDescriptor {
  return AGENT_HARNESSES.find((descriptor) => descriptor.id === id) ?? CODEX_APP_SERVER_DESCRIPTOR;
}

export function isAgentHarnessId(value: unknown): value is AgentHarnessId {
  return typeof value === 'string' && AGENT_HARNESSES.some((descriptor) => descriptor.id === value);
}

export interface AgentFactoryOptions extends CodexAppServerAdapterOptions {
  workspaceRoot?: () => string | null;
}

export function createAgentAdapter(id: AgentHarnessId, options: AgentFactoryOptions = {}): AgentAdapter {
  if (id === 'codex-acp') {
    return new AcpAgentAdapter({ ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}) });
  }
  return new CodexAppServerAdapter(options);
}
