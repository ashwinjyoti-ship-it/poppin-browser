import { randomUUID } from 'node:crypto';

import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  dialog,
  Menu,
  type Input,
  type MenuItemConstructorOptions,
  type Rectangle,
  type Session,
  type WebContents,
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
import { displayUrl, NEW_TAB_URL, normalizeAddressInput, normalizeTabInput } from './url-input';
import type { CapturedTabContext } from '../../shared/workspace';
import type { VisualSelectionSnapshot } from '../../shared/workspace';
import { HtmlFullscreenCoordinator, type HtmlFullscreenTransition } from './html-fullscreen';
import type { BrowserAgentAction, BrowserSemanticNode, BrowserSemanticSnapshot } from '../../shared/browser-agent';
import { showPageContextMenu } from './context-menu';
import { DownloadManager } from './downloads';

const PAGE_MARGIN = 12;
const DEFAULT_CHROME_HEIGHT = 103;
const SAVE_DELAY_MS = 250;
const MAX_LAYOUT_INSET = 520;
const MAX_TAB_CONTEXT_CHARACTERS = 60_000;
const CLOSED_TAB_LIMIT = 12;
const GROUP_COLORS: BrowserGroupColor[] = ['amber', 'blue', 'green', 'rose', 'violet'];
const AUTHENTICATION_HOSTS = new Set([
  'accounts.google.com', 'appleid.apple.com', 'auth.openai.com', 'chatgpt.com',
  'login.microsoftonline.com', 'claude.ai', 'auth.anthropic.com',
]);

interface BrowserTabRecord {
  view: WebContentsView;
  snapshot: BrowserTabSnapshot;
  lastExternalUrl: string;
  documentGeneration: number;
}

interface SemanticReferenceRecord {
  tabId: string;
  documentGeneration: number;
  nodes: Map<string, { backendNodeId: number; credential: boolean; mediaControl: boolean; target: string }>;
}

type ClosedTab = PersistedTabState;

export class BrowserEngine {
  private readonly tabs = new Map<string, BrowserTabRecord>();
  private tabOrder: string[] = [];
  private readonly groups = new Map<string, BrowserTabGroup>();
  private readonly closedTabs: ClosedTab[] = [];
  private readonly faviconByOrigin = new Map<string, string[]>();
  private readonly semanticReferences = new Map<string, SemanticReferenceRecord>();
  private readonly mediaBlockedTaskSpaces = new Set<string>();
  private settings: BrowserSettings = { ...DEFAULT_BROWSER_SETTINGS };
  private activeTabId = '';
  private saveTimer: NodeJS.Timeout | null = null;
  private isClosing = false;
  private readonly htmlFullscreen = new HtmlFullscreenCoordinator();
  private viewInsets = { top: DEFAULT_CHROME_HEIGHT, left: 0, right: 0, bottom: 0 };
  private closeConfirmed = false;
  private authenticationWindow: BrowserWindow | null = null;
  private readonly authenticationWindows = new Set<BrowserWindow>();
  private overlayKind: 'authentication' | 'preview' | null = null;
  private contentVisible = true;
  /** The single reusable Tandem World surface, if it is open. */
  private tandemWorldTabId: string | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly browserSession: Session,
    private readonly stateStore: BrowserStateStore,
    private readonly getWindowState: () => WindowState,
  ) {
    this.window.on('resize', () => this.layoutViews());
    this.window.on('move', () => this.layoutAuthenticationWindow());
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
    for (const tab of tabs) {
      this.createTab(tab.url, tab.id, false, tab, false, 'end');
      if (tab.surface === 'tandem-world') this.tandemWorldTabId = tab.id;
    }
    const requestedActive = shouldRestore && state?.activeTabId ? this.tabs.get(state.activeTabId) : null;
    const safeActiveId = requestedActive && !requestedActive.snapshot.taskSpaceId
      ? requestedActive.snapshot.id
      : tabs.find((tab) => !tab.taskSpaceId)?.id ?? tabs[0]!.id;
    this.activateTab(safeActiveId);
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
      authenticationPopup: this.authenticationWindow && !this.authenticationWindow.isDestroyed() && this.overlayKind === 'authentication' ? {
        title: this.authenticationWindow.getTitle() || 'Secure sign-in',
        url: this.authenticationWindow.webContents.getURL(),
      } : null,
      linkPreview: this.authenticationWindow && !this.authenticationWindow.isDestroyed() && this.overlayKind === 'preview' ? {
        title: this.authenticationWindow.getTitle() || 'Link preview',
        url: this.authenticationWindow.webContents.getURL(),
      } : null,
    };
  }

  openExternalUrl(url: string): void {
    const normalized = normalizeAddressInput(url);
    if (normalized.kind !== 'url') return;
    this.createTab(normalized.url, randomUUID(), false, undefined, true, 'end');
  }

  /**
   * Tandem World: one dedicated, reusable surface in Poppin's centre area that
   * hosts the real Tandem application. It uses the same WebContentsView runtime
   * as browsing (no iframe, no DOM copy, so Tandem keeps its own CSP, auth,
   * routing and state), but it is pinned and reused rather than accumulating
   * tabs.
   */
  openTandemWorld(url: string): void {
    const normalized = normalizeAddressInput(url);
    if (normalized.kind !== 'url') return;
    const existing = this.tandemWorldTabId ? this.tabs.get(this.tandemWorldTabId) : undefined;
    if (existing && !existing.view.webContents.isDestroyed()) {
      void existing.view.webContents.loadURL(normalized.url).catch(() => undefined);
      this.activateTab(existing.snapshot.id);
      return;
    }
    const id = randomUUID();
    this.tandemWorldTabId = id;
    this.createTab(normalized.url, id, false, { id, url: normalized.url, pinned: false, groupId: null, surface: 'tandem-world' }, true, 'end');
    const created = this.tabs.get(id);
    if (created) {
      created.snapshot.title = 'Tandem World';
      this.emitSnapshot();
    }
  }

  closeTandemWorld(): void {
    const tabId = this.tandemWorldTabId;
    this.tandemWorldTabId = null;
    if (tabId && this.tabs.has(tabId)) this.closeTab(tabId, false);
  }

  isTandemWorldTab(tabId: string): boolean {
    return this.tandemWorldTabId === tabId;
  }

  hasTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    return Boolean(tab && !tab.view.webContents.isDestroyed());
  }

  describeTab(tabId: string): string {
    const tab = this.tabs.get(tabId);
    return tab ? `${tab.snapshot.title} — ${tab.snapshot.url}` : 'Selected browser tab';
  }

  prepareTabForAgent(tabId: string, taskSpaceId: string): boolean {
    const tab = this.tabs.get(tabId);
    return Boolean(tab && !tab.view.webContents.isDestroyed() && tab.snapshot.taskSpaceId === taskSpaceId);
  }

  createTaskSpaceTabs(taskSpaceId: string, sourceTabIds: string[]): string[] {
    this.mediaBlockedTaskSpaces.add(taskSpaceId);
    const sourceTabs = [...new Set(sourceTabIds)].flatMap((tabId) => {
      const tab = this.tabs.get(tabId);
      return tab && !tab.snapshot.taskSpaceId && !tab.view.webContents.isDestroyed() ? [tab] : [];
    }).slice(0, Math.max(0, 49 - this.tabs.size));
    return sourceTabs.map((source) => {
      const id = randomUUID();
      this.createTab(source.lastExternalUrl, id, false, {
        id, url: source.lastExternalUrl, pinned: false, groupId: null, taskSpaceId,
      }, false, 'end');
      return id;
    });
  }

  createTaskSpaceExplorationTab(taskSpaceId: string, url = ''): string | null {
    if (this.tabs.size >= 50) return null;
    this.mediaBlockedTaskSpaces.add(taskSpaceId);
    const id = randomUUID();
    this.createTab(url, id, false, {
      id, url: url || NEW_TAB_URL, pinned: false, groupId: null, taskSpaceId,
    }, false, 'end', Boolean(url));
    return id;
  }

  watchTaskSpace(taskSpaceId: string, activeTabId: string | null): boolean {
    const candidate = activeTabId ? this.tabs.get(activeTabId) : Array.from(this.tabs.values()).find((tab) => tab.snapshot.taskSpaceId === taskSpaceId);
    if (!candidate || candidate.snapshot.taskSpaceId !== taskSpaceId) return false;
    return this.activateTab(candidate.snapshot.id).ok;
  }

  closeTaskSpaceTabs(taskSpaceId: string): void {
    const ids = this.tabOrder.filter((id) => this.tabs.get(id)?.snapshot.taskSpaceId === taskSpaceId);
    for (const id of ids) this.closeTab(id, false);
    this.mediaBlockedTaskSpaces.delete(taskSpaceId);
    this.emitSnapshot();
    this.scheduleSave();
  }

  closeTaskSpaceTab(taskSpaceId: string, tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.snapshot.taskSpaceId !== taskSpaceId) return false;
    return this.closeTab(tabId, false).ok;
  }

  setTaskSpaceMediaBlocked(taskSpaceId: string, blocked: boolean): void {
    if (blocked) this.mediaBlockedTaskSpaces.add(taskSpaceId);
    else this.mediaBlockedTaskSpaces.delete(taskSpaceId);
    for (const tab of this.tabs.values()) {
      if (tab.snapshot.taskSpaceId !== taskSpaceId || tab.view.webContents.isDestroyed()) continue;
      tab.view.webContents.setAudioMuted(blocked);
      if (blocked) this.pauseTaskOwnedMedia(tab);
    }
  }

  async createSemanticSnapshot(tabId: string, snapshotId: string, taskSpaceId: string): Promise<BrowserSemanticSnapshot> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed() || tab.snapshot.taskSpaceId !== taskSpaceId) throw new Error('That task-owned tab is no longer available.');
    const contents = tab.view.webContents;
    const currentUrl = contents.getURL();
    if (!currentUrl || currentUrl.startsWith(NEW_TAB_URL)) {
      this.semanticReferences.set(snapshotId, { tabId, documentGeneration: tab.documentGeneration, nodes: new Map() });
      for (const [id, record] of this.semanticReferences) if (record.tabId === tabId && id !== snapshotId) this.semanticReferences.delete(id);
      return {
        snapshotId, taskSpaceId, tabId, documentId: `${tabId}:${tab.documentGeneration}`,
        url: currentUrl || NEW_TAB_URL, title: contents.getTitle() || 'New Tab', createdAt: new Date().toISOString(), nodes: [],
      };
    }
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    await Promise.all([
      contents.debugger.sendCommand('Accessibility.enable'),
      contents.debugger.sendCommand('DOM.enable'),
    ]);
    const response = await contents.debugger.sendCommand('Accessibility.getFullAXTree') as { nodes?: CdpAxNode[] };
    const candidates = (response.nodes ?? []).filter(isUsefulAxNode).slice(0, 300);
    const records = await Promise.all(candidates.map(async (node, index) => this.semanticNodeFromAx(contents, node, index)));
    const nodes = records.flatMap((record) => record ? [record.node] : []);
    const refs = new Map<string, { backendNodeId: number; credential: boolean; mediaControl: boolean; target: string }>();
    for (const record of records) if (record) refs.set(record.node.ref, {
      backendNodeId: record.backendNodeId,
      credential: record.node.credential,
      mediaControl: record.node.role === 'button' && /^(?:play|pause|mute|unmute|volume)(?:\b|\s*\()/i.test(record.node.name),
      target: record.node.name || record.node.role,
    });
    this.semanticReferences.set(snapshotId, { tabId, documentGeneration: tab.documentGeneration, nodes: refs });
    for (const [id, record] of this.semanticReferences) if (record.tabId === tabId && id !== snapshotId) this.semanticReferences.delete(id);
    return {
      snapshotId, taskSpaceId, tabId, documentId: `${tabId}:${tab.documentGeneration}`,
      url: contents.getURL(), title: contents.getTitle(), createdAt: new Date().toISOString(), nodes,
    };
  }

  isSemanticSnapshotCurrent(tabId: string, snapshotId: string): boolean {
    const tab = this.tabs.get(tabId);
    const snapshot = this.semanticReferences.get(snapshotId);
    return Boolean(tab && snapshot && snapshot.tabId === tabId && snapshot.documentGeneration === tab.documentGeneration);
  }

  private async semanticNodeFromAx(contents: WebContents, axNode: CdpAxNode, index: number): Promise<{ node: BrowserSemanticNode; backendNodeId: number } | null> {
    const backendNodeId = axNode.backendDOMNodeId;
    if (!backendNodeId) return null;
    let described: { node?: { attributes?: string[]; localName?: string; frameId?: string } };
    try {
      described = await contents.debugger.sendCommand('DOM.describeNode', { backendNodeId, depth: 0, pierce: true }) as typeof described;
    } catch {
      return null;
    }
    const attributes = attributeMap(described.node?.attributes ?? []);
    const role = String(axNode.role?.value ?? described.node?.localName ?? 'content').toLowerCase();
    const credential = isCredentialDescriptor([role, axNode.name?.value, attributes.id, attributes.name, attributes.type, attributes.autocomplete, attributes['aria-label']].filter(Boolean).join(' '));
    const name = credential ? 'Credential field' : String(axNode.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const editable = !credential && (role === 'textbox' || role === 'searchbox' || role === 'combobox' || axProperty(axNode, 'editable') !== undefined);
    const clickable = !credential && (['button', 'link', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'tab'].includes(role) || axProperty(axNode, 'focusable') === true);
    const states = axNode.properties?.flatMap((property) => {
      if (!['checked', 'disabled', 'expanded', 'selected', 'required', 'pressed', 'invalid'].includes(property.name)) return [];
      const value = property.value?.value;
      return value === undefined || value === false ? [] : [`${property.name}:${String(value)}`];
    }) ?? [];
    let bounds: BrowserSemanticNode['bounds'];
    if (clickable || editable) {
      try {
        const box = await contents.debugger.sendCommand('DOM.getBoxModel', { backendNodeId }) as { model?: { border?: number[] } };
        const border = box.model?.border;
        if (border && border.length >= 8) {
          const xs = [border[0]!, border[2]!, border[4]!, border[6]!];
          const ys = [border[1]!, border[3]!, border[5]!, border[7]!];
          const x = Math.min(...xs); const y = Math.min(...ys);
          bounds = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
        }
      } catch {
        // Some AX nodes are virtual or cross-process and have no box model.
      }
    }
    return {
      backendNodeId,
      node: {
        ref: `r${index + 1}`, role, name, states, clickable, editable, credential,
        frameId: axNode.frameId ?? described.node?.frameId ?? 'main',
        ...(bounds ? { bounds } : {}),
        ...(!credential ? safeLocator(attributes, role, name) : {}),
      },
    };
  }

  private resolveSemanticReference(tab: BrowserTabRecord, snapshotId: string, ref: string): { backendNodeId: number; credential: boolean; mediaControl: boolean; target: string } {
    const snapshot = this.semanticReferences.get(snapshotId);
    if (!snapshot || snapshot.tabId !== tab.snapshot.id || snapshot.documentGeneration !== tab.documentGeneration) {
      throw new Error('That semantic reference is stale. Read the page again.');
    }
    const node = snapshot.nodes.get(ref);
    if (!node) throw new Error('That semantic reference is not in the current page snapshot.');
    return node;
  }

  private async callSemanticElement(tab: BrowserTabRecord, snapshotId: string, ref: string, functionDeclaration: string, argument?: string): Promise<unknown> {
    const node = this.resolveSemanticReference(tab, snapshotId, ref);
    if (node.credential) throw new Error('Poppin never reads or operates credential fields.');
    const contents = tab.view.webContents;
    const resolved = await contents.debugger.sendCommand('DOM.resolveNode', { backendNodeId: node.backendNodeId, objectGroup: `poppin-${snapshotId}` }) as { object?: { objectId?: string } };
    const objectId = resolved.object?.objectId;
    if (!objectId) throw new Error('The semantic target is no longer available.');
    try {
      const result = await contents.debugger.sendCommand('Runtime.callFunctionOn', {
        objectId, functionDeclaration, returnByValue: true, awaitPromise: true,
        arguments: argument === undefined ? [] : [{ value: argument }],
      }) as { result?: { value?: unknown }; exceptionDetails?: unknown };
      if (result.exceptionDetails) throw new Error('The page rejected the semantic action.');
      return result.result?.value;
    } finally {
      await contents.debugger.sendCommand('Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  }

  async inspectAction(tabId: string, action: BrowserAgentAction): Promise<{ credential: boolean; consequential: string | null; takeover?: string | null; target: string }> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) throw new Error('That tab is no longer available.');
    if (action.type !== 'click' && action.type !== 'type') {
      return { credential: false, consequential: null, target: agentActionTarget(action) };
    }
    if (action.ref && action.snapshotId) {
      const resolved = this.resolveSemanticReference(tab, action.snapshotId, action.ref);
      if (resolved.credential) return { credential: true, consequential: null, target: 'Credential field' };
      const signal = resolved.target;
      const takeover = resolved.mediaControl
        ? 'Media playback remains under user control. Take over the Agent Tab to use playback controls.'
        : /\b(sign[- ]?in|log[- ]?in|authenticate|oauth|captcha|verify you are human|two[- ]?factor)\b/i.test(signal)
        ? 'Authentication or unusual manual interaction must be completed by the user.' : null;
      const consequential = !takeover && /\b(download|upload|purchase|pay|buy|delete|trash|discard|publish|send|submit|merge|create (?:pull request|record)|remove)\b/i.test(signal)
        ? 'This action may cause an external or irreversible effect.' : null;
      return { credential: false, consequential, takeover, target: signal };
    }
    if (!action.selector) throw new Error('Read the page and use a current semantic reference.');
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
      const mediaControl = (element.matches('button, [role="button"]') || element.closest('button, [role="button"]'))
        && /^(play|pause|mute|unmute|volume)(\\b|\\s*\\()/i.test(text);
      const takeover = mediaControl
        ? 'Media playback remains under user control. Take over the Agent Tab to use playback controls.'
        : /\\b(sign[- ]?in|log[- ]?in|authenticate|oauth|captcha|verify you are human|two[- ]?factor)\\b/i.test(signal)
          ? 'Authentication or unusual manual interaction must be completed by the user.' : null;
      if (!takeover && (element.hasAttribute('download') || /\\b(download|upload|purchase|pay|buy|delete|trash|discard|publish|send|submit|merge|create (?:pull request|record)|remove (?:account|message|draft|file|record|item))\\b/i.test(signal))) {
        consequential = 'This action may cause an external or irreversible effect.';
      }
      return { credential, consequential, takeover, target: text || href || element.tagName.toLowerCase() };
    })()`.replace('actionType', JSON.stringify(action.type)), true);
    if (!inspected || typeof inspected !== 'object') throw new Error('The target element is no longer available.');
    const value = inspected as { credential?: unknown; consequential?: unknown; takeover?: unknown; target?: unknown };
    return {
      credential: value.credential === true,
      consequential: typeof value.consequential === 'string' ? value.consequential : null,
      takeover: typeof value.takeover === 'string' ? value.takeover : null,
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
      case 'readMetadata':
        return String(await contents.executeJavaScript(READ_STRUCTURED_METADATA_SCRIPT, true));
      case 'captureTranscript':
        return String(await contents.executeJavaScript(CAPTURE_TRANSCRIPT_SCRIPT, true));
      case 'click': {
        if (action.ref && action.snapshotId) {
          await this.callSemanticElement(tab, action.snapshotId, action.ref, `function() { if (this instanceof HTMLElement) { this.click(); return true; } return false; }`);
          return `Clicked ${action.ref}`;
        }
        if (!action.selector) throw new Error('Read the page and use a current semantic reference.');
        const clicked = await contents.executeJavaScript(`(() => { const element = document.querySelector(${JSON.stringify(action.selector)}); if (!(element instanceof HTMLElement)) return false; element.click(); return true; })()`, true);
        if (clicked !== true) throw new Error('The target element is no longer available.');
        return `Clicked ${action.selector}`;
      }
      case 'type': {
        if (action.ref && action.snapshotId) {
          const result = await this.callSemanticElement(tab, action.snapshotId, action.ref, `function(text) {
            const element = this;
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement && element.isContentEditable)) return false;
            const descriptor = [element.id, element.getAttribute('name'), element.getAttribute('aria-label'), element.getAttribute('autocomplete'), element instanceof HTMLInputElement ? element.type : ''].filter(Boolean).join(' ');
            if (/password|passkey|credential|one[-_ ]?time|otp|verification[-_ ]?code/i.test(descriptor)) return 'credential';
            element.focus();
            if (element instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, text);
            else if (element instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(element, text);
            else element.textContent = text;
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }`, action.text);
          if (result === 'credential') throw new Error('Poppin never types into credential fields.');
          if (result !== true) throw new Error('The editable target is no longer available.');
          return `Typed ${action.text.length} character(s)`;
        }
        if (!action.selector) throw new Error('Read the page and use a current semantic reference.');
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
      case 'openTab':
      case 'closeTab':
        throw new Error('Agent Tab lifecycle actions must be handled by the task-space controller.');
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
      case 'cancelAuthenticationPopup':
        return this.cancelAuthenticationPopup();
      case 'closeLinkPreview':
        return this.closeLinkPreview();
      case 'openLinkPreviewInTab':
        return this.openLinkPreviewInTab();
      case 'setContentVisible':
        this.contentVisible = command.visible;
        this.layoutViews();
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
          taskSpaceId: tab.snapshot.taskSpaceId,
          surface: tab.snapshot.surface,
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
    loadInitial = true,
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
      taskSpaceId: persisted?.taskSpaceId ?? null,
      surface: persisted?.surface,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      failure: null,
    };
    const record: BrowserTabRecord = {
      view,
      snapshot,
      lastExternalUrl: initialUrl,
      documentGeneration: 0,
    };
    this.tabs.set(id, record);
    this.insertTabId(id, position);
    this.window.contentView.addChildView(view);
    this.attachTabEvents(record);
    if (snapshot.taskSpaceId && this.mediaBlockedTaskSpaces.has(snapshot.taskSpaceId)) view.webContents.setAudioMuted(true);
    if (activate) this.activateTab(id);
    if (loadInitial) void view.webContents.loadURL(initialUrl).catch(() => undefined);

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
      const authentication = !tab.snapshot.taskSpaceId && isAuthenticationPopup(url, contents.getURL());
      // Native frameless preview windows proved capable of trapping the parent
      // window on macOS. Until a renderer-owned overlay host replaces them,
      // ordinary links always use a normal Poppin tab.
      if (authentication) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: this.authenticationWindowOptions(),
        };
      }
      // File downloads opened via target=_blank must not become tab navigations;
      // that path left truncated/missing DMGs under WebContentsView.
      if (DownloadManager.isLikelyDownloadUrl(url)) {
        contents.downloadURL(url);
        return { action: 'deny' };
      }
      if (tab.snapshot.taskSpaceId || this.settings.linkOpening === 'same-tab') {
        void contents.loadURL(url).catch(() => undefined);
      } else {
        const id = randomUUID();
        this.createTab(url, id, false, tab.snapshot.taskSpaceId ? { id, url, taskSpaceId: tab.snapshot.taskSpaceId } : undefined, tab.snapshot.taskSpaceId ? false : this.settings.focusNewTabs);
      }
      return { action: 'deny' };
    });
    contents.on('did-create-window', (popup, details) => {
      const kind = isAuthenticationPopup(details.url, contents.getURL()) ? 'authentication' : null;
      if (!kind) {
        popup.close();
        return;
      }
      this.closeAuthenticationWindows();
      this.registerAuthenticationWindow(popup);
    });
    contents.on('context-menu', (_event, params) => {
      showPageContextMenu(this.window, contents, params, {
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        onBack: () => contents.navigationHistory.goBack(),
        onForward: () => contents.navigationHistory.goForward(),
        onReload: () => this.reload(tab.snapshot.id),
        onOpenLink: (url, disposition) => {
          if (disposition === 'current' || tab.snapshot.taskSpaceId) void contents.loadURL(url).catch(() => undefined);
          else {
            const id = randomUUID();
            this.createTab(url, id, false, tab.snapshot.taskSpaceId ? { id, url, taskSpaceId: tab.snapshot.taskSpaceId } : undefined, tab.snapshot.taskSpaceId ? false : this.settings.focusNewTabs);
          }
        },
        onSearchSelection: (selection) => {
          const search = normalizeAddressInput(selection, this.settings.searchEngine);
          if (search.kind !== 'invalid') {
            if (tab.snapshot.taskSpaceId) void contents.loadURL(search.url).catch(() => undefined);
            else this.createTab(search.url, randomUUID(), false, undefined, true);
          }
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
    contents.on('dom-ready', () => {
      this.applyLinkOpeningPreference(tab);
      if (tab.snapshot.taskSpaceId && this.mediaBlockedTaskSpaces.has(tab.snapshot.taskSpaceId)) this.pauseTaskOwnedMedia(tab);
    });
    contents.on('media-started-playing', () => {
      if (tab.snapshot.taskSpaceId && this.mediaBlockedTaskSpaces.has(tab.snapshot.taskSpaceId)) this.pauseTaskOwnedMedia(tab);
    });
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

  private authenticationWindowOptions(): BrowserWindowConstructorOptions {
    return {
      frame: true,
      show: true,
      backgroundColor: '#fbf8f2',
      autoHideMenuBar: false,
      webPreferences: {
        session: this.browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    };
  }

  private registerAuthenticationWindow(popup: BrowserWindow): void {
    this.authenticationWindows.add(popup);
    this.authenticationWindow = popup;
    this.overlayKind = 'authentication';
    popup.setTitle('Secure sign-in');
    // Publish recovery controls before the child has painted. Some identity
    // providers delay their first paint or title update.
    this.emitSnapshot();
    popup.webContents.on('will-navigate', (event, url) => {
      const protocol = safeProtocol(url);
      if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'about:') event.preventDefault();
    });
    // Google can continue its consent flow through another window. Preserve
    // only authentication-scoped children and keep every child sandboxed in
    // the same browser session; arbitrary popup creation remains denied.
    popup.webContents.setWindowOpenHandler(({ url }) => isAuthenticationPopup(url, popup.webContents.getURL())
      ? { action: 'allow', overrideBrowserWindowOptions: this.authenticationWindowOptions() }
      : { action: 'deny' });
    popup.webContents.on('did-create-window', (child, details) => {
      if (!isAuthenticationPopup(details.url, popup.webContents.getURL())) {
        child.close();
        return;
      }
      this.registerAuthenticationWindow(child);
    });
    popup.webContents.on('page-title-updated', (_event, title) => {
      popup.setTitle(title || 'Secure sign-in');
      this.emitSnapshot();
    });
    popup.once('ready-to-show', () => {
      if (popup.isDestroyed()) return;
      this.layoutAuthenticationWindow(popup);
      popup.show();
      popup.focus();
      this.emitSnapshot();
    });
    popup.on('closed', () => {
      this.authenticationWindows.delete(popup);
      if (this.authenticationWindow === popup) {
        const remaining = Array.from(this.authenticationWindows).filter((candidate) => !candidate.isDestroyed());
        this.authenticationWindow = remaining.at(-1) ?? null;
        this.overlayKind = this.authenticationWindow ? 'authentication' : null;
      }
      this.emitSnapshot();
    });
    popup.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape' || (input.meta && input.key.toLowerCase() === 'w')) popup.close();
    });
  }

  private closeAuthenticationWindows(): void {
    for (const popup of Array.from(this.authenticationWindows)) {
      if (!popup.isDestroyed()) popup.close();
    }
  }

  private handleNavigation(tab: BrowserTabRecord, url: string, resetFavicon: boolean): void {
    if (url.startsWith('poppin://error')) return;
    if (resetFavicon) {
      tab.documentGeneration += 1;
      for (const [id, record] of this.semanticReferences) if (record.tabId === tab.snapshot.id) this.semanticReferences.delete(id);
    }
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

  private pauseTaskOwnedMedia(tab: BrowserTabRecord): void {
    if (!tab.snapshot.taskSpaceId || !this.mediaBlockedTaskSpaces.has(tab.snapshot.taskSpaceId)) return;
    tab.view.webContents.setAudioMuted(true);
    void tab.view.webContents.executeJavaScript('document.querySelectorAll("video").forEach((video) => video.pause())', true).catch(() => undefined);
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

  private closeTab(tabId: string, remember = true): BrowserCommandResult {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, message: 'That tab is already closed.' };
    const orderedIds = [...this.tabOrder];
    const closingIndex = orderedIds.indexOf(tabId);
    if (remember && !tab.snapshot.taskSpaceId && !tab.snapshot.surface && tab.lastExternalUrl) {
      this.closedTabs.push({
        id: randomUUID(),
        url: tab.lastExternalUrl,
        pinned: tab.snapshot.pinned,
        groupId: tab.snapshot.groupId,
      });
      if (this.closedTabs.length > CLOSED_TAB_LIMIT) this.closedTabs.shift();
    }
    if (this.tandemWorldTabId === tabId) this.tandemWorldTabId = null;
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
      const remainingIds = this.tabOrder.filter((id) => !this.tabs.get(id)?.snapshot.taskSpaceId);
      if (remainingIds.length === 0) {
        this.createTab();
        return { ok: true };
      }
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
    if (updates.linkOpening !== undefined) {
      for (const tab of this.tabs.values()) this.applyLinkOpeningPreference(tab);
    }
    this.emitSnapshot();
    this.scheduleSave();
    return { ok: true };
  }

  private cancelAuthenticationPopup(): BrowserCommandResult {
    const popup = this.authenticationWindow;
    if (!popup || popup.isDestroyed() || this.overlayKind !== 'authentication') return { ok: false, message: 'There is no sign-in overlay to cancel.' };
    this.closeAuthenticationWindows();
    return { ok: true };
  }

  private closeLinkPreview(): BrowserCommandResult {
    const popup = this.authenticationWindow;
    if (!popup || popup.isDestroyed() || this.overlayKind !== 'preview') return { ok: false, message: 'There is no link preview to close.' };
    popup.close();
    return { ok: true };
  }

  private openLinkPreviewInTab(): BrowserCommandResult {
    const popup = this.authenticationWindow;
    if (!popup || popup.isDestroyed() || this.overlayKind !== 'preview') return { ok: false, message: 'There is no link preview to open.' };
    const url = popup.webContents.getURL();
    popup.close();
    this.createTab(url, randomUUID(), false, undefined, true);
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
    const previewExternal = this.settings.linkOpening === 'follow-site';
    void tab.view.webContents.executeJavaScript(`(() => {
      const key = '__poppinLinkPreference';
      const existing = window[key];
      if (existing) document.removeEventListener('click', existing, true);
      if (!${JSON.stringify(forceNewTab || previewExternal)}) { window[key] = null; return; }
      const handler = (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!target || target.hasAttribute('download')) return;
        const href = target.href;
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || target.hash && target.origin === location.origin && target.pathname === location.pathname) return;
        if (${JSON.stringify(previewExternal)} && target.origin === location.origin) return;
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
    const bounds: Rectangle = this.contentVisible ? {
      x: isHtmlFullscreen ? 0 : PAGE_MARGIN + this.viewInsets.left,
      y: isHtmlFullscreen ? 0 : this.viewInsets.top,
      width: isHtmlFullscreen ? width : Math.max(1, width - PAGE_MARGIN * 2 - this.viewInsets.left - this.viewInsets.right),
      height: isHtmlFullscreen ? height : Math.max(1, height - this.viewInsets.top - PAGE_MARGIN - this.viewInsets.bottom),
    } : { x: 0, y: 0, width: 0, height: 0 };
    for (const tab of this.tabs.values()) {
      tab.view.setBounds(bounds);
      tab.view.setBorderRadius(isHtmlFullscreen && tab.snapshot.id === this.activeTabId ? 0 : 18);
    }
    this.layoutAuthenticationWindow();
  }

  private layoutAuthenticationWindow(target?: BrowserWindow | null): void {
    const popup = target ?? this.authenticationWindow;
    if (!popup || popup.isDestroyed() || this.window.isDestroyed()) return;
    const parent = this.window.getContentBounds();
    // Preview windows are deliberately large enough to feel like an in-app
    // Arc-style surface, while leaving a clear, persistent control rail in
    // the parent window for Close and Open in tab.
    const width = Math.min(1_280, Math.max(420, parent.width - 160));
    const height = Math.min(920, Math.max(420, parent.height - 132));
    popup.setBounds({
      x: parent.x + Math.round((parent.width - width) / 2),
      y: parent.y + Math.max(58, Math.round((parent.height - height) / 2)),
      width,
      height,
    });
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

export function isAuthenticationPopup(value: string, openerValue: string): boolean {
  try {
    const opener = new URL(openerValue);
    const localOpener = isLocalhostUrl(openerValue);
    if (opener.protocol !== 'https:' && !localOpener) return false;
    if (value === 'about:blank') {
      return opener.hostname === 'claude.ai'
        || AUTHENTICATION_HOSTS.has(opener.hostname)
        || opener.hostname.endsWith('.anthropic.com');
    }
    const target = new URL(value);
    const localTarget = isLocalhostUrl(value);
    if (target.protocol !== 'https:' && !(localOpener && localTarget)) return false;
    const knownHost = AUTHENTICATION_HOSTS.has(target.hostname)
      || target.hostname.endsWith('.anthropic.com');
    const sameOrigin = target.origin === opener.origin;
    const authSignal = /(?:^|[/?#&_.-])(auth|oauth|login|sign[-_]?in|authorize|consent|callback)(?:$|[/?#&_.=-])/i.test(`${target.hostname}${target.pathname}${target.search}`);
    return (authSignal && (knownHost || sameOrigin)) || (knownHost && opener.hostname === 'claude.ai');
  } catch {
    return false;
  }
}

export function isExternalLinkPreview(value: string, openerValue: string): boolean {
  try {
    const target = new URL(value);
    const opener = new URL(openerValue);
    const allowedTarget = target.protocol === 'https:' || isLocalhostUrl(value);
    const allowedOpener = opener.protocol === 'https:' || isLocalhostUrl(openerValue);
    return allowedTarget && allowedOpener && target.origin !== opener.origin;
  } catch {
    return false;
  }
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
  if ('ref' in action && action.ref) return action.ref;
  if ('selector' in action && action.selector) return action.selector;
  if ('url' in action && action.url) return action.url;
  if ('text' in action) return action.text;
  if ('deltaY' in action) return `${action.deltaY}px`;
  if ('milliseconds' in action) return `${action.milliseconds}ms`;
  return 'visible page';
}

interface CdpAxNode {
  ignored?: boolean;
  backendDOMNodeId?: number;
  frameId?: string;
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
}

const SEMANTIC_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'heading', 'listitem', 'cell',
  'rowheader', 'columnheader', 'statictext', 'paragraph', 'article', 'region', 'dialog', 'alert',
]);

function isUsefulAxNode(node: CdpAxNode): boolean {
  if (node.ignored || !node.backendDOMNodeId) return false;
  const role = String(node.role?.value ?? '').toLowerCase();
  const name = String(node.name?.value ?? '').trim();
  return SEMANTIC_ROLES.has(role) && (name.length > 0 || !['statictext', 'paragraph', 'heading', 'listitem'].includes(role));
}

function axProperty(node: CdpAxNode, name: string): unknown {
  return node.properties?.find((property) => property.name === name)?.value?.value;
}

function attributeMap(values: string[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let index = 0; index + 1 < values.length; index += 2) attributes[values[index]!.toLowerCase()] = values[index + 1]!;
  return attributes;
}

function isCredentialDescriptor(value: string): boolean {
  return /password|passkey|credential|one[-_ ]?time|otp|verification[-_ ]?code/i.test(value);
}

function safeLocator(attributes: Record<string, string>, role: string, name: string): { locator?: string } {
  if (attributes['data-testid']) return { locator: `[data-testid=${JSON.stringify(attributes['data-testid'])}]` };
  if (attributes.id) return { locator: `#${attributes.id.replace(/[^a-zA-Z0-9_-]/g, '')}` };
  if (attributes['aria-label']) return { locator: `[aria-label=${JSON.stringify(attributes['aria-label'].slice(0, 160))}]` };
  if (name && ['button', 'link', 'textbox', 'checkbox', 'radio', 'option'].includes(role)) return { locator: `role=${role};name=${name.slice(0, 160)}` };
  return {};
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

const READ_STRUCTURED_METADATA_SCRIPT = `(() => {
  const compact = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
  const absoluteHttpUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
    } catch { return ''; }
  };
  const meta = (key) => compact(document.querySelector('meta[property="' + key + '"], meta[name="' + key + '"]')?.getAttribute('content'), 1000);
  const canonicalUrl = absoluteHttpUrl(document.querySelector('link[rel="canonical"]')?.getAttribute('href')) || location.href;
  const seen = new Set();
  const items = [];
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    if (!(anchor instanceof HTMLAnchorElement) || items.length >= 40) break;
    const rect = anchor.getBoundingClientRect();
    const style = getComputedStyle(anchor);
    if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden') continue;
    const url = absoluteHttpUrl(anchor.href);
    if (!url || seen.has(url)) continue;
    const container = anchor.closest('ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, article, [role="article"], li') || anchor.parentElement;
    const title = compact(anchor.getAttribute('title') || anchor.getAttribute('aria-label') || anchor.textContent, 300);
    if (!title || title.length < 3) continue;
    const metadata = compact(container instanceof HTMLElement ? container.innerText : anchor.innerText, 800);
    if (!metadata) continue;
    const image = container?.querySelector('img');
    const thumbnailUrl = image instanceof HTMLImageElement ? absoluteHttpUrl(image.currentSrc || image.src) : '';
    seen.add(url);
    items.push({ title, url, metadata, ...(thumbnailUrl ? { thumbnailUrl } : {}) });
  }
  const structured = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 12)) {
    try {
      const parsed = JSON.parse(script.textContent || 'null');
      const values = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
      for (const value of values) {
        if (!value || typeof value !== 'object' || structured.length >= 20) continue;
        const author = typeof value.author === 'string' ? value.author : value.author && typeof value.author.name === 'string' ? value.author.name : '';
        const thumbnail = Array.isArray(value.thumbnailUrl) ? value.thumbnailUrl[0] : value.thumbnailUrl;
        const item = {
          type: compact(value['@type'], 80),
          name: compact(value.name || value.headline, 300),
          description: compact(value.description, 1000),
          url: absoluteHttpUrl(value.url || value.contentUrl || value.embedUrl),
          author: compact(author, 200),
          duration: compact(value.duration, 80),
          uploadDate: compact(value.uploadDate || value.datePublished, 80),
          thumbnailUrl: absoluteHttpUrl(thumbnail),
        };
        if (item.name || item.url) structured.push(item);
      }
    } catch { /* Invalid or non-JSON structured data is ignored. */ }
  }
  return JSON.stringify({
    url: location.href,
    canonicalUrl,
    title: compact(document.title, 300),
    description: meta('description') || meta('og:description') || meta('twitter:description'),
    siteName: meta('og:site_name'),
    imageUrl: absoluteHttpUrl(meta('og:image') || meta('twitter:image')),
    items,
    structured,
  });
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
