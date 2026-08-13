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

import type { TandemContextSnapshot } from './tandem';
import type { RecipeSnapshot, RecipeStepSnapshot } from './recipes';
import type { MailSkillSnapshot } from './mail';

export type { RecipeSnapshot, RecipeStepSnapshot } from './recipes';
export type { MailSkillSnapshot } from './mail';

export interface WorkspaceSnapshot {
  workspace: WorkspaceRecordSnapshot | null;
  documents: WorkspaceDocumentSnapshot[];
  tabContexts: TabContextSnapshot[];
  project: WorkspaceProjectSnapshot | null;
  visualSelection: VisualSelectionSnapshot | null;
  pageContexts?: PageContextSnapshot[];
  /** Frozen Tandem pages the user explicitly checked into context. */
  tandemContexts?: TandemContextSnapshot[];
  /** Named checkbox sets the user can save and re-apply. */
  contextPacks?: ContextPackSnapshot[];
  /** True when the user has opted the encrypted Memory brief into context. */
  memorySelected?: boolean;
  /** A frozen, inspectable preview of Memory content sent to the agent. */
  memoryBrief?: MemoryBriefSnapshot | null;
  /** Named tab collections the user saved for later re-opening. */
  browserSessions?: BrowserSessionSnapshot[];
  /** Phase 13 transparent site recipes saved from successful verified runs. */
  recipes?: RecipeSnapshot[];
  /** User's https webmail URL. Login stays in the persistent browser partition. */
  mailInboxUrl?: string | null;
  /** Natural-language mailbox skills the active harness follows for mail work. */
  mailSkills?: MailSkillSnapshot[];
}

/**
 * Named context pack: a saved selection of tabs (by URL/title, since tabs die),
 * workspace documents, Tandem pages, and the Memory checkbox. Applying a pack
 * re-selects whatever still exists — matching open tabs by URL, documents by
 * id, and Tandem pages by id — without importing new content on its own.
 */
export interface ContextPackSnapshot {
  id: string;
  name: string;
  tabRefs: { url: string; title: string }[];
  documentIds: string[];
  tandemPageIds: string[];
  includeMemory: boolean;
  createdAt: string;
}

/** A bounded copy of Memory the user opted into the context package. */
export interface MemoryBriefSnapshot {
  title: string;
  content: string;
  truncated: boolean;
}

/** A saved tab collection: URLs, titles, and pinning survive a full close. */
export interface BrowserSessionSnapshot {
  id: string;
  name: string;
  tabs: { url: string; title: string; pinned: boolean }[];
  createdAt: string;
}

export interface PageContextSnapshot {
  pageId: string;
  title: string;
  kind: 'page' | 'database';
  content: string;
  truncated: boolean;
  rowCount: number | null;
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
  | { type: 'openDocumentAsDatabase'; documentId: string }
  | { type: 'setTabSelected'; tabId: string; selected: boolean }
  | { type: 'refreshTabContext'; tabId: string }
  | { type: 'captureVisualSelection'; tabId: string }
  | { type: 'clearVisualSelection' }
  /** Free-form local path or Git URL; main detects which and completes the flow. */
  | { type: 'addProject'; source: string }
  /** Opens a folder picker, then connects or initializes that folder. */
  | { type: 'chooseProjectFolder' }
  | {
      type: 'updateProjectSettings';
      installCommand: string;
      devCommand: string;
      previewUrl: string;
    }
  /** Opt the encrypted Memory brief in or out of the current context package. */
  | { type: 'setMemorySelected'; selected: boolean }
  /** Snapshots the current selection (tabs by URL, documents, tandem pages, memory) as a named pack. */
  | { type: 'saveContextPack'; name: string }
  /** Re-selects whatever still exists from a saved pack. */
  | { type: 'applyContextPack'; packId: string }
  | { type: 'renameContextPack'; packId: string; name: string }
  | { type: 'deleteContextPack'; packId: string }
  /** Snapshots the current non-agent, non-Tandem-World browser tabs as a named session. */
  | { type: 'saveBrowserSession'; name?: string }
  /**
   * Re-opens the tabs from a saved session. `replace` closes existing user tabs
   * first; `merge` opens the session's tabs alongside what's already there.
   */
  | { type: 'openBrowserSession'; sessionId: string; mode: 'replace' | 'merge' }
  | { type: 'renameBrowserSession'; sessionId: string; name: string }
  | { type: 'deleteBrowserSession'; sessionId: string }
  /**
   * Saves a sanitized recipe from a successful automation log. Creation is
   * always explicit — never auto-created. Credential-looking steps are dropped.
   */
  | {
      type: 'saveRecipe';
      name: string;
      steps: RecipeStepSnapshot[];
      startUrl?: string | null;
    }
  | { type: 'renameRecipe'; recipeId: string; name: string }
  | { type: 'setRecipeEnabled'; recipeId: string; enabled: boolean }
  | { type: 'deleteRecipe'; recipeId: string }
  /** Saves the https webmail URL used by the Mail section. */
  | { type: 'setMailInboxUrl'; url: string }
  | { type: 'createMailSkill'; name: string; rule: string }
  | { type: 'updateMailSkill'; skillId: string; name?: string; rule?: string }
  | { type: 'setMailSkillEnabled'; skillId: string; enabled: boolean }
  | { type: 'deleteMailSkill'; skillId: string };

export interface WorkspaceCommandResult {
  ok: boolean;
  message?: string;
}

export interface PoppinWorkspaceApi {
  getSnapshot: () => Promise<WorkspaceSnapshot>;
  command: (command: WorkspaceCommand) => Promise<WorkspaceCommandResult>;
  subscribe: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
}
