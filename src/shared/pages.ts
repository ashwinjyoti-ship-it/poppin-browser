export const PAGES_CHANNELS = {
  command: 'pages:command',
  getSnapshot: 'pages:get-snapshot',
  getPage: 'pages:get-page',
  exportPage: 'pages:export-page',
  snapshot: 'pages:snapshot',
} as const;

export type PageKind = 'page' | 'database';
export type PageCommentStatus = 'open' | 'resolved';
export type DatabasePropertyType = 'text' | 'number' | 'date' | 'select' | 'multi_select' | 'relation' | 'checkbox';
export type DatabaseViewType = 'table' | 'board' | 'calendar';
export type PageJsonValue = null | boolean | number | string | PageJsonValue[] | { [key: string]: PageJsonValue };

export interface PageSnapshot {
  id: string;
  title: string;
  parentId: string | null;
  kind: PageKind;
  createdAt: string;
  updatedAt: string;
}

export interface PageBlockSnapshot {
  id: string;
  pageId: string;
  type: string;
  content: PageJsonValue;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageCommentSelectionSnapshot {
  quote: string;
  hash: string;
  blockVersion: number;
  start: number | null;
  end: number | null;
}

export interface PageCommentSnapshot {
  id: string;
  pageId: string;
  blockId: string;
  selection: PageCommentSelectionSnapshot;
  instruction: string;
  status: PageCommentStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface DatabasePropertySnapshot {
  id: string;
  databaseId: string;
  name: string;
  type: DatabasePropertyType;
  options: PageJsonValue[];
  position: number;
}

export interface DatabaseRowSnapshot {
  id: string;
  databaseId: string;
  properties: Record<string, PageJsonValue>;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseViewSnapshot {
  id: string;
  databaseId: string;
  name: string;
  viewType: DatabaseViewType;
  filters: PageJsonValue[];
  sorts: PageJsonValue[];
  viewState: Record<string, PageJsonValue>;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageViewStateSnapshot {
  pageId: string;
  kind: PageKind;
  state: Record<string, PageJsonValue>;
  updatedAt: string;
}

export interface NativePageTabSnapshot {
  id: string;
  pageId: string;
  kind: PageKind;
  title: string;
  position: number;
}

export interface PageDocumentSnapshot {
  page: PageSnapshot;
  blocks: PageBlockSnapshot[];
  comments: PageCommentSnapshot[];
  viewState: PageViewStateSnapshot | null;
  database: {
    properties: DatabasePropertySnapshot[];
    rows: DatabaseRowSnapshot[];
    views: DatabaseViewSnapshot[];
  } | null;
}

export interface PagesSnapshot {
  pages: PageSnapshot[];
  tabs: NativePageTabSnapshot[];
  activeTabId: string | null;
  selectedPageIds: string[];
}

export type PagesCommand =
  | { type: 'createPage'; title: string; parentId?: string | null; kind: PageKind }
  | { type: 'openMemory' }
  | { type: 'renamePage'; pageId: string; title: string }
  | { type: 'movePage'; pageId: string; parentId: string | null }
  | { type: 'deletePage'; pageId: string }
  | { type: 'openPage'; pageId: string }
  | { type: 'activateTab'; tabId: string }
  | { type: 'deactivateTabs' }
  | { type: 'closeTab'; tabId: string }
  | { type: 'reorderTab'; tabId: string; beforeTabId: string | null }
  | { type: 'setPageSelected'; pageId: string; selected: boolean }
  | { type: 'addBlock'; pageId: string; blockType: string; content: PageJsonValue; position?: number }
  | { type: 'updateBlock'; blockId: string; expectedVersion: number; content: PageJsonValue }
  | { type: 'addComment'; pageId: string; blockId: string; selectionQuote: string; instruction: string; start?: number | null; end?: number | null }
  | { type: 'resolveComment'; commentId: string }
  | { type: 'applyComment'; commentId: string; replacement: string }
  | { type: 'addDatabaseProperty'; databaseId: string; name: string; propertyType: DatabasePropertyType; options?: PageJsonValue[]; position?: number }
  | { type: 'addDatabaseRow'; databaseId: string; properties: Record<string, PageJsonValue>; position?: number }
  | { type: 'updateDatabaseRow'; rowId: string; properties: Record<string, PageJsonValue> }
  | { type: 'deleteDatabaseRow'; rowId: string }
  | { type: 'addDatabaseView'; databaseId: string; name: string; viewType?: DatabaseViewType; filters?: PageJsonValue[]; sorts?: PageJsonValue[]; viewState?: Record<string, PageJsonValue>; position?: number }
  | { type: 'saveViewState'; pageId: string; state: Record<string, PageJsonValue> }
  /**
   * Append a Markdown-formatted block to the encrypted Memory page, creating
   * Memory when it is not yet initialized. Never sends the block to any
   * provider directly; Memory is only surfaced when the user opts it into
   * context via the workspace checkbox.
   */
  | { type: 'appendMemory'; markdown: string };

export interface PagesCommandResult {
  ok: boolean;
  message?: string;
  id?: string;
}

export interface PoppinPagesApi {
  getSnapshot: () => Promise<PagesSnapshot>;
  getPage: (pageId: string) => Promise<PageDocumentSnapshot | null>;
  command: (command: PagesCommand) => Promise<PagesCommandResult>;
  exportPage: (pageId: string, format: 'pdf' | 'docx' | 'xlsx') => Promise<PagesCommandResult>;
  subscribe: (listener: (snapshot: PagesSnapshot) => void) => () => void;
}
