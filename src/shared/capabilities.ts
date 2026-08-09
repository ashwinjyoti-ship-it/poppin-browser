/**
 * Poppin's machine-readable capability model.
 *
 * Capabilities describe what an environment must be able to do before an agent
 * can honestly attempt a task. They are transport-independent: how a capability
 * reaches the selected harness (a harness-native tool, MCP, or an ACP client
 * method) is decided by the capability exposure layer, not here.
 */

export type PoppinCapability =
  | 'context_read'
  | 'browser_exploration'
  | 'browser_control'
  | 'selected_tab_control'
  | 'tandem_read'
  | 'tandem_write'
  | 'local_project'
  | 'filesystem'
  | 'terminal'
  | 'document_write';

/**
 * How a browsing context is being used for this task. `context_only` means the
 * agent may read captured page text but cannot drive the page — extracted text
 * is never equivalent to browser control.
 */
export type BrowserCapabilityState =
  | 'context_only'
  | 'browser_ready'
  | 'agent_controlling'
  | 'approval_required'
  | 'user_takeover'
  | 'disconnected'
  | 'expired';

/** Reason codes used identically in agent communication and in the UI. */
export const BROWSER_REASON_CODES = {
  authSubmitApprovalRequired: 'AUTH_SUBMIT_APPROVAL_REQUIRED',
  userTakeoverActive: 'USER_TAKEOVER_ACTIVE',
  browserNotProvisioned: 'BROWSER_NOT_PROVISIONED',
  sourceTabStateNotTransferred: 'SOURCE_TAB_STATE_NOT_TRANSFERRED',
  taskTabExpired: 'TASK_TAB_EXPIRED',
  credentialAccessBlocked: 'CREDENTIAL_ACCESS_BLOCKED',
  browserContextDisconnected: 'BROWSER_CONTEXT_DISCONNECTED',
  snapshotStale: 'SNAPSHOT_STALE',
} as const;

export type BrowserReasonCode = (typeof BROWSER_REASON_CODES)[keyof typeof BROWSER_REASON_CODES];

/**
 * Classification of an action's sensitivity. Never derived from the page URL
 * alone — it is decided from the field or action being touched.
 */
export type SensitiveActionClass =
  | 'safe_user_supplied_identifier'
  | 'credential_secret'
  | 'otp'
  | 'passkey'
  | 'password_manager'
  | 'authentication_submit'
  | 'consequential_action';

/** How Poppin intends to provision browsing for a task. */
export type BrowserProvisionMode = 'none' | 'context-only' | 'exploration' | 'selected-tab';

export interface CapabilityRequirement {
  capability: PoppinCapability;
  /** Plain-language justification shown in the preflight. */
  reason: string;
}

export interface CapabilityPlan {
  capabilities: PoppinCapability[];
  requirements: CapabilityRequirement[];
  browser: BrowserProvisionMode;
  /**
   * Set when deterministic signals and semantic scoring disagree enough that
   * Poppin should ask before starting, rather than guess.
   */
  confirmation: string | null;
}

/**
 * Truthful environment state handed to the agent when a session starts or the
 * environment changes. The agent must know what it can actually read and
 * control before planning.
 */
export interface EnvironmentState {
  browser: {
    state: BrowserCapabilityState;
    taskSpaceId: string | null;
    mode: BrowserProvisionMode;
  };
  tandem: {
    available: boolean;
    read: boolean;
    write: boolean;
  };
  project: {
    connected: boolean;
  };
  context: {
    items: number;
    kinds: string[];
  };
}

export function hasCapability(plan: CapabilityPlan, capability: PoppinCapability): boolean {
  return plan.capabilities.includes(capability);
}

export function requiresBrowser(plan: CapabilityPlan): boolean {
  return plan.browser === 'exploration' || plan.browser === 'selected-tab';
}
