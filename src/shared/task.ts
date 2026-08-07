export const TASK_CHANNELS = {
  command: 'task:command',
  getSnapshot: 'task:get-snapshot',
  snapshot: 'task:snapshot',
} as const;

export type TaskState = 'Running' | 'Needs Approval' | 'Completed' | 'Failed' | 'Cancelled' | 'Discarded';
export type TaskKind = 'work' | 'code';
export type CodexConnectionState = 'checking' | 'ready' | 'notInstalled' | 'signedOut' | 'error';

export interface CodexModelSnapshot {
  id: string;
  name: string;
  description: string;
  reasoningEfforts: string[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

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
  message: string;
}

export interface TaskRecordSnapshot {
  kind: TaskKind;
  state: TaskState;
  prompt: string;
  model: string;
  reasoningEffort: string;
  threadId: string;
  turnId: string;
  baselineCommit: string;
  progress: TaskProgressSnapshot[];
  pendingApproval: TaskApprovalSnapshot | null;
  result: string;
  diff: string;
  error: string | null;
  delivery?: TaskDeliverySnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSnapshot {
  connection: {
    state: CodexConnectionState;
    message: string;
    accountLabel: string | null;
    models: CodexModelSnapshot[];
  };
  task: TaskRecordSnapshot | null;
}

export type TaskCommand =
  | { type: 'refreshConnection' }
  | { type: 'startTask'; prompt: string; model: string; reasoningEffort: string; kind: TaskKind }
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
  | { type: 'exportResult'; format: 'markdown' | 'text' };

export interface TaskCommandResult {
  ok: boolean;
  message?: string;
}

export interface PoppinTaskApi {
  getSnapshot: () => Promise<TaskSnapshot>;
  command: (command: TaskCommand) => Promise<TaskCommandResult>;
  subscribe: (listener: (snapshot: TaskSnapshot) => void) => () => void;
}
