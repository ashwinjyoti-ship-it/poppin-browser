export const BROWSER_AGENT_CHANNELS = {
  command: 'browser-agent:command',
  getSnapshot: 'browser-agent:get-snapshot',
  snapshot: 'browser-agent:snapshot',
} as const;

export type BrowserAgentState = 'idle' | 'running' | 'paused' | 'needs-approval' | 'stopped' | 'completed';

export type BrowserAgentAction =
  | { type: 'navigate'; url: string }
  | { type: 'read' }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'scroll'; deltaY: number }
  | { type: 'search'; text: string }
  | { type: 'captureTranscript' };

export interface BrowserAgentLogEntry {
  id: string;
  at: string;
  tabId: string;
  action: string;
  target: string;
  outcome: 'started' | 'completed' | 'paused' | 'rejected' | 'failed';
  detail: string;
}

export interface BrowserAgentApproval {
  actionId: string;
  title: string;
  target: string;
  scope: string;
  consequence: string;
}

export interface BrowserAgentSnapshot {
  state: BrowserAgentState;
  taskId: string | null;
  allowedTabIds: string[];
  activeTabId: string | null;
  currentAction: string | null;
  pendingApproval: BrowserAgentApproval | null;
  log: BrowserAgentLogEntry[];
}

export type BrowserAgentCommand =
  | { type: 'start'; taskId: string; tabIds: string[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'takeOver' }
  | { type: 'act'; tabId: string; action: BrowserAgentAction }
  | { type: 'respondApproval'; decision: 'approve' | 'reject' };

export interface BrowserAgentCommandResult {
  ok: boolean;
  message?: string;
  data?: string;
}

export interface PoppinBrowserAgentApi {
  getSnapshot: () => Promise<BrowserAgentSnapshot>;
  command: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult>;
  subscribe: (listener: (snapshot: BrowserAgentSnapshot) => void) => () => void;
}
