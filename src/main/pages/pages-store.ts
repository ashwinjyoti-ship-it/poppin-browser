import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type {
  DatabasePropertySnapshot,
  DatabasePropertyType,
  DatabaseRowSnapshot,
  DatabaseViewSnapshot,
  DatabaseViewType,
  NativePageTabSnapshot,
  PageBlockSnapshot,
  PageCommentSnapshot,
  PageDocumentSnapshot,
  PageJsonValue,
  PageKind,
  PageSnapshot,
  PageViewStateSnapshot,
} from '../../shared/pages';

interface PageRow {
  id: string;
  title: string;
  parent_id: string | null;
  kind: PageKind;
  created_at: string;
  updated_at: string;
}

interface BlockRow {
  id: string;
  page_id: string;
  type: string;
  content_json: string;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: string;
  page_id: string;
  block_id: string;
  selection_quote: string;
  selection_hash: string;
  block_version: number;
  selection_start: number | null;
  selection_end: number | null;
  instruction: string;
  status: 'open' | 'resolved';
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface DatabasePropertyRow {
  id: string;
  database_id: string;
  name: string;
  type: DatabasePropertyType;
  options_json: string;
  position: number;
}

interface DatabaseRowRow {
  id: string;
  database_id: string;
  properties_json: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface DatabaseViewRow {
  id: string;
  database_id: string;
  name: string;
  view_type: DatabaseViewType;
  filters_json: string;
  sorts_json: string;
  view_state_json: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface PageViewStateRow {
  page_id: string;
  kind: PageKind;
  state_json: string;
  updated_at: string;
}

export interface CreatePageInput {
  id?: string;
  title: string;
  parentId?: string | null;
  kind?: PageKind;
}

export interface AddBlockInput {
  id?: string;
  pageId: string;
  type: string;
  content: PageJsonValue;
  position?: number;
}

export interface AddCommentInput {
  id?: string;
  pageId: string;
  blockId: string;
  selectionQuote: string;
  instruction: string;
  start?: number | null;
  end?: number | null;
}

export interface PageContentProtector {
  available: () => boolean;
  encrypt: (text: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export class PagesStore {
  private readonly database: DatabaseSync;
  private transactionDepth = 0;

  constructor(filePath: string, private readonly protector?: PageContentProtector) {
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('page', 'database')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
      CREATE TABLE IF NOT EXISTS page_blocks (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        position REAL NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(id, page_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_page_blocks_page ON page_blocks(page_id, position);
      CREATE TABLE IF NOT EXISTS page_comments (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        block_id TEXT NOT NULL,
        selection_quote TEXT NOT NULL,
        selection_hash TEXT NOT NULL,
        block_version INTEGER NOT NULL CHECK (block_version > 0),
        selection_start INTEGER,
        selection_end INTEGER,
        instruction TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        FOREIGN KEY(block_id, page_id) REFERENCES page_blocks(id, page_id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_page_comments_page_status ON page_comments(page_id, status, created_at);
      CREATE TABLE IF NOT EXISTS database_properties (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'multi_select', 'relation', 'checkbox')),
        options_json TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_database_properties_database ON database_properties(database_id, position);
      CREATE TABLE IF NOT EXISTS database_rows (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        properties_json TEXT NOT NULL DEFAULT '{}',
        position REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_database_rows_database ON database_rows(database_id, position);
      CREATE TABLE IF NOT EXISTS database_views (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        view_type TEXT NOT NULL DEFAULT 'table' CHECK (view_type IN ('table', 'board', 'calendar')),
        filters_json TEXT NOT NULL DEFAULT '[]',
        sorts_json TEXT NOT NULL DEFAULT '[]',
        view_state_json TEXT NOT NULL DEFAULT '{}',
        position REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_database_views_database ON database_views(database_id, position);
      CREATE TABLE IF NOT EXISTS page_view_state (
        page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('page', 'database')),
        state_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS page_tabs (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL UNIQUE REFERENCES pages(id) ON DELETE CASCADE,
        position REAL NOT NULL,
        active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_page_tabs_position ON page_tabs(position);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_page_tabs_one_active ON page_tabs(active) WHERE active = 1;
      CREATE TABLE IF NOT EXISTS page_context (
        page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS protected_pages (
        page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL UNIQUE CHECK (purpose IN ('memory'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS task_documents (
        thread_id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL UNIQUE REFERENCES pages(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS page_block_secrets (
        block_id TEXT PRIMARY KEY REFERENCES page_blocks(id) ON DELETE CASCADE,
        ciphertext BLOB NOT NULL
      ) STRICT;
    `);
  }

  runInTransaction<T>(work: (store: PagesStore) => T): T {
    return this.transaction(() => work(this));
  }

  createPage(input: CreatePageInput): PageSnapshot {
    return this.transaction(() => {
      const title = requiredText(input.title, 'Page title');
      const id = input.id ?? randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO pages (id, title, parent_id, kind, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, title, input.parentId ?? null, input.kind ?? 'page', now, now);
      return this.requirePage(id);
    });
  }

  listPages(): PageSnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, title, parent_id, kind, created_at, updated_at
      FROM pages ORDER BY parent_id IS NOT NULL, title COLLATE NOCASE, created_at
    `).all() as unknown as PageRow[];
    return rows.map(pageSnapshot);
  }

  openMemory(): NativePageTabSnapshot {
    return this.transaction(() => {
      const pageId = this.ensureMemoryPage();
      return this.openPage(pageId);
    });
  }

  /**
   * Returns the OS-encrypted Memory page id, creating an initialized page on
   * first use. Unlike {@link openMemory}, this does not activate a Pages tab.
   */
  ensureMemoryPage(): string {
    return this.transaction(() => {
      const existing = this.database.prepare("SELECT page_id FROM protected_pages WHERE purpose = 'memory'").get() as { page_id: string } | undefined;
      if (existing) return existing.page_id;
      if (!this.protector?.available()) throw new Error('OS-backed encryption is not available, so Memory was not created.');
      const pageId = this.createPage({ title: 'Memory', kind: 'page' }).id;
      this.database.prepare("INSERT INTO protected_pages (page_id, purpose) VALUES (?, 'memory')").run(pageId);
      this.addBlock({ pageId, type: 'paragraph', content: { text: 'Keep durable notes, preferences, and working context here.' } });
      return pageId;
    });
  }

  findMemoryPageId(): string | null {
    const row = this.database.prepare("SELECT page_id FROM protected_pages WHERE purpose = 'memory'").get() as { page_id: string } | undefined;
    return row?.page_id ?? null;
  }

  appendMemory(markdown: string): PageBlockSnapshot {
    const text = markdown.replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error('Provide non-empty content to append to Memory.');
    return this.transaction(() => {
      const pageId = this.ensureMemoryPage();
      return this.addBlock({ pageId, type: 'paragraph', content: { text } });
    });
  }

  renamePage(pageId: string, title: string): PageSnapshot {
    const now = new Date().toISOString();
    const result = this.database.prepare('UPDATE pages SET title = ?, updated_at = ? WHERE id = ?')
      .run(requiredText(title, 'Page title'), now, pageId);
    if (result.changes === 0) throw new Error('Page not found.');
    return this.requirePage(pageId);
  }

  movePage(pageId: string, parentId: string | null): PageSnapshot {
    this.requirePage(pageId);
    if (parentId === pageId) throw new Error('A page cannot be its own parent.');
    if (parentId) {
      this.requirePage(parentId);
      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === pageId) throw new Error('A page cannot be moved inside one of its descendants.');
        cursor = this.requirePage(cursor).parentId;
      }
    }
    this.database.prepare('UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ?')
      .run(parentId, new Date().toISOString(), pageId);
    return this.requirePage(pageId);
  }

  deletePage(pageId: string): void {
    const result = this.database.prepare('DELETE FROM pages WHERE id = ?').run(pageId);
    if (result.changes === 0) throw new Error('Page not found.');
    this.ensureActiveTab();
  }

  listTabs(): NativePageTabSnapshot[] {
    return (this.database.prepare(`
      SELECT t.id, t.page_id, p.kind, p.title, t.position
      FROM page_tabs t JOIN pages p ON p.id = t.page_id ORDER BY t.position
    `).all() as unknown as Array<{ id: string; page_id: string; kind: PageKind; title: string; position: number }>).map((row) => ({
      id: row.id, pageId: row.page_id, kind: row.kind, title: row.title, position: row.position,
    }));
  }

  getActiveTabId(): string | null {
    const row = this.database.prepare('SELECT id FROM page_tabs WHERE active = 1').get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  openPage(pageId: string): NativePageTabSnapshot {
    return this.transaction(() => {
      const page = this.requirePage(pageId);
      const existing = this.database.prepare('SELECT id FROM page_tabs WHERE page_id = ?').get(pageId) as { id: string } | undefined;
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        const position = this.nextTabPosition();
        this.database.prepare('INSERT INTO page_tabs (id, page_id, position, active) VALUES (?, ?, ?, 0)')
          .run(id, pageId, position);
      }
      this.activateTab(id);
      return { id, pageId, kind: page.kind, title: page.title, position: this.tabPosition(id) };
    });
  }

  activateTab(tabId: string): void {
    const exists = this.database.prepare('SELECT 1 AS present FROM page_tabs WHERE id = ?').get(tabId);
    if (!exists) throw new Error('Page tab not found.');
    this.database.prepare('UPDATE page_tabs SET active = 0 WHERE active = 1').run();
    this.database.prepare('UPDATE page_tabs SET active = 1 WHERE id = ?').run(tabId);
  }

  deactivateTabs(): void {
    this.database.prepare('UPDATE page_tabs SET active = 0 WHERE active = 1').run();
  }

  closeTab(tabId: string): void {
    const wasActive = this.getActiveTabId() === tabId;
    const result = this.database.prepare('DELETE FROM page_tabs WHERE id = ?').run(tabId);
    if (result.changes === 0) throw new Error('Page tab not found.');
    if (wasActive) this.ensureActiveTab();
  }

  reorderTab(tabId: string, beforeTabId: string | null): void {
    const ordered = this.listTabs().map((tab) => tab.id);
    const from = ordered.indexOf(tabId);
    if (from < 0) throw new Error('Page tab not found.');
    ordered.splice(from, 1);
    const before = beforeTabId ? ordered.indexOf(beforeTabId) : -1;
    ordered.splice(before < 0 ? ordered.length : before, 0, tabId);
    this.transaction(() => ordered.forEach((id, index) => {
      this.database.prepare('UPDATE page_tabs SET position = ? WHERE id = ?').run(index, id);
    }));
  }

  setPageSelected(pageId: string, selected: boolean): void {
    this.requirePage(pageId);
    this.database.prepare(`
      INSERT INTO page_context (page_id, selected) VALUES (?, ?)
      ON CONFLICT(page_id) DO UPDATE SET selected = excluded.selected
    `).run(pageId, Number(selected));
  }

  listSelectedPageIds(): string[] {
    return (this.database.prepare('SELECT page_id FROM page_context WHERE selected = 1 ORDER BY page_id').all() as unknown as Array<{ page_id: string }>).map((row) => row.page_id);
  }

  getPage(pageId: string): PageDocumentSnapshot | null {
    const page = this.findPage(pageId);
    if (!page) return null;
    return {
      page,
      blocks: this.listBlocks(pageId),
      comments: this.listComments(pageId),
      viewState: this.getViewState(pageId),
      database: page.kind === 'database' ? {
        properties: this.listDatabaseProperties(pageId),
        rows: this.listDatabaseRows(pageId),
        views: this.listDatabaseViews(pageId),
      } : null,
    };
  }

  addBlock(input: AddBlockInput): PageBlockSnapshot {
    return this.transaction(() => {
      this.requirePage(input.pageId);
      const id = input.id ?? randomUUID();
      const now = new Date().toISOString();
      const position = input.position ?? this.nextPosition('page_blocks', 'page_id', input.pageId);
      this.database.prepare(`
        INSERT INTO page_blocks (id, page_id, type, content_json, position, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, input.pageId, requiredText(input.type, 'Block type'), this.isProtectedPage(input.pageId) ? json({ protected: true }) : json(input.content), position, now, now);
      if (this.isProtectedPage(input.pageId)) this.writeSecret(id, input.content);
      return this.requireBlock(id);
    });
  }

  updateBlock(blockId: string, expectedVersion: number, content: PageJsonValue): PageBlockSnapshot {
    return this.transaction(() => {
      const block = this.requireBlock(blockId);
      const protectedPage = this.isProtectedPage(block.pageId);
      const now = new Date().toISOString();
      const result = this.database.prepare(`
        UPDATE page_blocks SET content_json = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(protectedPage ? json({ protected: true }) : json(content), now, blockId, expectedVersion);
      if (result.changes === 0) throw new Error('The block changed since this edit was prepared.');
      if (protectedPage) this.writeSecret(blockId, content);
      return this.requireBlock(blockId);
    });
  }

  listBlocks(pageId: string): PageBlockSnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, page_id, type, content_json, position, version, created_at, updated_at
      FROM page_blocks WHERE page_id = ? ORDER BY position, created_at
    `).all(pageId) as unknown as BlockRow[];
    return rows.map((row) => this.blockSnapshot(row));
  }

  addComment(input: AddCommentInput): PageCommentSnapshot {
    return this.transaction(() => {
      const block = this.requireBlock(input.blockId);
      if (block.pageId !== input.pageId) throw new Error('The selected block does not belong to this page.');
      const quote = requiredText(input.selectionQuote, 'Selection quote');
      const instruction = requiredText(input.instruction, 'Comment instruction');
      const start = input.start ?? null;
      const end = input.end ?? null;
      if (start !== null && (!Number.isInteger(start) || start < 0)) throw new Error('Selection start must be a non-negative integer.');
      if (end !== null && (!Number.isInteger(end) || end < (start ?? 0))) throw new Error('Selection end must follow selection start.');
      const id = input.id ?? randomUUID();
      const now = new Date().toISOString();
      const hash = selectionHash(block.id, block.version, quote, start, end);
      this.database.prepare(`
        INSERT INTO page_comments (
          id, page_id, block_id, selection_quote, selection_hash, block_version,
          selection_start, selection_end, instruction, status, created_at, updated_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)
      `).run(id, input.pageId, input.blockId, quote, hash, block.version, start, end, instruction, now, now);
      return this.requireComment(id);
    });
  }

  resolveComment(commentId: string): PageCommentSnapshot {
    const now = new Date().toISOString();
    const result = this.database.prepare(`
      UPDATE page_comments SET status = 'resolved', updated_at = ?, resolved_at = ? WHERE id = ?
    `).run(now, now, commentId);
    if (result.changes === 0) throw new Error('Comment not found.');
    return this.requireComment(commentId);
  }

  applyComment(commentId: string, replacement: string): PageCommentSnapshot {
    return this.transaction(() => {
      const comment = this.requireComment(commentId);
      if (comment.status !== 'open') throw new Error('This comment is already resolved.');
      const block = this.requireBlock(comment.blockId);
      if (block.version !== comment.selection.blockVersion) throw new Error('The selected block changed after this comment was created.');
      const text = blockText(block.content);
      const start = comment.selection.start ?? text.indexOf(comment.selection.quote);
      const end = comment.selection.end ?? (start >= 0 ? start + comment.selection.quote.length : -1);
      if (start < 0 || end < start || text.slice(start, end) !== comment.selection.quote) {
        throw new Error('The selected text no longer matches this comment.');
      }
      this.updateBlock(block.id, block.version, { text: `${text.slice(0, start)}${replacement}${text.slice(end)}` });
      return this.resolveComment(commentId);
    });
  }

  listComments(pageId: string, status?: 'open' | 'resolved'): PageCommentSnapshot[] {
    const rows = (status
      ? this.database.prepare(`${COMMENT_SELECT} WHERE page_id = ? AND status = ? ORDER BY created_at`).all(pageId, status)
      : this.database.prepare(`${COMMENT_SELECT} WHERE page_id = ? ORDER BY created_at`).all(pageId)) as unknown as CommentRow[];
    return rows.map(commentSnapshot);
  }

  addDatabaseProperty(databaseId: string, input: { id?: string; name: string; type: DatabasePropertyType; options?: PageJsonValue[]; position?: number }): DatabasePropertySnapshot {
    return this.transaction(() => {
      this.requireDatabase(databaseId);
      const id = input.id ?? randomUUID();
      const position = input.position ?? this.nextPosition('database_properties', 'database_id', databaseId);
      this.database.prepare(`
        INSERT INTO database_properties (id, database_id, name, type, options_json, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, databaseId, requiredText(input.name, 'Property name'), input.type, json(input.options ?? []), position);
      return this.requireDatabaseProperty(id);
    });
  }

  addDatabaseRow(databaseId: string, properties: Record<string, PageJsonValue>, input: { id?: string; position?: number } = {}): DatabaseRowSnapshot {
    return this.transaction(() => {
      this.requireDatabase(databaseId);
      this.validateDatabasePropertyIds(databaseId, properties);
      const id = input.id ?? randomUUID();
      const now = new Date().toISOString();
      const position = input.position ?? this.nextPosition('database_rows', 'database_id', databaseId);
      this.database.prepare(`
        INSERT INTO database_rows (id, database_id, properties_json, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, databaseId, json(properties), position, now, now);
      return this.requireDatabaseRow(id);
    });
  }

  updateDatabaseRow(rowId: string, properties: Record<string, PageJsonValue>): DatabaseRowSnapshot {
    const row = this.requireDatabaseRow(rowId);
    this.validateDatabasePropertyIds(row.databaseId, properties);
    const result = this.database.prepare('UPDATE database_rows SET properties_json = ?, updated_at = ? WHERE id = ?')
      .run(json(properties), new Date().toISOString(), rowId);
    if (result.changes === 0) throw new Error('Database row not found.');
    return this.requireDatabaseRow(rowId);
  }

  deleteDatabaseRow(rowId: string): void {
    const result = this.database.prepare('DELETE FROM database_rows WHERE id = ?').run(rowId);
    if (result.changes === 0) throw new Error('Database row not found.');
  }

  addDatabaseView(databaseId: string, input: {
    id?: string;
    name: string;
    viewType?: DatabaseViewType;
    filters?: PageJsonValue[];
    sorts?: PageJsonValue[];
    viewState?: Record<string, PageJsonValue>;
    position?: number;
  }): DatabaseViewSnapshot {
    return this.transaction(() => {
      this.requireDatabase(databaseId);
      const id = input.id ?? randomUUID();
      const now = new Date().toISOString();
      const position = input.position ?? this.nextPosition('database_views', 'database_id', databaseId);
      this.database.prepare(`
        INSERT INTO database_views (
          id, database_id, name, view_type, filters_json, sorts_json, view_state_json,
          position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, databaseId, requiredText(input.name, 'View name'), input.viewType ?? 'table',
        json(input.filters ?? []), json(input.sorts ?? []), json(input.viewState ?? {}), position, now, now,
      );
      return this.requireDatabaseView(id);
    });
  }

  saveViewState(pageId: string, state: Record<string, PageJsonValue>): PageViewStateSnapshot {
    const page = this.requirePage(pageId);
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO page_view_state (page_id, kind, state_json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(page_id) DO UPDATE SET
        kind = excluded.kind,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(pageId, page.kind, json(state), now);
    return { pageId, kind: page.kind, state, updatedAt: now };
  }

  getViewState(pageId: string): PageViewStateSnapshot | null {
    const row = this.database.prepare(`
      SELECT page_id, kind, state_json, updated_at FROM page_view_state WHERE page_id = ?
    `).get(pageId) as unknown as PageViewStateRow | undefined;
    if (!row) return null;
    const page = this.requirePage(pageId);
    if (row.kind !== page.kind) throw new Error('Stored page view kind does not match the page kind.');
    return { pageId: row.page_id, kind: row.kind, state: parseObject(row.state_json), updatedAt: row.updated_at };
  }

  close(): void {
    this.database.close();
  }

  private transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    this.database.exec('BEGIN IMMEDIATE');
    this.transactionDepth += 1;
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private findPage(pageId: string): PageSnapshot | null {
    const row = this.database.prepare(`
      SELECT id, title, parent_id, kind, created_at, updated_at FROM pages WHERE id = ?
    `).get(pageId) as unknown as PageRow | undefined;
    return row ? pageSnapshot(row) : null;
  }

  private requirePage(pageId: string): PageSnapshot {
    const page = this.findPage(pageId);
    if (!page) throw new Error('Page not found.');
    return page;
  }

  private requireDatabase(databaseId: string): PageSnapshot {
    const page = this.requirePage(databaseId);
    if (page.kind !== 'database') throw new Error('This page is not a database.');
    return page;
  }

  private requireBlock(blockId: string): PageBlockSnapshot {
    const row = this.database.prepare(`
      SELECT id, page_id, type, content_json, position, version, created_at, updated_at
      FROM page_blocks WHERE id = ?
    `).get(blockId) as unknown as BlockRow | undefined;
    if (!row) throw new Error('Block not found.');
    return this.blockSnapshot(row);
  }

  private requireComment(commentId: string): PageCommentSnapshot {
    const row = this.database.prepare(`${COMMENT_SELECT} WHERE id = ?`).get(commentId) as unknown as CommentRow | undefined;
    if (!row) throw new Error('Comment not found.');
    return commentSnapshot(row);
  }

  private requireDatabaseProperty(id: string): DatabasePropertySnapshot {
    const row = this.database.prepare(`
      SELECT id, database_id, name, type, options_json, position FROM database_properties WHERE id = ?
    `).get(id) as unknown as DatabasePropertyRow | undefined;
    if (!row) throw new Error('Database property not found.');
    return databasePropertySnapshot(row);
  }

  private requireDatabaseRow(id: string): DatabaseRowSnapshot {
    const row = this.database.prepare(`
      SELECT id, database_id, properties_json, position, created_at, updated_at FROM database_rows WHERE id = ?
    `).get(id) as unknown as DatabaseRowRow | undefined;
    if (!row) throw new Error('Database row not found.');
    return databaseRowSnapshot(row);
  }

  private requireDatabaseView(id: string): DatabaseViewSnapshot {
    const row = this.database.prepare(`
      SELECT id, database_id, name, view_type, filters_json, sorts_json, view_state_json,
        position, created_at, updated_at FROM database_views WHERE id = ?
    `).get(id) as unknown as DatabaseViewRow | undefined;
    if (!row) throw new Error('Database view not found.');
    return databaseViewSnapshot(row);
  }

  private listDatabaseProperties(databaseId: string): DatabasePropertySnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, database_id, name, type, options_json, position
      FROM database_properties WHERE database_id = ? ORDER BY position
    `).all(databaseId) as unknown as DatabasePropertyRow[];
    return rows.map(databasePropertySnapshot);
  }

  private listDatabaseRows(databaseId: string): DatabaseRowSnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, database_id, properties_json, position, created_at, updated_at
      FROM database_rows WHERE database_id = ? ORDER BY position
    `).all(databaseId) as unknown as DatabaseRowRow[];
    return rows.map(databaseRowSnapshot);
  }

  private listDatabaseViews(databaseId: string): DatabaseViewSnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, database_id, name, view_type, filters_json, sorts_json, view_state_json,
        position, created_at, updated_at FROM database_views WHERE database_id = ? ORDER BY position
    `).all(databaseId) as unknown as DatabaseViewRow[];
    return rows.map(databaseViewSnapshot);
  }

  private validateDatabasePropertyIds(databaseId: string, properties: Record<string, PageJsonValue>): void {
    const allowed = new Set(this.listDatabaseProperties(databaseId).map((property) => property.id));
    for (const propertyId of Object.keys(properties)) {
      if (!allowed.has(propertyId)) throw new Error(`Unknown database property: ${propertyId}`);
    }
  }

  private nextPosition(table: 'page_blocks' | 'database_properties' | 'database_rows' | 'database_views', ownerColumn: 'page_id' | 'database_id', ownerId: string): number {
    const row = this.database.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM ${table} WHERE ${ownerColumn} = ?`).get(ownerId) as { position: number };
    return row.position;
  }

  private nextTabPosition(): number {
    const row = this.database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM page_tabs').get() as { position: number };
    return row.position;
  }

  private tabPosition(tabId: string): number {
    const row = this.database.prepare('SELECT position FROM page_tabs WHERE id = ?').get(tabId) as { position: number } | undefined;
    if (!row) throw new Error('Page tab not found.');
    return row.position;
  }

  private ensureActiveTab(): void {
    if (this.getActiveTabId()) return;
    const row = this.database.prepare('SELECT id FROM page_tabs ORDER BY position LIMIT 1').get() as { id: string } | undefined;
    if (row) this.activateTab(row.id);
  }

  private isProtectedPage(pageId: string): boolean {
    return Boolean(this.database.prepare('SELECT 1 AS protected FROM protected_pages WHERE page_id = ?').get(pageId));
  }

  private writeSecret(blockId: string, content: PageJsonValue): void {
    if (!this.protector?.available()) throw new Error('OS-backed encryption is unavailable. Memory was not saved.');
    const ciphertext = this.protector.encrypt(json(content));
    this.database.prepare(`
      INSERT INTO page_block_secrets (block_id, ciphertext) VALUES (?, ?)
      ON CONFLICT(block_id) DO UPDATE SET ciphertext = excluded.ciphertext
    `).run(blockId, ciphertext);
  }

  private blockSnapshot(row: BlockRow): PageBlockSnapshot {
    if (!this.isProtectedPage(row.page_id)) return blockSnapshot(row);
    if (!this.protector?.available()) throw new Error('OS-backed encryption is unavailable. Memory cannot be opened.');
    const secret = this.database.prepare('SELECT ciphertext FROM page_block_secrets WHERE block_id = ?').get(row.id) as { ciphertext: Uint8Array } | undefined;
    if (!secret) throw new Error('Encrypted Memory content is missing.');
    return blockSnapshot({ ...row, content_json: this.protector.decrypt(Buffer.from(secret.ciphertext)) });
  }
}

const COMMENT_SELECT = `SELECT id, page_id, block_id, selection_quote, selection_hash, block_version,
  selection_start, selection_end, instruction, status, created_at, updated_at, resolved_at FROM page_comments`;

function pageSnapshot(row: PageRow): PageSnapshot {
  return { id: row.id, title: row.title, parentId: row.parent_id, kind: row.kind, createdAt: row.created_at, updatedAt: row.updated_at };
}

function blockSnapshot(row: BlockRow): PageBlockSnapshot {
  return {
    id: row.id, pageId: row.page_id, type: row.type, content: JSON.parse(row.content_json) as PageJsonValue,
    position: row.position, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function commentSnapshot(row: CommentRow): PageCommentSnapshot {
  return {
    id: row.id, pageId: row.page_id, blockId: row.block_id,
    selection: {
      quote: row.selection_quote, hash: row.selection_hash, blockVersion: row.block_version,
      start: row.selection_start, end: row.selection_end,
    },
    instruction: row.instruction, status: row.status, createdAt: row.created_at,
    updatedAt: row.updated_at, resolvedAt: row.resolved_at,
  };
}

function databasePropertySnapshot(row: DatabasePropertyRow): DatabasePropertySnapshot {
  return {
    id: row.id, databaseId: row.database_id, name: row.name, type: row.type,
    options: JSON.parse(row.options_json) as PageJsonValue[], position: row.position,
  };
}

function databaseRowSnapshot(row: DatabaseRowRow): DatabaseRowSnapshot {
  return {
    id: row.id, databaseId: row.database_id, properties: parseObject(row.properties_json),
    position: row.position, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function databaseViewSnapshot(row: DatabaseViewRow): DatabaseViewSnapshot {
  return {
    id: row.id, databaseId: row.database_id, name: row.name, viewType: row.view_type,
    filters: JSON.parse(row.filters_json) as PageJsonValue[], sorts: JSON.parse(row.sorts_json) as PageJsonValue[],
    viewState: parseObject(row.view_state_json), position: row.position,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function selectionHash(blockId: string, blockVersion: number, quote: string, start: number | null, end: number | null): string {
  return createHash('sha256').update(json({ blockId, blockVersion, quote, start, end })).digest('hex');
}

function requiredText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Value is not JSON serializable.');
  return serialized;
}

function parseObject(value: string): Record<string, PageJsonValue> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Stored value is not a JSON object.');
  return parsed as Record<string, PageJsonValue>;
}

function blockText(content: PageJsonValue): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const text = content.text;
    if (typeof text === 'string') return text;
  }
  throw new Error('This block does not contain editable text.');
}
