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

export interface BrowserTabSnapshot {
  id: string;
  url: string;
  title: string;
  faviconUrls: string[];
  pinned: boolean;
  groupId: string | null;
  taskSpaceId?: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
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

export interface BrowserSnapshot {
  tabs: BrowserTabSnapshot[];
  groups: BrowserTabGroup[];
  activeTabId: string;
  isFullScreen: boolean;
  canReopenClosedTab: boolean;
  settings: BrowserSettings;
  authenticationPopup: { title: string; url: string } | null;
  linkPreview: { title: string; url: string } | null;
}

export type BrowserCommand =
  | { type: 'create'; input?: string }
  | { type: 'activate'; tabId: string }
  | { type: 'close'; tabId: string }
  | { type: 'navigate'; tabId: string; input: string }
  | { type: 'back'; tabId: string }
  | { type: 'forward'; tabId: string }
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
  | { type: 'setContentVisible'; visible: boolean }
  | { type: 'setLayout'; topInset: number; leftInset: number; rightInset: number; bottomInset: number };

export interface BrowserCommandResult {
  ok: boolean;
  message?: string;
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
