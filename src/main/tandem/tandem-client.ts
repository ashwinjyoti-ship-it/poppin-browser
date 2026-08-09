import type { TandemPageKind, TandemPageSnapshot, TandemWorkspaceSnapshot } from '../../shared/tandem';

/**
 * Thin REST client for the Tandem application (`unified-doc-management`).
 *
 * Poppin does not mirror every endpoint by hand: `GET /api/agent/catalog` is
 * Tandem's machine-readable capability source, and the operations below are the
 * ones Poppin's capability boundary actually needs.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_MARKDOWN_LENGTH = 60_000;

export interface TandemAccount {
  label: string | null;
  writable: boolean;
}

export interface TandemPageContent {
  pageId: string;
  title: string;
  markdown: string;
  truncated: boolean;
  updatedAt: string | null;
}

export class TandemApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class TandemClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Tandem's own capability catalog. Used to confirm the API surface is live. */
  async catalog(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/api/agent/catalog');
  }

  async me(): Promise<TandemAccount> {
    try {
      const user = await this.request<{ email?: string; name?: string }>('GET', '/api/auth/me');
      return { label: user.name || user.email || null, writable: true };
    } catch (error) {
      if (error instanceof TandemApiError && error.status === 401) throw error;
      // A catalog-only key still permits the documented write endpoints.
      return { label: null, writable: true };
    }
  }

  async listWorkspaces(): Promise<TandemWorkspaceSnapshot[]> {
    const response = await this.request<unknown>('GET', '/api/workspaces');
    return toArray(response).flatMap((entry) => {
      const id = stringField(entry, 'id');
      return id ? [{ id, name: stringField(entry, 'name') || 'Workspace' }] : [];
    });
  }

  async listPages(workspaceId: string): Promise<TandemPageSnapshot[]> {
    const response = await this.request<unknown>('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/pages`);
    return toArray(response).flatMap(toPageSnapshot);
  }

  async recentPages(): Promise<TandemPageSnapshot[]> {
    const response = await this.request<unknown>('GET', '/api/recent').catch(() => []);
    return toArray(response).flatMap(toPageSnapshot).slice(0, 20);
  }

  async search(query: string): Promise<TandemPageSnapshot[]> {
    const response = await this.request<unknown>('GET', `/api/search?q=${encodeURIComponent(query)}`);
    return toArray(response).flatMap(toPageSnapshot).slice(0, 40);
  }

  async readMarkdown(pageId: string): Promise<TandemPageContent> {
    const [page, markdown] = await Promise.all([
      this.request<unknown>('GET', `/api/pages/${encodeURIComponent(pageId)}`).catch(() => null),
      this.request<unknown>('GET', `/api/pages/${encodeURIComponent(pageId)}/markdown`),
    ]);
    const raw = extractMarkdown(markdown);
    const pageRecord = isRecord(page) && isRecord(page.page) ? page.page : page;
    return {
      pageId,
      title: stringField(pageRecord, 'title') || 'Untitled',
      markdown: raw.slice(0, MAX_MARKDOWN_LENGTH),
      truncated: raw.length > MAX_MARKDOWN_LENGTH,
      updatedAt: stringField(pageRecord, 'updated_at') || stringField(pageRecord, 'updatedAt') || null,
    };
  }

  async writeMarkdown(pageId: string, markdown: string): Promise<void> {
    await this.request('PUT', `/api/pages/${encodeURIComponent(pageId)}/markdown`, { markdown });
  }

  /** Appends without rewriting existing content. */
  async appendMarkdown(pageId: string, markdown: string): Promise<void> {
    const current = await this.readMarkdown(pageId);
    if (current.truncated) {
      throw new Error('This Tandem page is too large for a safe append. Edit the section directly instead.');
    }
    const separator = current.markdown.trim() ? '\n\n' : '';
    await this.writeMarkdown(pageId, `${current.markdown.trimEnd()}${separator}${markdown.trim()}\n`);
  }

  /** Surgical replacement, preserving everything else on the page. */
  async editSection(pageId: string, oldText: string, newText: string): Promise<void> {
    await this.request('POST', `/api/pages/${encodeURIComponent(pageId)}/edit-section`, {
      old_text: oldText,
      new_text: newText,
      occurrence: 'first',
      require_unique: false,
    });
  }

  async createPage(workspaceId: string, title: string, parentId: string | null, kind: TandemPageKind = 'page'): Promise<TandemPageSnapshot> {
    const response = await this.request<unknown>('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/pages`, {
      title,
      type: kind,
      ...(parentId ? { parentId } : {}),
    });
    const record = isRecord(response) && isRecord(response.page) ? response.page : response;
    const snapshot = toPageSnapshot(record)[0];
    if (!snapshot) throw new Error('Tandem did not return the created page.');
    return snapshot;
  }

  async listComments(pageId: string): Promise<Array<{ id: string; content: string; status: string }>> {
    const response = await this.request<unknown>('GET', `/api/pages/${encodeURIComponent(pageId)}/comments`);
    return toArray(response).flatMap((entry) => {
      const id = stringField(entry, 'id');
      return id ? [{ id, content: stringField(entry, 'content'), status: stringField(entry, 'status') || 'open' }] : [];
    });
  }

  async addComment(pageId: string, content: string): Promise<void> {
    await this.request('POST', `/api/pages/${encodeURIComponent(pageId)}/comments`, { content });
  }

  async listAgentComments(pageId: string): Promise<Array<{ id: string; prompt: string; selectionQuote: string }>> {
    const response = await this.request<unknown>('GET', `/api/pages/${encodeURIComponent(pageId)}/agent-comments?status=open`);
    return toArray(response).flatMap((entry) => {
      const id = stringField(entry, 'id');
      if (!id) return [];
      return [{
        id,
        prompt: stringField(entry, 'agent_prompt') || stringField(entry, 'content'),
        selectionQuote: stringField(entry, 'selection_quote'),
      }];
    });
  }

  async applyAgentComment(commentId: string, newText: string): Promise<void> {
    await this.request('POST', `/api/comments/${encodeURIComponent(commentId)}/apply`, { new_text: newText });
  }

  async importUrl(workspaceId: string, url: string, parentId: string | null): Promise<TandemPageSnapshot | null> {
    const response = await this.request<unknown>('POST', '/api/import-url', {
      url,
      workspaceId,
      ...(parentId ? { parentId } : {}),
    });
    const record = isRecord(response) && isRecord(response.page) ? response.page : response;
    return toPageSnapshot(record)[0] ?? null;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
        method,
        headers: {
          // The key never leaves Poppin's privileged main process.
          'X-API-Key': this.apiKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new TandemApiError(await errorMessage(response), response.status);
      }
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (error) {
      if (error instanceof TandemApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new Error('Tandem did not respond in time.');
      throw error instanceof Error ? error : new Error('Poppin could not reach Tandem.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) return 'Tandem rejected the API key. Create a new key in Tandem settings.';
  if (response.status === 403) return 'That Tandem workspace is not accessible with this key.';
  if (response.status === 404) return 'That Tandem page no longer exists.';
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // fall through to the raw body
  }
  return text.trim().slice(0, 300) || `Tandem returned HTTP ${response.status}.`;
}

function toPageSnapshot(value: unknown): TandemPageSnapshot[] {
  if (!isRecord(value)) return [];
  const id = stringField(value, 'id') || stringField(value, 'page_id') || stringField(value, 'pageId');
  if (!id) return [];
  const rawKind = stringField(value, 'type');
  const kind: TandemPageKind = rawKind === 'folder' || rawKind === 'database' || rawKind === 'canvas' ? rawKind : 'page';
  return [{
    id,
    title: stringField(value, 'title') || 'Untitled',
    kind,
    parentId: stringField(value, 'parent_id') || stringField(value, 'parentId') || null,
    icon: stringField(value, 'icon') || null,
    updatedAt: stringField(value, 'updated_at') || stringField(value, 'updatedAt') || null,
  }];
}

function extractMarkdown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.markdown === 'string') return value.markdown;
  if (isRecord(value) && typeof value.content === 'string') return value.content;
  return '';
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ['pages', 'results', 'workspaces', 'data', 'items', 'comments']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function stringField(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
