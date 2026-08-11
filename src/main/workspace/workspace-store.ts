import { DatabaseSync } from 'node:sqlite';

import type {
  BrowserSessionSnapshot,
  ContextPackSnapshot,
  RecipeSnapshot,
  RecipeStepSnapshot,
  TabContextSnapshot,
  WorkspaceDocumentSnapshot,
  WorkspaceRecordSnapshot,
  WorkspaceProjectSnapshot,
  VisualSelectionSnapshot,
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

interface ProjectRow {
  repository_path: string;
  remote: string | null;
  branch: string;
  install_command: string;
  dev_command: string;
  preview_url: string;
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
      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY CHECK (id = 'primary'),
        repository_path TEXT NOT NULL,
        remote TEXT,
        branch TEXT NOT NULL,
        install_command TEXT NOT NULL DEFAULT '',
        dev_command TEXT NOT NULL DEFAULT '',
        preview_url TEXT NOT NULL DEFAULT 'http://localhost:3000'
      ) STRICT;
      CREATE TABLE IF NOT EXISTS visual_selection (
        id TEXT PRIMARY KEY CHECK (id = 'primary'),
        selection_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS context_packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tab_refs_json TEXT NOT NULL DEFAULT '[]',
        document_ids_json TEXT NOT NULL DEFAULT '[]',
        tandem_page_ids_json TEXT NOT NULL DEFAULT '[]',
        include_memory INTEGER NOT NULL DEFAULT 0 CHECK (include_memory IN (0, 1)),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS memory_state (
        id TEXT PRIMARY KEY CHECK (id = 'primary'),
        selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS browser_sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tabs_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start_url TEXT,
        steps_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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

  getProject(): WorkspaceProjectSnapshot | null {
    const row = this.database.prepare(`
      SELECT repository_path, remote, branch, install_command, dev_command, preview_url
      FROM project WHERE id = ?
    `).get('primary') as unknown as ProjectRow | undefined;
    if (!row) return null;
    return {
      repositoryPath: row.repository_path,
      remote: row.remote,
      branch: row.branch,
      installCommand: row.install_command,
      devCommand: row.dev_command,
      previewUrl: row.preview_url,
    };
  }

  saveProject(project: WorkspaceProjectSnapshot): void {
    this.database.prepare(`
      INSERT INTO project (id, repository_path, remote, branch, install_command, dev_command, preview_url)
      VALUES ('primary', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        repository_path = excluded.repository_path,
        remote = excluded.remote,
        branch = excluded.branch,
        install_command = excluded.install_command,
        dev_command = excluded.dev_command,
        preview_url = excluded.preview_url
    `).run(
      project.repositoryPath,
      project.remote,
      project.branch,
      project.installCommand,
      project.devCommand,
      project.previewUrl,
    );
  }

  getVisualSelection(): VisualSelectionSnapshot | null {
    const row = this.database.prepare("SELECT selection_json FROM visual_selection WHERE id = 'primary'").get() as { selection_json: string } | undefined;
    if (!row) return null;
    try {
      const value = JSON.parse(row.selection_json) as VisualSelectionSnapshot;
      return isVisualSelection(value) ? value : null;
    } catch {
      return null;
    }
  }

  saveVisualSelection(selection: VisualSelectionSnapshot): void {
    this.database.prepare(`
      INSERT INTO visual_selection (id, selection_json) VALUES ('primary', ?)
      ON CONFLICT(id) DO UPDATE SET selection_json = excluded.selection_json
    `).run(JSON.stringify(selection));
  }

  clearVisualSelection(): void {
    this.database.prepare("DELETE FROM visual_selection WHERE id = 'primary'").run();
  }

  isMemorySelected(): boolean {
    const row = this.database.prepare("SELECT selected FROM memory_state WHERE id = 'primary'").get() as { selected: number } | undefined;
    return Boolean(row?.selected);
  }

  setMemorySelected(selected: boolean): void {
    this.database.prepare(`
      INSERT INTO memory_state (id, selected) VALUES ('primary', ?)
      ON CONFLICT(id) DO UPDATE SET selected = excluded.selected
    `).run(Number(selected));
  }

  listContextPacks(): ContextPackSnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, name, tab_refs_json, document_ids_json, tandem_page_ids_json, include_memory, created_at
      FROM context_packs ORDER BY created_at
    `).all() as unknown as Array<{
      id: string; name: string; tab_refs_json: string; document_ids_json: string;
      tandem_page_ids_json: string; include_memory: number; created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      tabRefs: parseTabRefs(row.tab_refs_json),
      documentIds: parseStringArray(row.document_ids_json),
      tandemPageIds: parseStringArray(row.tandem_page_ids_json),
      includeMemory: Boolean(row.include_memory),
      createdAt: row.created_at,
    }));
  }

  insertContextPack(pack: ContextPackSnapshot): void {
    this.database.prepare(`
      INSERT INTO context_packs (id, name, tab_refs_json, document_ids_json, tandem_page_ids_json, include_memory, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pack.id,
      pack.name,
      JSON.stringify(pack.tabRefs),
      JSON.stringify(pack.documentIds),
      JSON.stringify(pack.tandemPageIds),
      Number(pack.includeMemory),
      pack.createdAt,
    );
  }

  getContextPack(packId: string): ContextPackSnapshot | null {
    return this.listContextPacks().find((pack) => pack.id === packId) ?? null;
  }

  renameContextPack(packId: string, name: string): boolean {
    const result = this.database.prepare('UPDATE context_packs SET name = ? WHERE id = ?').run(name, packId);
    return result.changes > 0;
  }

  deleteContextPack(packId: string): boolean {
    const result = this.database.prepare('DELETE FROM context_packs WHERE id = ?').run(packId);
    return result.changes > 0;
  }

  listBrowserSessions(): BrowserSessionSnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, name, tabs_json, created_at FROM browser_sessions ORDER BY created_at
    `).all() as unknown as Array<{ id: string; name: string; tabs_json: string; created_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      tabs: parseSessionTabs(row.tabs_json),
      createdAt: row.created_at,
    }));
  }

  insertBrowserSession(session: BrowserSessionSnapshot): void {
    this.database.prepare(`
      INSERT INTO browser_sessions (id, name, tabs_json, created_at) VALUES (?, ?, ?, ?)
    `).run(session.id, session.name, JSON.stringify(session.tabs), session.createdAt);
  }

  getBrowserSession(sessionId: string): BrowserSessionSnapshot | null {
    return this.listBrowserSessions().find((session) => session.id === sessionId) ?? null;
  }

  renameBrowserSession(sessionId: string, name: string): boolean {
    const result = this.database.prepare('UPDATE browser_sessions SET name = ? WHERE id = ?').run(name, sessionId);
    return result.changes > 0;
  }

  deleteBrowserSession(sessionId: string): boolean {
    const result = this.database.prepare('DELETE FROM browser_sessions WHERE id = ?').run(sessionId);
    return result.changes > 0;
  }

  listRecipes(): RecipeSnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, name, start_url, steps_json, enabled, created_at, updated_at
      FROM recipes ORDER BY created_at
    `).all() as unknown as Array<{
      id: string; name: string; start_url: string | null; steps_json: string;
      enabled: number; created_at: string; updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      startUrl: row.start_url,
      steps: parseRecipeSteps(row.steps_json),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  insertRecipe(recipe: RecipeSnapshot): void {
    this.database.prepare(`
      INSERT INTO recipes (id, name, start_url, steps_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      recipe.id,
      recipe.name,
      recipe.startUrl,
      JSON.stringify(recipe.steps),
      Number(recipe.enabled),
      recipe.createdAt,
      recipe.updatedAt,
    );
  }

  getRecipe(recipeId: string): RecipeSnapshot | null {
    return this.listRecipes().find((recipe) => recipe.id === recipeId) ?? null;
  }

  renameRecipe(recipeId: string, name: string): boolean {
    const updatedAt = new Date().toISOString();
    const result = this.database.prepare(
      'UPDATE recipes SET name = ?, updated_at = ? WHERE id = ?'
    ).run(name, updatedAt, recipeId);
    return result.changes > 0;
  }

  setRecipeEnabled(recipeId: string, enabled: boolean): boolean {
    const updatedAt = new Date().toISOString();
    const result = this.database.prepare(
      'UPDATE recipes SET enabled = ?, updated_at = ? WHERE id = ?'
    ).run(Number(enabled), updatedAt, recipeId);
    return result.changes > 0;
  }

  deleteRecipe(recipeId: string): boolean {
    const result = this.database.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
    return result.changes > 0;
  }

  /**
   * Phase 14 continuity import: replace allowlisted workspace collections.
   * Does not touch project paths, Memory bodies, visual selection, or documents.
   */
  replaceContinuityData(plan: {
    workspaceName: string | null;
    memorySelected: boolean;
    contextPacks: ContextPackSnapshot[];
    browserSessions: BrowserSessionSnapshot[];
    recipes: RecipeSnapshot[];
    tabContexts: TabContextSnapshot[];
  }): void {
    if (plan.workspaceName) {
      if (this.getWorkspace()) this.renameWorkspace(plan.workspaceName);
      else this.createWorkspace(plan.workspaceName);
    }
    this.setMemorySelected(plan.memorySelected);
    this.database.prepare('DELETE FROM context_packs').run();
    this.database.prepare('DELETE FROM browser_sessions').run();
    this.database.prepare('DELETE FROM recipes').run();
    this.database.prepare('DELETE FROM tab_context').run();
    for (const pack of plan.contextPacks) this.insertContextPack(pack);
    for (const session of plan.browserSessions) this.insertBrowserSession(session);
    for (const recipe of plan.recipes) this.insertRecipe(recipe);
    for (const context of plan.tabContexts) this.upsertTabContext(context);
  }

  close(): void {
    this.database.close();
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function parseTabRefs(value: string): { url: string; title: string }[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.url !== 'string' || typeof candidate.title !== 'string') return [];
      return [{ url: candidate.url, title: candidate.title }];
    });
  } catch {
    return [];
  }
}

function parseRecipeSteps(value: string): RecipeStepSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.action !== 'string' || typeof candidate.target !== 'string' || typeof candidate.detail !== 'string') {
        return [];
      }
      return [{
        action: candidate.action,
        target: candidate.target,
        detail: candidate.detail,
      }];
    });
  } catch {
    return [];
  }
}

function parseSessionTabs(value: string): { url: string; title: string; pinned: boolean }[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.url !== 'string' || typeof candidate.title !== 'string') return [];
      return [{
        url: candidate.url,
        title: candidate.title,
        pinned: candidate.pinned === true,
      }];
    });
  } catch {
    return [];
  }
}

function isVisualSelection(value: unknown): value is VisualSelectionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.tabId === 'string'
    && typeof candidate.url === 'string'
    && typeof candidate.selector === 'string'
    && typeof candidate.html === 'string'
    && typeof candidate.css === 'object'
    && typeof candidate.domContext === 'string'
    && typeof candidate.boundingBox === 'object'
    && typeof candidate.screenshotDataUrl === 'string'
    && typeof candidate.capturedAt === 'string';
}
