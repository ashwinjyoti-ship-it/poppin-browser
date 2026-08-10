import type { TandemPageKind, TandemPageSnapshot, TandemWorkspaceSnapshot } from '../../shared/tandem';

/**
 * The integration boundary Poppin uses for a Tandem deployment.
 *
 * Tandem World is hosted as an unprivileged remote surface, while agent and
 * context operations use this API boundary. Neither BrowserEngine nor the
 * renderer constructs deployment routes or knows the REST transport.
 */
export interface TandemProvider {
  readonly id: 'tandem';
  worldUrl(pageId?: string): string;
  catalog(): Promise<Record<string, unknown>>;
  me(): Promise<{ label: string | null; writable: boolean }>;
  listWorkspaces(): Promise<TandemWorkspaceSnapshot[]>;
  listPages(workspaceId: string): Promise<TandemPageSnapshot[]>;
  recentPages(): Promise<TandemPageSnapshot[]>;
  search(query: string): Promise<TandemPageSnapshot[]>;
  readMarkdown(pageId: string): Promise<{ pageId: string; title: string; markdown: string; truncated: boolean; updatedAt: string | null }>;
  writeMarkdown(pageId: string, markdown: string): Promise<void>;
  appendMarkdown(pageId: string, markdown: string): Promise<void>;
  editSection(pageId: string, oldText: string, newText: string): Promise<void>;
  createPage(workspaceId: string, title: string, parentId: string | null, kind?: TandemPageKind): Promise<TandemPageSnapshot>;
  listComments(pageId: string): Promise<unknown[]>;
  addComment(pageId: string, content: string): Promise<void>;
  listAgentComments(pageId: string): Promise<unknown[]>;
  applyAgentComment(commentId: string, replacement: string): Promise<void>;
  importUrl(workspaceId: string, url: string, parentId: string | null): Promise<TandemPageSnapshot | null>;
}

export type CreateTandemProvider = (baseUrl: string, apiKey: string) => TandemProvider;
