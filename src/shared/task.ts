import type { AgentControlSupport, AgentHarnessDescriptor, AgentHarnessId, AgentModelOption } from './agent';

export const TASK_CHANNELS = {
  command: 'task:command',
  getSnapshot: 'task:get-snapshot',
  snapshot: 'task:snapshot',
} as const;

export type TaskState = 'Running' | 'Needs Approval' | 'Completed' | 'Failed' | 'Cancelled' | 'Discarded';
export type TaskKind = 'work' | 'code';
/** Connection state of the selected agent harness, whatever that harness is. */
export type CodexConnectionState = 'checking' | 'ready' | 'notInstalled' | 'signedOut' | 'error';
export type TaskBrowserRunState = 'not-required' | 'awaiting-action' | 'retrying' | 'action-observed' | 'completed' | 'incomplete';

/** @deprecated Naming kept for compatibility; models are harness-agnostic. */
export type CodexModelSnapshot = AgentModelOption;

export interface TaskProgressSnapshot {
  id: string;
  kind: 'message' | 'plan' | 'command' | 'files' | 'status';
  title: string;
  detail: string;
  status: string;
}

export interface TaskApprovalSnapshot {
  requestId: number | string;
  kind: 'command' | 'files' | 'permissions' | 'git' | 'github' | 'question';
  title: string;
  detail: string;
  reason: string | null;
}

export interface TaskDeliverySnapshot {
  branch: string;
  commit: string;
  remote: string | null;
  pushed: boolean;
  pullRequest: { number: number; url: string; base: string; head: string; state: string; checks: string; review: string } | null;
  /** True after the user separately approved checking out and fast-forwarding the PR base branch locally. */
  localUpdated?: boolean;
  message: string;
}

export interface TaskBrowserRunSnapshot {
  required: boolean;
  state: TaskBrowserRunState;
  taskSpaceId: string | null;
  successfulActionCount: number;
  retryCount: number;
  lastActionAt: string | null;
  sources: TaskBrowserSourceSnapshot[];
}

export interface TaskBrowserSourceSnapshot {
  title: string;
  url: string;
}

export interface TaskTurnSnapshot {
  id: string;
  prompt: string;
  result: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  sources: TaskBrowserSourceSnapshot[];
  createdAt: string;
  completedAt: string | null;
}

export interface TaskRecordSnapshot {
  kind: TaskKind;
  state: TaskState;
  prompt: string;
  model: string;
  reasoningEffort: string;
  documentId: string;
  threadId: string;
  turnId: string;
  baselineCommit: string;
  progress: TaskProgressSnapshot[];
  /** Persisted turns in this one task conversation. Current thinking is not retained here. */
  turns?: TaskTurnSnapshot[];
  pendingApproval: TaskApprovalSnapshot | null;
  result: string;
  diff: string;
  error: string | null;
  browserRun: TaskBrowserRunSnapshot;
  delivery?: TaskDeliverySnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface TaskConnectionSnapshot {
  state: CodexConnectionState;
  message: string;
  accountLabel: string | null;
  models: AgentModelOption[];
  /** The harness Poppin is currently driving. */
  agent?: AgentHarnessDescriptor;
  /** Every harness the user can pick in the Agent selector. */
  availableAgents?: AgentHarnessDescriptor[];
  /** Which selectors this harness actually supports; never assume both. */
  controls?: AgentControlSupport;
}

export interface TaskSnapshot {
  connection: TaskConnectionSnapshot;
  task: TaskRecordSnapshot | null;
}

export type TaskCommand =
  | { type: 'refreshConnection' }
  | { type: 'selectAgent'; agentId: AgentHarnessId }
  | {
      type: 'startTask';
      prompt: string;
      model: string;
      reasoningEffort: string;
      kind: TaskKind;
      /**
       * Answer to Poppin's "does this need live web access?" question. Omitted
       * means Poppin should ask when it is genuinely uncertain.
       */
      useBrowser?: boolean;
    }
  | { type: 'continueTask'; prompt: string }
  | { type: 'finishTask' }
  | { type: 'respondApproval'; decision: 'accept' | 'decline' | 'cancel' }
  | { type: 'respondQuestion'; answer: string }
  | { type: 'cancelTask' }
  | { type: 'reviseTask'; prompt: string }
  | { type: 'approveResult' }
  | { type: 'openPreview' }
  | { type: 'prepareCommit'; branch: string; message: string }
  | { type: 'requestPush' }
  | { type: 'requestPullRequest'; base: string; title: string; body: string }
  | { type: 'refreshPullRequest' }
  | { type: 'requestMerge'; strategy: 'merge' | 'squash' | 'rebase' }
  | { type: 'requestUpdateLocal' }
  | { type: 'exportResult'; format: 'markdown' | 'text' }
  /**
   * Appends the current task result to Poppin's protected Memory page. Uses
   * the shared Memory that already lives in the native Pages store — Memory
   * remains OS-encrypted at rest and never leaves Poppin.
   */
  | { type: 'saveResultToMemory' }
  /**
   * Copies the current task result into Tandem. `mode` picks between creating
   * a new page and appending onto an existing page; when appending, `pageId`
   * is required. When `mode` is 'new' and no `pageId` is provided, Poppin
   * creates a new page in the active Tandem workspace. Success optionally
   * opens Tandem World to the page for review.
   */
  | { type: 'addResultToTandem'; mode?: 'new' | 'append'; pageId?: string };

export interface TaskCommandResult {
  ok: boolean;
  message?: string;
  /** Poppin needs a decision before it can provision the environment. */
  question?: { kind: 'browser'; text: string };
}

export interface PoppinTaskApi {
  getSnapshot: () => Promise<TaskSnapshot>;
  command: (command: TaskCommand) => Promise<TaskCommandResult>;
  subscribe: (listener: (snapshot: TaskSnapshot) => void) => () => void;
}
