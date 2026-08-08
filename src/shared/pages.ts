export const PAGES_CHANNELS = {
  command: 'pages:command',
  getSnapshot: 'pages:get-snapshot',
  getPage: 'pages:get-page',
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
}

export type PagesCommand =
  | { type: 'createPage'; title: string; parentId?: string | null; kind: PageKind }
  | { type: 'renamePage'; pageId: string; title: string }
  | { type: 'movePage'; pageId: string; parentId: string | null }
  | { type: 'deletePage'; pageId: string }
  | { type: 'addBlock'; pageId: string; blockType: string; content: PageJsonValue; position?: number }
  | { type: 'updateBlock'; blockId: string; expectedVersion: number; content: PageJsonValue }
  | { type: 'addComment'; pageId: string; blockId: string; selectionQuote: string; instruction: string; start?: number | null; end?: number | null }
  | { type: 'resolveComment'; commentId: string }
  | { type: 'addDatabaseProperty'; databaseId: string; name: string; propertyType: DatabasePropertyType; options?: PageJsonValue[]; position?: number }
  | { type: 'addDatabaseRow'; databaseId: string; properties: Record<string, PageJsonValue>; position?: number }
  | { type: 'addDatabaseView'; databaseId: string; name: string; viewType?: DatabaseViewType; filters?: PageJsonValue[]; sorts?: PageJsonValue[]; viewState?: Record<string, PageJsonValue>; position?: number }
  | { type: 'saveViewState'; pageId: string; state: Record<string, PageJsonValue> };

export interface PagesCommandResult {
  ok: boolean;
  message?: string;
  id?: string;
}

export interface PoppinPagesApi {
  getSnapshot: () => Promise<PagesSnapshot>;
  getPage: (pageId: string) => Promise<PageDocumentSnapshot | null>;
  command: (command: PagesCommand) => Promise<PagesCommandResult>;
  subscribe: (listener: (snapshot: PagesSnapshot) => void) => () => void;
}
