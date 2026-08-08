export const BROWSER_AGENT_CHANNELS = {
  command: 'browser-agent:command',
  getSnapshot: 'browser-agent:get-snapshot',
  snapshot: 'browser-agent:snapshot',
} as const;

export type BrowserAgentState = 'idle' | 'running' | 'paused' | 'needs-approval' | 'stopped' | 'completed';

export type BrowserTaskSpaceOwner = 'agent' | 'user';
export type BrowserTaskSpaceStatus = 'agent-controlling' | 'waiting-for-approval' | 'user-controlling' | 'paused' | 'completed' | 'failed-stopped';
export type BrowserTaskSpaceMode = 'browser-only' | 'mixed';

export interface BrowserTaskSpace {
  id: string;
  taskId: string;
  name: string;
  mode: BrowserTaskSpaceMode;
  owner: BrowserTaskSpaceOwner;
  status: BrowserTaskSpaceStatus;
  tabIds: string[];
  contextTabIds: string[];
  explorationTabIds: string[];
  activeTabId: string | null;
  createdAt: string;
  updatedAt: string;
  kept: boolean;
}

export type BrowserAgentAction =
  | { type: 'navigate'; url: string }
  | { type: 'read' }
  | { type: 'click'; selector?: string; ref?: string; snapshotId?: string }
  | { type: 'type'; selector?: string; ref?: string; snapshotId?: string; text: string }
  | { type: 'scroll'; deltaY: number }
  | { type: 'wait'; milliseconds: number }
  | { type: 'search'; text: string }
  | { type: 'captureTranscript' };

export interface BrowserSemanticNode {
  ref: string;
  role: string;
  name: string;
  states: string[];
  clickable: boolean;
  editable: boolean;
  credential: boolean;
  frameId: string;
  bounds?: { x: number; y: number; width: number; height: number };
  locator?: string;
}

export interface BrowserSemanticSnapshot {
  snapshotId: string;
  taskSpaceId: string;
  tabId: string;
  documentId: string;
  url: string;
  title: string;
  createdAt: string;
  nodes: BrowserSemanticNode[];
}

export type BrowserBatchStep =
  | { action: 'click'; ref: string }
  | { action: 'fill'; ref: string; text: string }
  | { action: 'waitFor'; condition: 'milliseconds' | 'textIncludes'; value: string; timeoutMs?: number }
  | { action: 'read' }
  | { action: 'assert'; condition: 'textIncludes' | 'urlIncludes'; value: string };

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
  taskSpace: BrowserTaskSpace | null;
  watching: boolean;
  allowedTabIds: string[];
  activeTabId: string | null;
  currentAction: string | null;
  pendingApproval: BrowserAgentApproval | null;
  log: BrowserAgentLogEntry[];
}

export type BrowserAgentCommand =
  | { type: 'start'; taskId: string; name?: string; mode: BrowserTaskSpaceMode; tabIds: string[] }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'takeOver' }
  | { type: 'watch' }
  | { type: 'keepTabs' }
  | { type: 'closeTaskTabs' }
  | { type: 'act'; taskSpaceId: string; tabId: string; action: BrowserAgentAction }
  | { type: 'batch'; taskSpaceId: string; tabId: string; snapshotId: string; steps: BrowserBatchStep[] }
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
