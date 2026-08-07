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
  faviconUrl: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  failure: BrowserFailure | null;
}

export interface BrowserSnapshot {
  tabs: BrowserTabSnapshot[];
  activeTabId: string;
}

export type BrowserCommand =
  | { type: 'create'; input?: string }
  | { type: 'activate'; tabId: string }
  | { type: 'close'; tabId: string }
  | { type: 'navigate'; tabId: string; input: string }
  | { type: 'back'; tabId: string }
  | { type: 'forward'; tabId: string }
  | { type: 'reload'; tabId: string }
  | { type: 'showGoogleSignInAlternatives'; tabId: string }
  | { type: 'setLayout'; leftInset: number; rightInset: number; bottomInset: number };

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
}

export interface PersistedBrowserStateV1 {
  version: 1;
  tabs: PersistedTabState[];
  activeTabId: string;
  window: WindowState;
}

export interface PoppinBrowserApi {
  getSnapshot: () => Promise<BrowserSnapshot>;
  command: (command: BrowserCommand) => Promise<BrowserCommandResult>;
  subscribe: (listener: (snapshot: BrowserSnapshot) => void) => () => void;
  onFocusAddress: (listener: () => void) => () => void;
}
