import { randomUUID } from 'node:crypto';

import {
  app,
  BrowserWindow,
  type Input,
  type Rectangle,
  type Session,
  WebContentsView,
} from 'electron';

import {
  BROWSER_CHANNELS,
  type BrowserCommand,
  type BrowserCommandResult,
  type BrowserSnapshot,
  type BrowserTabSnapshot,
  type PersistedBrowserStateV1,
  type WindowState,
} from '../../shared/browser';
import { errorPageUrl } from './internal-pages';
import { BrowserStateStore } from './state-store';
import { displayUrl, NEW_TAB_URL, normalizeAddressInput } from './url-input';
import type { CapturedTabContext } from '../../shared/workspace';

const PAGE_MARGIN = 12;
const CHROME_HEIGHT = 140;
const SAVE_DELAY_MS = 250;
const MAX_LAYOUT_INSET = 520;
const MAX_TAB_CONTEXT_CHARACTERS = 60_000;

interface BrowserTabRecord {
  view: WebContentsView;
  snapshot: BrowserTabSnapshot;
  lastExternalUrl: string;
}

interface RestoredBrowserState {
  tabs: Array<{ id: string; url: string }>;
  activeTabId: string;
}

export class BrowserEngine {
  private readonly tabs = new Map<string, BrowserTabRecord>();
  private activeTabId = '';
  private saveTimer: NodeJS.Timeout | null = null;
  private isClosing = false;
  private viewInsets = { left: 0, right: 0, bottom: 0 };

  constructor(
    private readonly window: BrowserWindow,
    private readonly browserSession: Session,
    private readonly stateStore: BrowserStateStore,
    private readonly getWindowState: () => WindowState,
  ) {
    this.window.on('resize', () => this.layoutViews());
    this.window.on('closed', () => {
      this.isClosing = true;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      for (const tab of this.tabs.values()) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      }
      this.tabs.clear();
    });
  }

  restore(state: RestoredBrowserState | null): void {
    const tabs: Array<{ id: string; url: string }> = state?.tabs.length
      ? state.tabs
      : [{ id: randomUUID(), url: NEW_TAB_URL }];
    for (const tab of tabs) this.createTab(tab.url, tab.id, false);
    this.activateTab(state?.activeTabId && this.tabs.has(state.activeTabId) ? state.activeTabId : tabs[0]!.id);
  }

  getSnapshot(): BrowserSnapshot {
    return {
      tabs: Array.from(this.tabs.values(), ({ snapshot }) => ({ ...snapshot })),
      activeTabId: this.activeTabId,
    };
  }

  async captureTabContext(tabId: string): Promise<CapturedTabContext | null> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) return null;
    const currentUrl = tab.view.webContents.getURL();
    if (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://')) return null;
    try {
      const captured = await tab.view.webContents.executeJavaScript(`(() => {
        const text = document.body?.innerText ?? '';
        return {
          title: document.title || location.hostname,
          url: location.href,
          text: text.slice(0, ${MAX_TAB_CONTEXT_CHARACTERS + 1})
        };
      })()`);
      if (!isCapturedPage(captured)) return null;
      const normalizedText = captured.text.replace(/\r\n/g, '\n').trim();
      return {
        title: captured.title.slice(0, 300),
        url: captured.url,
        text: normalizedText.slice(0, MAX_TAB_CONTEXT_CHARACTERS),
        truncated: normalizedText.length > MAX_TAB_CONTEXT_CHARACTERS,
      };
    } catch {
      return null;
    }
  }

  async execute(command: BrowserCommand): Promise<BrowserCommandResult> {
    switch (command.type) {
      case 'create':
        this.createTab(command.input);
        return { ok: true };
      case 'activate':
        return this.activateTab(command.tabId);
      case 'close':
        return this.closeTab(command.tabId);
      case 'navigate':
        return this.navigate(command.tabId, command.input);
      case 'back':
        return this.goBack(command.tabId);
      case 'forward':
        return this.goForward(command.tabId);
      case 'reload':
        return this.reload(command.tabId);
      case 'setLayout':
        this.viewInsets = {
          left: clampInset(command.leftInset),
          right: clampInset(command.rightInset),
          bottom: clampInset(command.bottomInset),
        };
        this.layoutViews();
        return { ok: true };
    }
  }

  scheduleSave(): void {
    if (this.isClosing) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (this.tabs.size === 0) return;
    const state: PersistedBrowserStateV1 = {
      version: 1,
      tabs: Array.from(this.tabs.values(), (tab) => ({
        id: tab.snapshot.id,
        url: tab.lastExternalUrl || NEW_TAB_URL,
      })),
      activeTabId: this.activeTabId,
      window: this.getWindowState(),
    };
    await this.stateStore.save(state);
  }

  handleShortcut(input: Input): boolean {
    if (input.type !== 'keyDown' || !input.meta || input.alt || input.control) return false;
    const key = input.key.toLowerCase();
    if (key === 'l') {
      this.window.webContents.send(BROWSER_CHANNELS.focusAddress);
      return true;
    }
    if (key === 't') {
      this.createTab();
      return true;
    }
    if (key === 'w') {
      void this.closeTab(this.activeTabId);
      return true;
    }
    if (key === 'r') {
      void this.reload(this.activeTabId);
      return true;
    }
    return false;
  }

  private createTab(input = '', id: string = randomUUID(), focusAddress = true): string {
    const normalized = normalizeAddressInput(input);
    const initialUrl = normalized.kind === 'invalid' ? NEW_TAB_URL : normalized.url;
    const view = new WebContentsView({
      webPreferences: {
        session: this.browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: !app.isPackaged,
      },
    });
    view.setBorderRadius(18);
    view.setBackgroundColor('#fbf8f2');
    view.setVisible(false);

    const snapshot: BrowserTabSnapshot = {
      id,
      url: displayUrl(initialUrl),
      title: initialUrl === NEW_TAB_URL ? 'New Tab' : 'Loading…',
      faviconUrl: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      failure: null,
    };
    const record: BrowserTabRecord = { view, snapshot, lastExternalUrl: initialUrl };
    this.tabs.set(id, record);
    this.window.contentView.addChildView(view);
    this.attachTabEvents(record);
    this.activateTab(id);
    void view.webContents.loadURL(initialUrl).catch(() => undefined);

    if (focusAddress && initialUrl === NEW_TAB_URL) {
      this.window.webContents.send(BROWSER_CHANNELS.focusAddress);
    }
    this.emitSnapshot();
    this.scheduleSave();
    return id;
  }

  private attachTabEvents(tab: BrowserTabRecord): void {
    const contents = tab.view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      this.createTab(url, randomUUID(), false);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      const protocol = safeProtocol(url);
      if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'poppin:') {
        event.preventDefault();
      }
    });
    contents.on('before-input-event', (event, input) => {
      if (this.handleShortcut(input)) event.preventDefault();
    });
    contents.on('did-start-loading', () => this.updateTab(tab, { isLoading: true, failure: null }));
    contents.on('did-stop-loading', () => {
      this.syncNavigationState(tab);
      this.updateTab(tab, { isLoading: false });
    });
    contents.on('did-navigate', (_event, url) => this.handleNavigation(tab, url));
    contents.on('did-navigate-in-page', (_event, url) => this.handleNavigation(tab, url));
    contents.on('page-title-updated', (_event, title) => {
      if (!contents.getURL().startsWith('poppin://error')) this.updateTab(tab, { title: title || 'Untitled' });
    });
    contents.on('page-favicon-updated', (_event, favicons) => {
      this.updateTab(tab, { faviconUrl: favicons[0] ?? null });
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || url.startsWith('poppin://')) return;
      const failure = { code, description, url };
      tab.lastExternalUrl = url;
      this.updateTab(tab, {
        url,
        title: 'Page unavailable',
        failure,
        isLoading: false,
        faviconUrl: null,
      });
      void contents.loadURL(errorPageUrl(url, code, description));
    });
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      this.updateTab(tab, {
        title: 'Tab crashed',
        isLoading: false,
        failure: { code: -1, description: 'The page stopped responding.', url: tab.lastExternalUrl },
      });
    });
  }

  private handleNavigation(tab: BrowserTabRecord, url: string): void {
    if (url.startsWith('poppin://error')) return;
    const isNewTab = url.startsWith('poppin://new-tab');
    tab.lastExternalUrl = isNewTab ? NEW_TAB_URL : url;
    this.syncNavigationState(tab);
    this.updateTab(tab, {
      url: displayUrl(url),
      title: isNewTab ? 'New Tab' : tab.snapshot.title,
      failure: null,
    });
    this.scheduleSave();
  }

  private activateTab(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is no longer available.' };
    for (const [id, candidate] of this.tabs) candidate.view.setVisible(id === tabId);
    this.activeTabId = tabId;
    this.layoutViews();
    tab.view.webContents.focus();
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private closeTab(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is already closed.' };
    const orderedIds = Array.from(this.tabs.keys());
    const closingIndex = orderedIds.indexOf(tabId);
    this.window.contentView.removeChildView(tab.view);
    this.tabs.delete(tabId);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

    if (this.tabs.size === 0) {
      this.createTab();
      return { ok: true };
    }
    if (this.activeTabId === tabId) {
      const remainingIds = Array.from(this.tabs.keys());
      this.activateTab(remainingIds[Math.min(closingIndex, remainingIds.length - 1)]!);
    } else {
      this.emitSnapshot();
      this.scheduleSave();
    }
    return { ok: true };
  }

  private navigate(tabId: string, input: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is no longer available.' };
    const normalized = normalizeAddressInput(input);
    if (normalized.kind === 'invalid') return { ok: false, message: normalized.message };
    tab.snapshot.failure = null;
    // A page can intentionally replace or redirect its initial navigation. Electron
    // rejects the superseded loadURL promise with ERR_ABORTED even when the final
    // page succeeds, so command acceptance must not be treated as load completion.
    // Genuine failures are handled by did-fail-load and shown in the tab itself.
    void tab.view.webContents.loadURL(normalized.url).catch(() => undefined);
    return { ok: true };
  }

  private goBack(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab?.view.webContents.navigationHistory.canGoBack()) return { ok: false };
    tab.view.webContents.navigationHistory.goBack();
    return { ok: true };
  }

  private goForward(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab?.view.webContents.navigationHistory.canGoForward()) return { ok: false };
    tab.view.webContents.navigationHistory.goForward();
    return { ok: true };
  }

  private reload(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false };
    if (tab.snapshot.failure) {
      void tab.view.webContents.loadURL(tab.lastExternalUrl);
    } else {
      tab.view.webContents.reload();
    }
    return { ok: true };
  }

  private updateTab(tab: BrowserTabRecord, updates: Partial<BrowserTabSnapshot>): void {
    Object.assign(tab.snapshot, updates);
    this.syncNavigationState(tab);
    this.emitSnapshot();
  }

  private syncNavigationState(tab: BrowserTabRecord): void {
    if (tab.view.webContents.isDestroyed()) return;
    tab.snapshot.canGoBack = tab.view.webContents.navigationHistory.canGoBack();
    tab.snapshot.canGoForward = tab.view.webContents.navigationHistory.canGoForward();
  }

  private emitSnapshot(): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(BROWSER_CHANNELS.snapshot, this.getSnapshot());
    }
  }

  private layoutViews(): void {
    if (this.window.isDestroyed()) return;
    const [width = 1, height = 1] = this.window.getContentSize();
    const bounds: Rectangle = {
      x: PAGE_MARGIN + this.viewInsets.left,
      y: CHROME_HEIGHT,
      width: Math.max(1, width - PAGE_MARGIN * 2 - this.viewInsets.left - this.viewInsets.right),
      height: Math.max(1, height - CHROME_HEIGHT - PAGE_MARGIN - this.viewInsets.bottom),
    };
    for (const tab of this.tabs.values()) tab.view.setBounds(bounds);
  }
}

function clampInset(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_LAYOUT_INSET, Math.max(0, Math.round(value))) : 0;
}

function isCapturedPage(value: unknown): value is { title: string; url: string; text: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === 'string' && typeof candidate.url === 'string' && typeof candidate.text === 'string';
}

function safeProtocol(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return '';
  }
}
