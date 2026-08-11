import type { BrowserWindow } from 'electron';

import {
  EMPTY_TANDEM_SNAPSHOT,
  TANDEM_CHANNELS,
  type TandemCommand,
  type TandemCommandResult,
  type TandemContextSnapshot,
  type TandemSnapshot,
} from '../../shared/tandem';
import { TandemClient } from './tandem-client';
import { normalizeTandemBaseUrl, type TandemCredentialStore } from './tandem-credentials';
import type { CreateTandemProvider, TandemProvider } from './tandem-provider';

const MAX_SELECTED_PAGES = 12;

export interface TandemEngineOptions {
  /** Opens (or focuses) the Tandem World surface in Poppin's centre area. */
  openWorld?: (url: string) => void;
  closeWorld?: () => void;
  /** Notifies the workspace that explicit context changed. */
  onContextChanged?: () => void;
  createProvider?: CreateTandemProvider;
}

/**
 * Owns Poppin's connection to the Tandem application: credentials, API access,
 * the left-pane browse/search tree, frozen context snapshots, and the Tandem
 * World surface. Tandem remains the source of truth — Poppin stores references,
 * metadata and snapshots, never a second copy of the Tandem database.
 */
export class TandemEngine {
  private snapshot: TandemSnapshot = { ...EMPTY_TANDEM_SNAPSHOT };
  private provider: TandemProvider | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly credentials: TandemCredentialStore,
    private readonly options: TandemEngineOptions = {},
  ) {
    this.snapshot = {
      ...EMPTY_TANDEM_SNAPSHOT,
      connection: {
        ...EMPTY_TANDEM_SNAPSHOT.connection,
        baseUrl: safely(() => this.credentials.baseUrl()) ?? null,
        hasCredential: safely(() => this.credentials.has()) ?? false,
      },
    };
  }

  getSnapshot(): TandemSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  /** Availability reported to the capability router before a task starts. */
  getAvailability(): { available: boolean; writable: boolean } {
    return {
      available: this.snapshot.connection.state === 'ready',
      writable: this.snapshot.connection.state === 'ready' && this.snapshot.connection.writable,
    };
  }

  getProvider(): TandemProvider | null {
    return this.provider;
  }

  getActiveWorkspaceId(): string | null {
    return this.snapshot.activeWorkspaceId;
  }

  /** Frozen Tandem pages that the user explicitly checked into context. */
  getSelectedContext(): TandemContextSnapshot[] {
    return this.snapshot.selected.map((item) => ({ ...item }));
  }

  openWorldForPage(pageId: string): void {
    if (!this.provider) return;
    this.options.openWorld?.(this.provider.worldUrl(pageId));
    this.snapshot.worldOpen = true;
    this.emit();
  }

  async initialize(): Promise<void> {
    if (!this.snapshot.connection.hasCredential) {
      this.emit();
      return;
    }
    await this.reconnect();
  }

  async execute(command: TandemCommand): Promise<TandemCommandResult> {
    try {
      switch (command.type) {
        case 'connect':
          return await this.connect(command.baseUrl, command.apiKey);
        case 'disconnect':
          return this.disconnect();
        case 'refreshConnection':
          return await this.reconnect();
        case 'selectWorkspace':
          return await this.selectWorkspace(command.workspaceId);
        case 'search':
          return await this.search(command.query);
        case 'setPageSelected':
          return await this.setPageSelected(command.pageId, command.selected);
        case 'refreshBrowse':
          return await this.refreshBrowse();
        case 'refreshContext':
          return await this.refreshContext();
        case 'openWorld':
          return this.openWorld(command.pageId);
        case 'closeWorld':
          this.options.closeWorld?.();
          this.snapshot.worldOpen = false;
          this.emit();
          return { ok: true };
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Poppin could not complete that Tandem action.' };
    }
  }

  private async connect(rawBaseUrl: string, apiKey: string): Promise<TandemCommandResult> {
    const baseUrl = normalizeTandemBaseUrl(rawBaseUrl);
    const key = apiKey.trim();
    if (!key) return { ok: false, message: 'Paste a Tandem API key. Create one in Tandem settings.' };
    this.credentials.save({ baseUrl, apiKey: key });
    return this.reconnect();
  }

  private disconnect(): TandemCommandResult {
    this.credentials.clear();
    this.provider = null;
    this.snapshot = { ...EMPTY_TANDEM_SNAPSHOT };
    this.emit();
    this.options.onContextChanged?.();
    return { ok: true };
  }

  private async reconnect(): Promise<TandemCommandResult> {
    const credential = this.credentials.load();
    if (!credential) {
      this.snapshot = { ...EMPTY_TANDEM_SNAPSHOT };
      this.emit();
      return { ok: false, message: 'Connect Tandem first.' };
    }
    this.setConnection('connecting', 'Connecting to Tandem…', credential.baseUrl);
    const provider = this.options.createProvider?.(credential.baseUrl, credential.apiKey)
      ?? new TandemClient(credential.baseUrl, credential.apiKey);
    try {
      await provider.catalog();
      const account = await provider.me();
      const workspaces = await provider.listWorkspaces();
      this.provider = provider;
      this.snapshot.connection = {
        state: 'ready',
        message: 'Tandem is connected.',
        baseUrl: credential.baseUrl,
        hasCredential: true,
        accountLabel: account.label,
        writable: account.writable,
      };
      this.snapshot.workspaces = workspaces;
      const workspaceId = workspaces.find((workspace) => workspace.id === this.snapshot.activeWorkspaceId)?.id
        ?? workspaces[0]?.id
        ?? null;
      this.snapshot.activeWorkspaceId = workspaceId;
      await this.loadWorkspace();
      this.emit();
      return { ok: true };
    } catch (error) {
      this.provider = null;
      const message = error instanceof Error ? error.message : 'Poppin could not reach Tandem.';
      this.setConnection('error', message, credential.baseUrl);
      return { ok: false, message };
    }
  }

  private async selectWorkspace(workspaceId: string): Promise<TandemCommandResult> {
    if (!this.snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) {
      return { ok: false, message: 'That Tandem workspace is not available.' };
    }
    this.snapshot.activeWorkspaceId = workspaceId;
    await this.loadWorkspace();
    this.emit();
    return { ok: true };
  }

  private async loadWorkspace(): Promise<void> {
    const workspaceId = this.snapshot.activeWorkspaceId;
    if (!this.provider || !workspaceId) {
      this.snapshot.pages = [];
      this.snapshot.recent = [];
      return;
    }
    const [pages, recent] = await Promise.all([
      this.provider.listPages(workspaceId),
      this.provider.recentPages(),
    ]);
    this.snapshot.pages = pages;
    this.snapshot.recent = recent;
  }

  private async search(query: string): Promise<TandemCommandResult> {
    this.snapshot.searchQuery = query;
    if (!this.provider || !query.trim()) {
      this.snapshot.searchResults = [];
      this.emit();
      return { ok: true };
    }
    this.snapshot.searchResults = await this.provider.search(query.trim());
    this.emit();
    return { ok: true };
  }

  /**
   * Checking a page freezes its Markdown into explicit context. Only checked
   * pages are ever sent to the agent.
   */
  private async setPageSelected(pageId: string, selected: boolean): Promise<TandemCommandResult> {
    if (!selected) {
      this.snapshot.selected = this.snapshot.selected.filter((item) => item.pageId !== pageId);
      this.emit();
      this.options.onContextChanged?.();
      return { ok: true };
    }
    if (!this.provider || !this.snapshot.activeWorkspaceId) return { ok: false, message: 'Connect Tandem first.' };
    if (this.snapshot.selected.length >= MAX_SELECTED_PAGES) {
      return { ok: false, message: `Poppin keeps at most ${MAX_SELECTED_PAGES} Tandem pages in explicit context.` };
    }
    if (this.snapshot.selected.some((item) => item.pageId === pageId)) return { ok: true };
    const content = await this.provider.readMarkdown(pageId);
    this.snapshot.selected = [...this.snapshot.selected, {
      sourceType: 'tandem-page',
      workspaceId: this.snapshot.activeWorkspaceId,
      pageId,
      title: content.title,
      updatedAt: content.updatedAt,
      capturedMarkdown: content.markdown,
      capturedAt: new Date().toISOString(),
      truncated: content.truncated,
      stale: false,
    }];
    this.emit();
    this.options.onContextChanged?.();
    return { ok: true };
  }

  /**
   * Reloads the browse/recent tree from Tandem. Selected context stays frozen.
   */
  private async refreshBrowse(): Promise<TandemCommandResult> {
    if (!this.provider) return { ok: false, message: 'Connect Tandem first.' };
    await this.loadWorkspace();
    if (this.snapshot.searchQuery.trim()) {
      this.snapshot.searchResults = await this.provider.search(this.snapshot.searchQuery.trim());
    }
    this.emit();
    return { ok: true };
  }

  /**
   * Explicit refresh. Reloads the browse tree, then re-captures selected page
   * snapshots. Poppin never silently mutates frozen context on a remote edit.
   */
  private async refreshContext(): Promise<TandemCommandResult> {
    if (!this.provider) return { ok: false, message: 'Connect Tandem first.' };
    await this.loadWorkspace();
    if (this.snapshot.searchQuery.trim()) {
      this.snapshot.searchResults = await this.provider.search(this.snapshot.searchQuery.trim());
    }
    const refreshed: TandemContextSnapshot[] = [];
    const failures: string[] = [];
    for (const item of this.snapshot.selected) {
      try {
        const content = await this.provider.readMarkdown(item.pageId);
        refreshed.push({
          ...item,
          title: content.title,
          updatedAt: content.updatedAt,
          capturedMarkdown: content.markdown,
          capturedAt: new Date().toISOString(),
          truncated: content.truncated,
          stale: false,
        });
      } catch (error) {
        failures.push(`${item.title}: ${error instanceof Error ? error.message : 'unavailable'}`);
        refreshed.push({ ...item, stale: true });
      }
    }
    this.snapshot.selected = refreshed;
    this.emit();
    this.options.onContextChanged?.();
    return failures.length ? { ok: false, message: failures.join('\n') } : { ok: true };
  }

  private openWorld(pageId?: string): TandemCommandResult {
    if (!this.provider) return { ok: false, message: 'Connect Tandem before opening Tandem World.' };
    if (!this.options.openWorld) return { ok: false, message: 'Tandem World is not available.' };
    this.options.openWorld(this.provider.worldUrl(pageId));
    this.snapshot.worldOpen = true;
    this.emit();
    return { ok: true };
  }

  private setConnection(state: TandemSnapshot['connection']['state'], message: string, baseUrl: string | null): void {
    this.snapshot.connection = {
      state,
      message,
      baseUrl,
      hasCredential: safely(() => this.credentials.has()) ?? false,
      accountLabel: state === 'ready' ? this.snapshot.connection.accountLabel : null,
      writable: state === 'ready' && this.snapshot.connection.writable,
    };
    this.emit();
  }

  private emit(): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(TANDEM_CHANNELS.snapshot, this.getSnapshot());
  }
}

function cloneSnapshot(snapshot: TandemSnapshot): TandemSnapshot {
  return {
    ...snapshot,
    connection: { ...snapshot.connection },
    workspaces: snapshot.workspaces.map((item) => ({ ...item })),
    pages: snapshot.pages.map((item) => ({ ...item })),
    recent: snapshot.recent.map((item) => ({ ...item })),
    searchResults: snapshot.searchResults.map((item) => ({ ...item })),
    selected: snapshot.selected.map((item) => ({ ...item })),
  };
}

function safely<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
