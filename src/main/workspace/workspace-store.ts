import { DatabaseSync } from 'node:sqlite';

import type { WorkspaceRecordSnapshot } from '../../shared/workspace';

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
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

  close(): void {
    this.database.close();
  }
}
