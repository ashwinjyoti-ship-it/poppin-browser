/**
 * Tandem is a separate product (`unified-doc-management`). Poppin hosts it and
 * connects to it; it never re-implements it.
 *
 * Humans reach Tandem through Tandem World (the real Tandem UI inside Poppin).
 * Agents reach Tandem through this capability, which speaks the Tandem REST API.
 * Agents must never click around Tandem World to do what the API can do.
 */

export const TANDEM_CHANNELS = {
  command: 'tandem:command',
  getSnapshot: 'tandem:get-snapshot',
  snapshot: 'tandem:snapshot',
} as const;

export type TandemConnectionState = 'disconnected' | 'connecting' | 'ready' | 'error';

export interface TandemWorkspaceSnapshot {
  id: string;
  name: string;
}

export type TandemPageKind = 'page' | 'folder' | 'database' | 'canvas';

export interface TandemPageSnapshot {
  id: string;
  title: string;
  kind: TandemPageKind;
  parentId: string | null;
  icon: string | null;
  updatedAt: string | null;
}

/**
 * A frozen copy of a Tandem page, captured when the user checked it. Tandem
 * stays the source of truth; Poppin only stores the reference and the snapshot.
 */
export interface TandemContextSnapshot {
  sourceType: 'tandem-page';
  workspaceId: string;
  pageId: string;
  title: string;
  updatedAt: string | null;
  capturedMarkdown: string;
  capturedAt: string;
  truncated: boolean;
  /** Set when the page changed in Tandem after this snapshot was frozen. */
  stale: boolean;
}

export interface TandemSnapshot {
  connection: {
    state: TandemConnectionState;
    message: string;
    baseUrl: string | null;
    /** True when Poppin holds a Tandem credential in the OS keychain. */
    hasCredential: boolean;
    accountLabel: string | null;
    writable: boolean;
  };
  workspaces: TandemWorkspaceSnapshot[];
  activeWorkspaceId: string | null;
  pages: TandemPageSnapshot[];
  recent: TandemPageSnapshot[];
  searchQuery: string;
  searchResults: TandemPageSnapshot[];
  /** Only these pages are sent to the agent. */
  selected: TandemContextSnapshot[];
  worldOpen: boolean;
}

export type TandemCommand =
  | { type: 'connect'; baseUrl: string; apiKey: string }
  | { type: 'disconnect' }
  | { type: 'refreshConnection' }
  | { type: 'selectWorkspace'; workspaceId: string }
  | { type: 'search'; query: string }
  | { type: 'setPageSelected'; pageId: string; selected: boolean }
  | { type: 'refreshContext' }
  | { type: 'openWorld'; pageId?: string }
  | { type: 'closeWorld' };

export interface TandemCommandResult {
  ok: boolean;
  message?: string;
}

export interface PoppinTandemApi {
  getSnapshot: () => Promise<TandemSnapshot>;
  command: (command: TandemCommand) => Promise<TandemCommandResult>;
  subscribe: (listener: (snapshot: TandemSnapshot) => void) => () => void;
}

export const EMPTY_TANDEM_SNAPSHOT: TandemSnapshot = {
  connection: { state: 'disconnected', message: 'Connect Tandem to use it in Poppin.', baseUrl: null, hasCredential: false, accountLabel: null, writable: false },
  workspaces: [],
  activeWorkspaceId: null,
  pages: [],
  recent: [],
  searchQuery: '',
  searchResults: [],
  selected: [],
  worldOpen: false,
};

/** Poppin's host/theme signal to Tandem. Tandem keeps its own IA and design. */
export const TANDEM_HOST_PARAM = 'host';
export const TANDEM_HOST_VALUE = 'poppin';

/** Tandem uses a browser router, so a page deep link is `/page/{id}`. */
export function tandemWorldUrl(baseUrl: string, pageId?: string): string {
  const url = new URL(pageId ? `/page/${encodeURIComponent(pageId)}` : '/', baseUrl);
  url.searchParams.set(TANDEM_HOST_PARAM, TANDEM_HOST_VALUE);
  return url.toString();
}
