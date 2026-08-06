export const WORKSPACE_CHANNELS = {
  command: 'workspace:command',
  getSnapshot: 'workspace:get-snapshot',
  snapshot: 'workspace:snapshot',
} as const;

export interface WorkspaceRecordSnapshot {
  id: 'primary';
  name: string;
  createdAt: string;
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceRecordSnapshot | null;
}

export type WorkspaceCommand =
  | { type: 'createWorkspace'; name: string }
  | { type: 'renameWorkspace'; name: string };

export interface WorkspaceCommandResult {
  ok: boolean;
  message?: string;
}

export interface PoppinWorkspaceApi {
  getSnapshot: () => Promise<WorkspaceSnapshot>;
  command: (command: WorkspaceCommand) => Promise<WorkspaceCommandResult>;
  subscribe: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
}
