/**
 * Product-level agent/harness contract.
 *
 * Poppin is an *agent client*: the user picks a coding/agent harness, and Poppin
 * provides that harness with a working environment (browser, Tandem, context,
 * project, files, terminal, approvals). Nothing in this file may assume Codex.
 */

export type AgentHarnessId = 'codex-app-server' | 'codex-acp';

/** How Poppin talks to the harness process. */
export type AgentTransport = 'codex-app-server' | 'acp';

export type AgentAvailability = 'stable' | 'preview';

export interface AgentHarnessDescriptor {
  id: AgentHarnessId;
  /** Name shown in the Agent selector. */
  name: string;
  transport: AgentTransport;
  availability: AgentAvailability;
  summary: string;
}

/**
 * A model the selected harness exposes. Agents that do not expose model choice
 * report an empty list plus `controls.model === false`; the UI must not invent
 * a picker in that case.
 */
export interface AgentModelOption {
  id: string;
  name: string;
  description: string;
  reasoningEfforts: string[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

/**
 * Which selectors the current harness actually supports. ACP does not require
 * an agent to expose either, so both are negotiated rather than assumed.
 */
export interface AgentControlSupport {
  model: boolean;
  reasoning: boolean;
}

export const DEFAULT_AGENT_CONTROL_SUPPORT: AgentControlSupport = { model: true, reasoning: true };
