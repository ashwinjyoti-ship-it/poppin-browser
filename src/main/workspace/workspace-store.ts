import { DatabaseSync } from 'node:sqlite';

import type {
  TabContextSnapshot,
  WorkspaceDocumentSnapshot,
  WorkspaceRecordSnapshot,
} from '../../shared/workspace';

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

interface DocumentRow {
  id: string;
  name: string;
  path: string;
  size_bytes: number;
  selected: number;
  captured_text: string | null;
  truncated: number;
}

interface TabContextRow {
  tab_id: string;
  title: string;
  url: string;
  captured_text: string;
  truncated: number;
  captured_at: string;
}

export class WorkspaceStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY CHECK (id = 'primary'),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL,
        selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
        captured_text TEXT,
        truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS tab_context (
        tab_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        captured_text TEXT NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
        captured_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  getWorkspace(): WorkspaceRecordSnapshot | null {
    const row = this.database.prepare(
      'SELECT id, name, created_at FROM workspace WHERE id = ?'
    ).get('primary') as unknown as WorkspaceRow | undefined;
    if (!row) return null;
    return { id: 'primary', name: row.name, createdAt: row.created_at };
  }

  createWorkspace(name: string): WorkspaceRecordSnapshot {
    const workspace: WorkspaceRecordSnapshot = {
      id: 'primary',
      name,
      createdAt: new Date().toISOString(),
    };
    this.database.prepare(
      'INSERT INTO workspace (id, name, created_at) VALUES (?, ?, ?)'
    ).run(workspace.id, workspace.name, workspace.createdAt);
    return workspace;
  }

  renameWorkspace(name: string): void {
    this.database.prepare('UPDATE workspace SET name = ? WHERE id = ?').run(name, 'primary');
  }

  listDocuments(): WorkspaceDocumentSnapshot[] {
    const rows = this.database.prepare(
      'SELECT id, name, path, size_bytes, selected, captured_text, truncated FROM documents ORDER BY name COLLATE NOCASE'
    ).all() as unknown as DocumentRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      sizeBytes: row.size_bytes,
      selected: Boolean(row.selected),
      capturedText: row.captured_text,
      truncated: Boolean(row.truncated),
    }));
  }

  upsertDocument(document: Omit<WorkspaceDocumentSnapshot, 'selected'>): void {
    this.database.prepare(`
      INSERT INTO documents (id, name, path, size_bytes, captured_text, truncated)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        size_bytes = excluded.size_bytes
    `).run(
      document.id,
      document.name,
      document.path,
      document.sizeBytes,
      document.capturedText,
      Number(document.truncated),
    );
  }

  setDocumentContext(documentId: string, selected: boolean, capturedText: string | null, truncated: boolean): boolean {
    const result = this.database.prepare(
      'UPDATE documents SET selected = ?, captured_text = ?, truncated = ? WHERE id = ?'
    ).run(Number(selected), capturedText, Number(truncated), documentId);
    return result.changes > 0;
  }

  removeDocument(documentId: string): void {
    this.database.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
  }

  listTabContexts(): TabContextSnapshot[] {
    const rows = this.database.prepare(
      'SELECT tab_id, title, url, captured_text, truncated, captured_at FROM tab_context ORDER BY captured_at'
    ).all() as unknown as TabContextRow[];
    return rows.map((row) => ({
      tabId: row.tab_id,
      title: row.title,
      url: row.url,
      capturedText: row.captured_text,
      truncated: Boolean(row.truncated),
      capturedAt: row.captured_at,
    }));
  }

  upsertTabContext(context: TabContextSnapshot): void {
    this.database.prepare(`
      INSERT INTO tab_context (tab_id, title, url, captured_text, truncated, captured_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tab_id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        captured_text = excluded.captured_text,
        truncated = excluded.truncated,
        captured_at = excluded.captured_at
    `).run(
      context.tabId,
      context.title,
      context.url,
      context.capturedText,
      Number(context.truncated),
      context.capturedAt,
    );
  }

  removeTabContext(tabId: string): void {
    this.database.prepare('DELETE FROM tab_context WHERE tab_id = ?').run(tabId);
  }

  close(): void {
    this.database.close();
  }
}
