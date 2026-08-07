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
  documents: WorkspaceDocumentSnapshot[];
  tabContexts: TabContextSnapshot[];
  project: WorkspaceProjectSnapshot | null;
  visualSelection: VisualSelectionSnapshot | null;
}

export interface VisualSelectionSnapshot {
  tabId: string;
  url: string;
  selector: string;
  html: string;
  css: Record<string, string>;
  domContext: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  screenshotDataUrl: string;
  capturedAt: string;
}

export interface WorkspaceProjectSnapshot {
  repositoryPath: string;
  remote: string | null;
  branch: string;
  installCommand: string;
  devCommand: string;
  previewUrl: string;
}

export interface WorkspaceDocumentSnapshot {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  selected: boolean;
  capturedText: string | null;
  truncated: boolean;
}

export interface TabContextSnapshot {
  tabId: string;
  title: string;
  url: string;
  capturedText: string;
  truncated: boolean;
  capturedAt: string;
}

export interface CapturedTabContext {
  title: string;
  url: string;
  text: string;
  truncated: boolean;
}

export type WorkspaceCommand =
  | { type: 'createWorkspace'; name: string }
  | { type: 'renameWorkspace'; name: string }
  | { type: 'chooseDocuments' }
  | { type: 'removeDocument'; documentId: string }
  | { type: 'setDocumentSelected'; documentId: string; selected: boolean }
  | { type: 'setTabSelected'; tabId: string; selected: boolean }
  | { type: 'refreshTabContext'; tabId: string }
  | { type: 'captureVisualSelection'; tabId: string }
  | { type: 'clearVisualSelection' }
  | { type: 'connectExistingProject' }
  | { type: 'cloneRepository'; remote: string }
  | { type: 'createNewProject' }
  | {
      type: 'updateProjectSettings';
      installCommand: string;
      devCommand: string;
      previewUrl: string;
    };

export interface WorkspaceCommandResult {
  ok: boolean;
  message?: string;
}

export interface PoppinWorkspaceApi {
  getSnapshot: () => Promise<WorkspaceSnapshot>;
  command: (command: WorkspaceCommand) => Promise<WorkspaceCommandResult>;
  subscribe: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
}
