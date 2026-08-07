import { randomUUID } from 'node:crypto';

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  type Input,
  type MenuItemConstructorOptions,
  type Rectangle,
  type Session,
  WebContentsView,
} from 'electron';

import {
  BROWSER_CHANNELS,
  DEFAULT_BROWSER_SETTINGS,
  type BrowserGroupColor,
  type BrowserCommand,
  type BrowserCommandResult,
  type BrowserSettings,
  type BrowserSnapshot,
  type BrowserTabGroup,
  type BrowserTabSnapshot,
  type PersistedBrowserStateV2,
  type PersistedTabState,
  type WindowState,
} from '../../shared/browser';
import { errorPageUrl } from './internal-pages';
import { BrowserStateStore } from './state-store';
import { normalizeTabOrder } from './tab-model';
import { displayUrl, NEW_TAB_URL, normalizeAddressInput, normalizeTabInput, TASK_RESULT_URL } from './url-input';
import type { CapturedTabContext } from '../../shared/workspace';
import type { VisualSelectionSnapshot } from '../../shared/workspace';
import { HtmlFullscreenCoordinator, type HtmlFullscreenTransition } from './html-fullscreen';
import type { BrowserAgentAction } from '../../shared/browser-agent';
import { showPageContextMenu } from './context-menu';

const PAGE_MARGIN = 12;
const DEFAULT_CHROME_HEIGHT = 103;
const SAVE_DELAY_MS = 250;
const MAX_LAYOUT_INSET = 520;
const MAX_TAB_CONTEXT_CHARACTERS = 60_000;
const CLOSED_TAB_LIMIT = 12;
const GROUP_COLORS: BrowserGroupColor[] = ['amber', 'blue', 'green', 'rose', 'violet'];

interface BrowserTabRecord {
  view: WebContentsView;
  snapshot: BrowserTabSnapshot;
  lastExternalUrl: string;
}

type ClosedTab = PersistedTabState;

export class BrowserEngine {
  private readonly tabs = new Map<string, BrowserTabRecord>();
  private tabOrder: string[] = [];
  private readonly groups = new Map<string, BrowserTabGroup>();
  private readonly closedTabs: ClosedTab[] = [];
  private readonly faviconByOrigin = new Map<string, string[]>();
  private settings: BrowserSettings = { ...DEFAULT_BROWSER_SETTINGS };
  private activeTabId = '';
  private saveTimer: NodeJS.Timeout | null = null;
  private isClosing = false;
  private readonly htmlFullscreen = new HtmlFullscreenCoordinator();
  private viewInsets = { top: DEFAULT_CHROME_HEIGHT, left: 0, right: 0, bottom: 0 };
  private closeConfirmed = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly browserSession: Session,
    private readonly stateStore: BrowserStateStore,
    private readonly getWindowState: () => WindowState,
  ) {
    this.window.on('resize', () => this.layoutViews());
    this.window.on('enter-full-screen', () => {
      this.applyFullscreenTransition(this.htmlFullscreen.windowDidEnter());
      this.layoutViews();
    });
    this.window.on('leave-full-screen', () => {
      const tabId = this.htmlFullscreen.windowDidLeave();
      const tab = tabId ? this.tabs.get(tabId) : null;
      if (tab && !tab.view.webContents.isDestroyed()) {
        void tab.view.webContents.executeJavaScript('if (document.fullscreenElement) void document.exitFullscreen()').catch(() => undefined);
      }
      this.layoutViews();
    });
    this.window.on('close', (event) => {
      if (this.closeConfirmed || !this.settings.warnBeforeClosingMultipleTabs || this.tabs.size < 2) return;
      event.preventDefault();
      void dialog.showMessageBox(this.window, {
        type: 'question',
        title: 'Close Poppin Browser?',
        message: `Close ${this.tabs.size} tabs?`,
        detail: 'Your open tabs are saved and can be restored the next time Poppin starts.',
        buttons: ['Cancel', 'Close tabs'],
        defaultId: 0,
        cancelId: 0,
      }).then(({ response }) => {
        if (response !== 1 || this.window.isDestroyed()) return;
        this.closeConfirmed = true;
        this.window.close();
      });
    });
    this.window.on('closed', () => {
      this.isClosing = true;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      for (const tab of this.tabs.values()) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      }
      this.tabs.clear();
    });
  }

  restore(state: PersistedBrowserStateV2 | null): void {
    this.settings = state ? { ...state.settings } : { ...DEFAULT_BROWSER_SETTINGS };
    for (const group of state?.groups ?? []) this.groups.set(group.id, { ...group });
    const shouldRestore = state?.settings.startup !== 'new-tab';
    const tabs: PersistedTabState[] = shouldRestore && state?.tabs.length
      ? state.tabs
      : [{ id: randomUUID(), url: NEW_TAB_URL, pinned: false, groupId: null }];
    for (const tab of tabs) this.createTab(tab.url, tab.id, false, tab, false, 'end');
    this.activateTab(shouldRestore && state?.activeTabId && this.tabs.has(state.activeTabId) ? state.activeTabId : tabs[0]!.id);
  }

  getSnapshot(): BrowserSnapshot {
    return {
      tabs: this.tabOrder.flatMap((id) => {
        const tab = this.tabs.get(id);
        return tab ? [{ ...tab.snapshot, faviconUrls: [...tab.snapshot.faviconUrls] }] : [];
      }),
      groups: Array.from(this.groups.values(), (group) => ({ ...group })),
      activeTabId: this.activeTabId,
      isFullScreen: this.window.isFullScreen(),
      canReopenClosedTab: this.closedTabs.length > 0,
      settings: { ...this.settings },
    };
  }

  openExternalUrl(url: string): void {
    const normalized = normalizeAddressInput(url);
    if (normalized.kind !== 'url') return;
    this.createTab(normalized.url, randomUUID(), false, undefined, true, 'end');
  }

  openTaskResult(): void {
    const existing = this.tabOrder.map((id) => this.tabs.get(id)).find((tab) => tab?.lastExternalUrl === TASK_RESULT_URL);
    if (existing) {
      this.activateTab(existing.snapshot.id);
      existing.view.webContents.reloadIgnoringCache();
      return;
    }
    this.createTab(TASK_RESULT_URL, randomUUID(), false);
  }

  hasTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    return Boolean(tab && !tab.view.webContents.isDestroyed());
  }

  describeTab(tabId: string): string {
    const tab = this.tabs.get(tabId);
    return tab ? `${tab.snapshot.title} — ${tab.snapshot.url}` : 'Selected browser tab';
  }

  activateTabForAgent(tabId: string): boolean {
    return this.activateTab(tabId).ok;
  }

  async inspectAction(tabId: string, action: BrowserAgentAction): Promise<{ credential: boolean; consequential: string | null; target: string }> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) throw new Error('That tab is no longer available.');
    if (action.type !== 'click' && action.type !== 'type') {
      return { credential: false, consequential: null, target: agentActionTarget(action) };
    }
    const selector = JSON.stringify(action.selector);
    const inspected = await tab.view.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${selector});
      if (!(element instanceof HTMLElement)) return null;
      const input = element instanceof HTMLInputElement ? element : element.querySelector('input');
      const descriptor = [
        element.id, element.getAttribute('name'), element.getAttribute('aria-label'),
        element.getAttribute('autocomplete'), input?.type, input?.name, input?.autocomplete
      ].filter(Boolean).join(' ');
      const text = (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().slice(0, 240);
      const href = element instanceof HTMLAnchorElement ? element.href : element.closest('a')?.href || '';
      const form = element.closest('form');
      const credential = /password|passkey|credential|one[-_ ]?time|otp|verification[-_ ]?code/i.test(descriptor)
        || input?.type === 'password';
      let consequential = null;
      const signal = [text, href, form?.action || '', descriptor].join(' ');
      if (element.hasAttribute('download') || /\\b(download|upload|purchase|pay|buy|delete|trash|discard|publish|send|submit|sign[- ]?in|log[- ]?in|merge|create (?:pull request|record)|remove (?:account|message|draft|file|record|item))\\b/i.test(signal)) {
        consequential = 'This action may cause an external or irreversible effect.';
      }
      return { credential, consequential, target: text || href || element.tagName.toLowerCase() };
    })()`.replace('actionType', JSON.stringify(action.type)), true);
    if (!inspected || typeof inspected !== 'object') throw new Error('The target element is no longer available.');
    const value = inspected as { credential?: unknown; consequential?: unknown; target?: unknown };
    return {
      credential: value.credential === true,
      consequential: typeof value.consequential === 'string' ? value.consequential : null,
      target: typeof value.target === 'string' ? value.target : action.selector,
    };
  }

  async performAction(tabId: string, action: BrowserAgentAction): Promise<string> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) throw new Error('That tab is no longer available.');
    const contents = tab.view.webContents;
    switch (action.type) {
      case 'navigate': {
        const parsed = new URL(action.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Controlled navigation only supports HTTP and HTTPS.');
        await contents.loadURL(parsed.toString());
        return parsed.toString();
      }
      case 'read':
        return String(await contents.executeJavaScript(READ_VISIBLE_PAGE_SCRIPT, true));
      case 'captureTranscript':
        return String(await contents.executeJavaScript(CAPTURE_TRANSCRIPT_SCRIPT, true));
      case 'click': {
        const clicked = await contents.executeJavaScript(`(() => { const element = document.querySelector(${JSON.stringify(action.selector)}); if (!(element instanceof HTMLElement)) return false; element.click(); return true; })()`, true);
        if (clicked !== true) throw new Error('The target element is no longer available.');
        return `Clicked ${action.selector}`;
      }
      case 'type': {
        const typed = await contents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(action.selector)});
          if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement && element.isContentEditable)) return false;
          const descriptor = [element.id, element.getAttribute('name'), element.getAttribute('aria-label'), element.getAttribute('autocomplete'), element instanceof HTMLInputElement ? element.type : ''].filter(Boolean).join(' ');
          if (/password|passkey|credential|one[-_ ]?time|otp|verification[-_ ]?code/i.test(descriptor)) return 'credential';
          element.focus();
          if (element instanceof HTMLInputElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(element, ${JSON.stringify(action.text)});
          } else if (element instanceof HTMLTextAreaElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            setter?.call(element, ${JSON.stringify(action.text)});
          } else {
            element.textContent = ${JSON.stringify(action.text)};
          }
          element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(action.text)} }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`, true);
        if (typed === 'credential') throw new Error('Poppin never types into credential fields.');
        if (typed !== true) throw new Error('The editable target is no longer available.');
        return `Typed ${action.text.length} character(s)`;
      }
      case 'scroll':
        await contents.executeJavaScript(`window.scrollBy({ top: ${Math.max(-4000, Math.min(4000, Math.round(action.deltaY)))}, behavior: 'smooth' })`, true);
        return `Scrolled ${Math.round(action.deltaY)} pixels`;
      case 'wait': {
        const milliseconds = Math.max(100, Math.min(5_000, Math.round(action.milliseconds)));
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
        return `Waited ${milliseconds} milliseconds`;
      }
      case 'search':
        contents.findInPage(action.text, { findNext: false, forward: true });
        return `Searched the visible page for “${action.text}”`;
    }
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

  async captureVisualSelection(tabId: string): Promise<VisualSelectionSnapshot | null> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) return null;
    const currentUrl = tab.view.webContents.getURL();
    if (!isLocalhostUrl(currentUrl)) throw new Error('Visual selection is limited to localhost previews.');
    this.activateTab(tabId);
    const captured = await tab.view.webContents.executeJavaScript(VISUAL_SELECTION_SCRIPT, true) as unknown;
    if (!isVisualSelectionCapture(captured)) return null;
    const viewBounds = tab.view.getBounds();
    const x = Math.max(0, Math.min(viewBounds.width - 1, Math.floor(captured.boundingBox.x)));
    const y = Math.max(0, Math.min(viewBounds.height - 1, Math.floor(captured.boundingBox.y)));
    const box = {
      x,
      y,
      width: Math.max(1, Math.min(viewBounds.width - x, Math.ceil(captured.boundingBox.width))),
      height: Math.max(1, Math.min(viewBounds.height - y, Math.ceil(captured.boundingBox.height))),
    };
    const screenshot = await tab.view.webContents.capturePage(box);
    return {
      tabId,
      url: currentUrl,
      selector: captured.selector.slice(0, 500),
      html: captured.html.slice(0, 20_000),
      css: Object.fromEntries(Object.entries(captured.css).slice(0, 80).map(([key, value]) => [key.slice(0, 100), value.slice(0, 500)])),
      domContext: captured.domContext.slice(0, 30_000),
      boundingBox: captured.boundingBox,
      screenshotDataUrl: screenshot.toDataURL(),
      capturedAt: new Date().toISOString(),
    };
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
      case 'duplicate':
        return this.duplicateTab(command.tabId);
      case 'reopenClosedTab':
        return this.reopenClosedTab();
      case 'reorder':
        return this.reorderTab(command.tabId, command.beforeTabId);
      case 'togglePin':
        return this.togglePin(command.tabId);
      case 'createGroup':
        return this.createGroup(command.tabId);
      case 'moveToGroup':
        return this.moveToGroup(command.tabId, command.groupId);
      case 'toggleGroup':
        return this.toggleGroup(command.groupId);
      case 'renameGroup':
        return this.renameGroup(command.groupId, command.name);
      case 'setGroupColor':
        return this.setGroupColor(command.groupId, command.color);
      case 'showTabMenu':
        return this.showTabMenu(command.tabId);
      case 'showGroupMenu':
        return this.showGroupMenu(command.groupId);
      case 'updateSettings':
        return this.updateSettings(command.settings);
      case 'openTaskResult':
        this.openTaskResult();
        return { ok: true };
      case 'setLayout':
        this.viewInsets = {
          top: clampInset(command.topInset),
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
    const state: PersistedBrowserStateV2 = {
      version: 2,
      tabs: this.tabOrder.flatMap((id) => {
        const tab = this.tabs.get(id);
        return tab ? [{
          id: tab.snapshot.id,
          url: tab.lastExternalUrl || NEW_TAB_URL,
          pinned: tab.snapshot.pinned,
          groupId: tab.snapshot.groupId,
        }] : [];
      }),
      groups: Array.from(this.groups.values(), (group) => ({ ...group })),
      activeTabId: this.activeTabId,
      settings: { ...this.settings },
      window: this.getWindowState(),
    };
    await this.stateStore.save(state);
  }

  handleShortcut(input: Input): boolean {
    if (input.type !== 'keyDown' || (!input.meta && !input.control) || input.alt) return false;
    const key = input.key.toLowerCase();
    if (key === 'l') {
      this.window.webContents.send(BROWSER_CHANNELS.focusAddress);
      return true;
    }
    if (key === 't') {
      if (input.shift) return this.reopenClosedTab().ok;
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

  private createTab(
    input = '',
    id: string = randomUUID(),
    focusAddress = true,
    persisted?: PersistedTabState,
    activate = true,
    position: 'preferred' | 'end' = 'preferred',
  ): string {
    const normalized = normalizeTabInput(input, this.settings.searchEngine);
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
      faviconUrls: faviconForUrl(initialUrl, this.faviconByOrigin),
      pinned: persisted?.pinned === true,
      groupId: persisted?.groupId ?? null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      failure: null,
    };
    const record: BrowserTabRecord = { view, snapshot, lastExternalUrl: initialUrl };
    this.tabs.set(id, record);
    this.insertTabId(id, position);
    this.window.contentView.addChildView(view);
    this.attachTabEvents(record);
    if (activate) this.activateTab(id);
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
      if (this.settings.linkOpening === 'same-tab') {
        void contents.loadURL(url).catch(() => undefined);
      } else {
        this.createTab(url, randomUUID(), false, undefined, this.settings.focusNewTabs);
      }
      return { action: 'deny' };
    });
    contents.on('context-menu', (_event, params) => {
      showPageContextMenu(this.window, contents, params, {
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        onBack: () => contents.navigationHistory.goBack(),
        onForward: () => contents.navigationHistory.goForward(),
        onReload: () => this.reload(tab.snapshot.id),
        onOpenLink: (url, disposition) => {
          if (disposition === 'current') void contents.loadURL(url).catch(() => undefined);
          else this.createTab(url, randomUUID(), false, undefined, this.settings.focusNewTabs);
        },
        onSearchSelection: (selection) => {
          const search = normalizeAddressInput(selection, this.settings.searchEngine);
          if (search.kind !== 'invalid') this.createTab(search.url, randomUUID(), false, undefined, true);
        },
      });
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
    contents.on('enter-html-full-screen', () => {
      this.applyFullscreenTransition(this.htmlFullscreen.enter(tab.snapshot.id, this.window.isFullScreen()));
      this.layoutViews();
    });
    contents.on('leave-html-full-screen', () => {
      this.applyFullscreenTransition(this.htmlFullscreen.leave(tab.snapshot.id));
      this.layoutViews();
    });
    contents.on('did-start-loading', () => this.updateTab(tab, { isLoading: true, failure: null }));
    contents.on('did-stop-loading', () => {
      this.syncNavigationState(tab);
      this.updateTab(tab, { isLoading: false });
    });
    contents.on('dom-ready', () => this.applyLinkOpeningPreference(tab));
    contents.on('did-navigate', (_event, url) => this.handleNavigation(tab, url, true));
    contents.on('did-navigate-in-page', (_event, url) => this.handleNavigation(tab, url, false));
    contents.on('page-title-updated', (_event, title) => {
      if (!contents.getURL().startsWith('poppin://error')) this.updateTab(tab, { title: title || 'Untitled' });
    });
    contents.on('page-favicon-updated', (_event, favicons) => {
      const candidates = favicons.filter(isSupportedFaviconUrl);
      if (candidates.length === 0) return;
      const origin = safeOrigin(contents.getURL());
      if (origin) this.faviconByOrigin.set(origin, candidates);
      this.updateTab(tab, { faviconUrls: candidates });
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
        faviconUrls: [],
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

  private handleNavigation(tab: BrowserTabRecord, url: string, resetFavicon: boolean): void {
    if (url.startsWith('poppin://error')) return;
    const isNewTab = url.startsWith('poppin://new-tab');
    const previousOrigin = safeOrigin(tab.lastExternalUrl);
    tab.lastExternalUrl = isNewTab ? NEW_TAB_URL : url;
    this.syncNavigationState(tab);
    const nextOrigin = safeOrigin(url);
    this.updateTab(tab, {
      url: displayUrl(url),
      title: isNewTab ? 'New Tab' : tab.snapshot.title,
      failure: null,
      ...(resetFavicon && previousOrigin !== nextOrigin
        ? { faviconUrls: faviconForUrl(url, this.faviconByOrigin) }
        : {}),
    });
    this.scheduleSave();
  }

  private activateTab(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is no longer available.' };
    if (tab.snapshot.groupId) {
      const group = this.groups.get(tab.snapshot.groupId);
      if (group) group.collapsed = false;
    }
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
    const orderedIds = [...this.tabOrder];
    const closingIndex = orderedIds.indexOf(tabId);
    if (tab.lastExternalUrl) {
      this.closedTabs.push({
        id: randomUUID(),
        url: tab.lastExternalUrl,
        pinned: tab.snapshot.pinned,
        groupId: tab.snapshot.groupId,
      });
      if (this.closedTabs.length > CLOSED_TAB_LIMIT) this.closedTabs.shift();
    }
    this.window.contentView.removeChildView(tab.view);
    this.tabs.delete(tabId);
    this.tabOrder = this.tabOrder.filter((id) => id !== tabId);
    this.cleanupEmptyGroups();
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

    if (this.tabs.size === 0) {
      this.createTab();
      return { ok: true };
    }
    if (this.activeTabId === tabId) {
      const remainingIds = [...this.tabOrder];
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
    const normalized = normalizeAddressInput(input, this.settings.searchEngine);
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

  private duplicateTab(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is no longer available.' };
    this.createTab(tab.lastExternalUrl, randomUUID(), false, {
      id: randomUUID(),
      url: tab.lastExternalUrl,
      pinned: false,
      groupId: tab.snapshot.groupId,
    });
    return { ok: true };
  }

  private reopenClosedTab(): BrowserCommandResult {
    const tab = this.closedTabs.pop();
    if (!tab) return { ok: false, message: 'There are no recently closed tabs.' };
    if (tab.groupId && !this.groups.has(tab.groupId)) tab.groupId = null;
    this.createTab(tab.url, tab.id, false, tab);
    return { ok: true };
  }

  private reorderTab(tabId: string, beforeTabId: string | null): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is no longer available.' };
    const target = beforeTabId ? this.tabs.get(beforeTabId) : null;
    if (!tab.snapshot.pinned) tab.snapshot.groupId = target?.snapshot.groupId ?? null;
    const remaining = this.tabOrder.filter((id) => id !== tabId);
    const beforeIndex = beforeTabId ? remaining.indexOf(beforeTabId) : -1;
    const insertionIndex = beforeIndex >= 0 ? beforeIndex : remaining.length;
    remaining.splice(insertionIndex, 0, tabId);
    this.tabOrder = this.normalizeTabOrder(remaining);
    this.cleanupEmptyGroups();
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private togglePin(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is no longer available.' };
    tab.snapshot.pinned = !tab.snapshot.pinned;
    if (tab.snapshot.pinned) tab.snapshot.groupId = null;
    this.cleanupEmptyGroups();
    this.tabOrder = this.normalizeTabOrder();
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private createGroup(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is no longer available.' };
    const id = randomUUID();
    const group: BrowserTabGroup = {
      id,
      name: `Group ${this.groups.size + 1}`,
      color: GROUP_COLORS[this.groups.size % GROUP_COLORS.length]!,
      collapsed: false,
    };
    this.groups.set(id, group);
    tab.snapshot.pinned = false;
    tab.snapshot.groupId = id;
    this.cleanupEmptyGroups();
    this.tabOrder = this.normalizeTabOrder();
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private moveToGroup(tabId: string, groupId: string | null): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab || (groupId && !this.groups.has(groupId))) return { ok: false, message: 'That tab or group is no longer available.' };
    tab.snapshot.groupId = groupId;
    if (groupId) tab.snapshot.pinned = false;
    if (groupId) {
      this.tabOrder = this.tabOrder.filter((id) => id !== tabId);
      const lastGroupIndex = this.tabOrder.reduce(
        (last, id, index) => this.tabs.get(id)?.snapshot.groupId === groupId ? index : last,
        -1,
      );
      this.tabOrder.splice(lastGroupIndex + 1, 0, tabId);
    }
    this.cleanupEmptyGroups();
    this.tabOrder = this.normalizeTabOrder();
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private toggleGroup(groupId: string): BrowserCommandResult {
    const group = this.groups.get(groupId);
    if (!group) return { ok: false, message: 'That tab group is no longer available.' };
    group.collapsed = !group.collapsed;
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private renameGroup(groupId: string, name: string): BrowserCommandResult {
    const group = this.groups.get(groupId);
    const normalized = name.trim().slice(0, 32);
    if (!group || !normalized) return { ok: false, message: 'Enter a name for this tab group.' };
    group.name = normalized;
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private setGroupColor(groupId: string, color: BrowserGroupColor): BrowserCommandResult {
    const group = this.groups.get(groupId);
    if (!group || !GROUP_COLORS.includes(color)) return { ok: false, message: 'That tab group or color is no longer available.' };
    group.color = color;
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private showTabMenu(tabId: string): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is no longer available.' };
    const index = this.tabOrder.indexOf(tabId);
    const groups: MenuItemConstructorOptions[] = Array.from(this.groups.values(), (group) => ({
      label: group.name,
      type: 'checkbox',
      checked: tab.snapshot.groupId === group.id,
      click: () => this.moveToGroup(tabId, group.id),
    }));
    const template: MenuItemConstructorOptions[] = [
      { label: 'Reload', click: () => this.reload(tabId) },
      { label: 'Duplicate', click: () => this.duplicateTab(tabId) },
      { type: 'separator' },
      { label: tab.snapshot.pinned ? 'Unpin Tab' : 'Pin Tab', click: () => this.togglePin(tabId) },
      { label: 'Add to New Group', enabled: !tab.snapshot.pinned, click: () => this.createGroup(tabId) },
      ...(groups.length ? [{ label: 'Move to Group', enabled: !tab.snapshot.pinned, submenu: groups } as MenuItemConstructorOptions] : []),
      ...(tab.snapshot.groupId ? [{ label: 'Remove from Group', click: () => this.moveToGroup(tabId, null) } as MenuItemConstructorOptions] : []),
      { type: 'separator' },
      { label: 'Close Tab', click: () => this.closeTab(tabId) },
      { label: 'Close Other Tabs', enabled: this.tabs.size > 1, click: () => this.closeOtherTabs(tabId) },
      { label: 'Close Tabs to the Right', enabled: index >= 0 && index < this.tabOrder.length - 1, click: () => this.closeTabsToRight(tabId) },
    ];
    Menu.buildFromTemplate(template).popup({ window: this.window });
    return { ok: true };
  }

  private showGroupMenu(groupId: string): BrowserCommandResult {
    const group = this.groups.get(groupId);
    if (!group) return { ok: false, message: 'That tab group is no longer available.' };
    Menu.buildFromTemplate([
      { label: group.collapsed ? 'Expand Group' : 'Collapse Group', click: () => this.toggleGroup(groupId) },
      {
        label: 'Group Color',
        submenu: GROUP_COLORS.map((color) => ({
          label: color[0]!.toUpperCase() + color.slice(1),
          type: 'radio',
          checked: group.color === color,
          click: () => this.setGroupColor(groupId, color),
        })),
      },
      { type: 'separator' },
      { label: 'Ungroup Tabs', click: () => this.removeGroup(groupId) },
      { label: 'Close Group', click: () => this.closeGroup(groupId) },
    ]).popup({ window: this.window });
    return { ok: true };
  }

  private updateSettings(updates: Partial<BrowserSettings>): BrowserCommandResult {
    this.settings = sanitizeBrowserSettings({ ...this.settings, ...updates });
    for (const tab of this.tabs.values()) this.applyLinkOpeningPreference(tab);
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private insertTabId(id: string, position: 'preferred' | 'end'): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (position === 'end' || this.settings.newTabPosition === 'end' || !this.activeTabId) {
      this.tabOrder.push(id);
    } else {
      const activeIndex = this.tabOrder.indexOf(this.activeTabId);
      this.tabOrder.splice(activeIndex >= 0 ? activeIndex + 1 : this.tabOrder.length, 0, id);
    }
    this.tabOrder = this.normalizeTabOrder();
  }

  private normalizeTabOrder(order: string[] = this.tabOrder): string[] {
    return normalizeTabOrder(order, (id) => this.tabs.get(id)?.snapshot);
  }

  private closeOtherTabs(tabId: string): void {
    for (const id of [...this.tabOrder]) if (id !== tabId && !this.tabs.get(id)?.snapshot.pinned) this.closeTab(id);
  }

  private closeTabsToRight(tabId: string): void {
    const index = this.tabOrder.indexOf(tabId);
    for (const id of this.tabOrder.slice(index + 1)) if (!this.tabs.get(id)?.snapshot.pinned) this.closeTab(id);
  }

  private closeGroup(groupId: string): void {
    for (const id of [...this.tabOrder]) if (this.tabs.get(id)?.snapshot.groupId === groupId) this.closeTab(id);
    this.groups.delete(groupId);
    this.emitSnapshot();
    this.scheduleSave();
  }

  private removeGroup(groupId: string): void {
    for (const tab of this.tabs.values()) if (tab.snapshot.groupId === groupId) tab.snapshot.groupId = null;
    this.groups.delete(groupId);
    this.emitSnapshot();
    this.scheduleSave();
  }

  private cleanupEmptyGroups(): void {
    const used = new Set(Array.from(this.tabs.values(), (tab) => tab.snapshot.groupId).filter(Boolean));
    for (const id of this.groups.keys()) if (!used.has(id)) this.groups.delete(id);
  }

  private applyLinkOpeningPreference(tab: BrowserTabRecord): void {
    if (tab.view.webContents.isDestroyed()) return;
    const forceNewTab = this.settings.linkOpening === 'new-tab';
    void tab.view.webContents.executeJavaScript(`(() => {
      const key = '__poppinLinkPreference';
      const existing = window[key];
      if (existing) document.removeEventListener('click', existing, true);
      if (!${JSON.stringify(forceNewTab)}) { window[key] = null; return; }
      const handler = (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!target || target.hasAttribute('download')) return;
        const href = target.href;
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || target.hash && target.origin === location.origin && target.pathname === location.pathname) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.open(href, '_blank', 'noopener');
      };
      window[key] = handler;
      document.addEventListener('click', handler, true);
    })()`, true).catch(() => undefined);
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
    const isHtmlFullscreen = this.htmlFullscreen.isActiveFor(this.activeTabId);
    const bounds: Rectangle = {
      x: isHtmlFullscreen ? 0 : PAGE_MARGIN + this.viewInsets.left,
      y: isHtmlFullscreen ? 0 : this.viewInsets.top,
      width: isHtmlFullscreen ? width : Math.max(1, width - PAGE_MARGIN * 2 - this.viewInsets.left - this.viewInsets.right),
      height: isHtmlFullscreen ? height : Math.max(1, height - this.viewInsets.top - PAGE_MARGIN - this.viewInsets.bottom),
    };
    for (const tab of this.tabs.values()) {
      tab.view.setBounds(bounds);
      tab.view.setBorderRadius(isHtmlFullscreen && tab.snapshot.id === this.activeTabId ? 0 : 18);
    }
  }

  private applyFullscreenTransition(transition: HtmlFullscreenTransition): void {
    if (transition.windowFullscreen !== null) this.window.setFullScreen(transition.windowFullscreen);
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

function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function faviconForUrl(value: string, cache: Map<string, string[]>): string[] {
  const origin = safeOrigin(value);
  return origin ? [...(cache.get(origin) ?? [])] : [];
}

function isSupportedFaviconUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'data:';
  } catch {
    return false;
  }
}

function sanitizeBrowserSettings(settings: BrowserSettings): BrowserSettings {
  return {
    linkOpening: ['follow-site', 'new-tab', 'same-tab'].includes(settings.linkOpening)
      ? settings.linkOpening
      : DEFAULT_BROWSER_SETTINGS.linkOpening,
    focusNewTabs: Boolean(settings.focusNewTabs),
    startup: settings.startup === 'new-tab' ? 'new-tab' : 'restore',
    newTabPosition: settings.newTabPosition === 'end' ? 'end' : 'next-to-active',
    warnBeforeClosingMultipleTabs: Boolean(settings.warnBeforeClosingMultipleTabs),
    searchEngine: settings.searchEngine === 'google' ? 'google' : 'duckduckgo',
  };
}

export function isLocalhostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

function isVisualSelectionCapture(value: unknown): value is {
  selector: string; html: string; css: Record<string, string>; domContext: string;
  boundingBox: { x: number; y: number; width: number; height: number };
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const box = candidate.boundingBox as Record<string, unknown> | undefined;
  return typeof candidate.selector === 'string' && typeof candidate.html === 'string'
    && Boolean(candidate.css && typeof candidate.css === 'object') && typeof candidate.domContext === 'string'
    && Boolean(box && ['x', 'y', 'width', 'height'].every((key) => typeof box[key] === 'number'));
}

function agentActionTarget(action: BrowserAgentAction): string {
  if ('selector' in action) return action.selector;
  if ('url' in action) return action.url;
  if ('text' in action) return action.text;
  if ('deltaY' in action) return `${action.deltaY}px`;
  if ('milliseconds' in action) return `${action.milliseconds}ms`;
  return 'visible page';
}

const READ_VISIBLE_PAGE_SCRIPT = `(() => {
  const clone = document.body?.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return '';
  clone.querySelectorAll('input, textarea, select, option, [contenteditable], script, style, noscript').forEach((element) => element.remove());
  const pageText = (clone.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 50000);
  document.querySelectorAll('[data-poppin-agent-id]').forEach((element) => element.removeAttribute('data-poppin-agent-id'));
  const candidates = Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="option"], [tabindex]'));
  const interactive = [];
  for (const element of candidates) {
    if (!(element instanceof HTMLElement) || interactive.length >= 240) continue;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden') continue;
    if ('disabled' in element && element.disabled) continue;
    const descriptor = [
      element.id, element.getAttribute('name'), element.getAttribute('aria-label'), element.getAttribute('autocomplete'),
      element instanceof HTMLInputElement ? element.type : '', element.getAttribute('role')
    ].filter(Boolean).join(' ');
    if (/password|passkey|credential|one[-_ ]?time|otp|verification[-_ ]?code/i.test(descriptor)) continue;
    const label = (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.getAttribute('name') || '').replace(/\\s+/g, ' ').trim().slice(0, 180);
    const agentId = 'poppin-' + interactive.length;
    element.setAttribute('data-poppin-agent-id', agentId);
    interactive.push({
      selector: '[data-poppin-agent-id="' + agentId + '"]',
      label: label || element.tagName.toLowerCase(),
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
      editable: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable
    });
  }
  return JSON.stringify({ url: location.href, title: document.title, pageText, interactive });
})()`;

const CAPTURE_TRANSCRIPT_SCRIPT = `(async () => {
  const textOf = (element) => (element?.innerText || element?.textContent || '').trim();
  const transcriptButton = Array.from(document.querySelectorAll('button, ytd-button-renderer, tp-yt-paper-button'))
    .find((element) => /show transcript|open transcript/i.test(textOf(element)));
  if (transcriptButton instanceof HTMLElement) {
    transcriptButton.scrollIntoView({ block: 'center' });
    transcriptButton.click();
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer, [class*="transcript-segment"]'))
    .map((element) => textOf(element)).filter(Boolean);
  if (segments.length > 0) return segments.join('\\n').slice(0, 60000);
  const captions = Array.from(document.querySelectorAll('[class*="caption"], [aria-label*="transcript" i]'))
    .map((element) => textOf(element)).filter(Boolean);
  return captions.join('\\n').slice(0, 60000);
})()`;

const VISUAL_SELECTION_SCRIPT = `new Promise((resolve) => {
  const marker = document.createElement('div');
  marker.setAttribute('data-poppin-selector', 'true');
  Object.assign(marker.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #e8820b', borderRadius: '4px', background: 'rgba(232,130,11,.08)', boxShadow: '0 0 0 9999px rgba(24,18,12,.14)' });
  document.documentElement.appendChild(marker);
  const move = (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target === marker) return;
    const rect = target.getBoundingClientRect();
    Object.assign(marker.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
  };
  let timeout;
  const cleanup = () => { clearTimeout(timeout); marker.remove(); document.removeEventListener('mousemove', move, true); document.removeEventListener('click', pick, true); document.removeEventListener('keydown', cancel, true); };
  const selectorFor = (element) => {
    if (element.id) return '#' + CSS.escape(element.id);
    const testId = element.getAttribute('data-testid');
    if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
    const parts = [];
    let current = element;
    while (current && current !== document.body && parts.length < 5) {
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName) : [];
      const position = siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : '';
      parts.unshift(current.tagName.toLowerCase() + position);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const pick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === marker) return;
    event.preventDefault(); event.stopPropagation();
    const rect = target.getBoundingClientRect();
    const computed = getComputedStyle(target);
    const properties = ['display','position','box-sizing','width','height','margin','padding','border','border-radius','background','color','font','font-size','font-weight','line-height','letter-spacing','text-align','opacity','box-shadow','flex','flex-direction','align-items','justify-content','gap','grid-template-columns','overflow','z-index','transform'];
    const css = Object.fromEntries(properties.map((name) => [name, computed.getPropertyValue(name)]).filter((entry) => entry[1]));
    const result = { selector: selectorFor(target), html: target.outerHTML, css, domContext: target.parentElement?.outerHTML || target.outerHTML, boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    cleanup(); resolve(result);
  };
  const cancel = (event) => { if (event.key === 'Escape') { cleanup(); resolve(null); } };
  document.addEventListener('mousemove', move, true); document.addEventListener('click', pick, true); document.addEventListener('keydown', cancel, true);
  timeout = setTimeout(() => { cleanup(); resolve(null); }, 120000);
})`;
