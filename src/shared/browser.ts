export const BROWSER_CHANNELS = {
  command: 'browser:command',
  focusAddress: 'browser:focus-address',
  getSnapshot: 'browser:get-snapshot',
  snapshot: 'browser:snapshot',
} as const;

export interface BrowserFailure {
  code: number;
  description: string;
  url: string;
}

/** One entry from a tab's in-session navigation history. */
export interface BrowserHistoryEntry {
  index: number;
  url: string;
  title: string;
}

/** A URL submitted through the address bar during this browser session. */
export interface BrowserEnteredUrl {
  url: string;
  title: string;
}

export interface BrowserTabSnapshot {
  id: string;
  url: string;
  title: string;
  faviconUrls: string[];
  pinned: boolean;
  groupId: string | null;
  taskSpaceId?: string | null;
  /** Dedicated hosted integration surface; ordinary remote pages omit this. */
  surface?: 'tandem-world';
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Current index into `history` for this tab's session. */
  historyIndex: number;
  /** Back/forward stack for this tab (session only; not cross-profile). */
  history: BrowserHistoryEntry[];
  failure: BrowserFailure | null;
}

export type BrowserGroupColor = 'amber' | 'blue' | 'green' | 'rose' | 'violet';

export interface BrowserTabGroup {
  id: string;
  name: string;
  color: BrowserGroupColor;
  collapsed: boolean;
}

export type LinkOpeningPreference = 'follow-site' | 'new-tab' | 'same-tab';
export type StartupPreference = 'restore' | 'new-tab';
export type NewTabPositionPreference = 'next-to-active' | 'end';
export type SearchEnginePreference = 'duckduckgo' | 'google';

export interface BrowserSettings {
  linkOpening: LinkOpeningPreference;
  focusNewTabs: boolean;
  startup: StartupPreference;
  newTabPosition: NewTabPositionPreference;
  warnBeforeClosingMultipleTabs: boolean;
  searchEngine: SearchEnginePreference;
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  linkOpening: 'new-tab',
  focusNewTabs: true,
  startup: 'restore',
  newTabPosition: 'next-to-active',
  warnBeforeClosingMultipleTabs: false,
  searchEngine: 'duckduckgo',
};

/** Sticky centre split: two live WebContentsViews side by side. */
export type BrowserSplitMode = 'sticky' | 'peek-compare' | 'tandem-beside';

export interface BrowserSplitSnapshot {
  mode: BrowserSplitMode;
  primaryTabId: string;
  secondaryTabId: string;
  /** Which pane owns the address bar / navigation chrome. */
  focusedSide: 'primary' | 'secondary';
  /** Primary pane width as a fraction of the content area (0.28–0.72). */
  ratio: number;
}

export interface TabSearchMatch {
  tabId: string;
  title: string;
  url: string;
  snippet: string;
  matchKind: 'title' | 'url' | 'content';
}

export interface BrowserSnapshot {
  tabs: BrowserTabSnapshot[];
  groups: BrowserTabGroup[];
  activeTabId: string;
  isFullScreen: boolean;
  canReopenClosedTab: boolean;
  settings: BrowserSettings;
  /** URLs entered in the address bar this session (newest first). */
  enteredUrls: BrowserEnteredUrl[];
  authenticationPopup: { title: string; url: string } | null;
  linkPreview: { title: string; url: string } | null;
  /** Dual live-page layout; null when only one centre surface is shown. */
  split: BrowserSplitSnapshot | null;
}

export type BrowserCommand =
  | { type: 'create'; input?: string }
  | { type: 'activate'; tabId: string }
  | { type: 'close'; tabId: string }
  | { type: 'navigate'; tabId: string; input: string }
  | { type: 'back'; tabId: string }
  | { type: 'forward'; tabId: string }
  | { type: 'goToHistoryIndex'; tabId: string; index: number }
  | { type: 'reload'; tabId: string }
  | { type: 'duplicate'; tabId: string }
  | { type: 'reopenClosedTab' }
  | { type: 'reorder'; tabId: string; beforeTabId: string | null }
  | { type: 'togglePin'; tabId: string }
  | { type: 'createGroup'; tabId: string }
  | { type: 'moveToGroup'; tabId: string; groupId: string | null }
  | { type: 'toggleGroup'; groupId: string }
  | { type: 'renameGroup'; groupId: string; name: string }
  | { type: 'setGroupColor'; groupId: string; color: BrowserGroupColor }
  | { type: 'showTabMenu'; tabId: string }
  | { type: 'showGroupMenu'; groupId: string }
  | { type: 'updateSettings'; settings: Partial<BrowserSettings> }
  | { type: 'cancelAuthenticationPopup' }
  | { type: 'closeLinkPreview' }
  | { type: 'openLinkPreviewInTab' }
  /** Promote the current link Peek into a sticky/peek-compare split beside the source page. */
  | { type: 'openLinkPreviewInSplit' }
  /** Open a second live tab beside the active one (sticky split or peek-compare). */
  | { type: 'openSplit'; secondaryTabId: string; mode?: Exclude<BrowserSplitMode, 'tandem-beside'> }
  /** Keep the current page and open/focus Tandem World beside it for annotation. */
  | { type: 'openTandemBeside' }
  | { type: 'closeSplit' }
  | { type: 'setSplitRatio'; ratio: number }
  | { type: 'focusSplitSide'; side: 'primary' | 'secondary' }
  | { type: 'swapSplit' }
  /** Local find across currently open tabs (title, URL, and bounded page text). */
  | { type: 'searchOpenTabs'; query: string }
  | { type: 'setContentVisible'; visible: boolean }
  | { type: 'setLayout'; topInset: number; leftInset: number; rightInset: number; bottomInset: number };

export interface BrowserCommandResult {
  ok: boolean;
  message?: string;
  tabSearchResults?: TabSearchMatch[];
}

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface PersistedTabState {
  id: string;
  url: string;
  pinned?: boolean;
  groupId?: string | null;
  taskSpaceId?: string | null;
  surface?: 'tandem-world';
}

export interface PersistedBrowserStateV1 {
  version: 1;
  tabs: PersistedTabState[];
  activeTabId: string;
  window: WindowState;
}

export interface PersistedBrowserStateV2 {
  version: 2;
  tabs: PersistedTabState[];
  groups: BrowserTabGroup[];
  activeTabId: string;
  settings: BrowserSettings;
  window: WindowState;
}

export interface PoppinBrowserApi {
  getSnapshot: () => Promise<BrowserSnapshot>;
  command: (command: BrowserCommand) => Promise<BrowserCommandResult>;
  subscribe: (listener: (snapshot: BrowserSnapshot) => void) => () => void;
  onFocusAddress: (listener: () => void) => () => void;
}
