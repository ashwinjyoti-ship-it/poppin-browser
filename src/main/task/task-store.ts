import { DatabaseSync } from 'node:sqlite';

import type { TaskApprovalSnapshot, TaskBrowserRunSnapshot, TaskDeliverySnapshot, TaskKind, TaskProgressSnapshot, TaskRecordSnapshot, TaskState } from '../../shared/task';

interface TaskRow {
  kind: TaskKind;
  state: TaskState;
  prompt: string;
  model: string;
  reasoning_effort: string;
  document_id: string;
  thread_id: string;
  turn_id: string;
  baseline_commit: string;
  progress_json: string;
  approval_json: string | null;
  result: string;
  diff: string;
  error: string | null;
  browser_run_json: string | null;
  delivery_json: string | null;
  created_at: string;
  updated_at: string;
}

export class TaskStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS active_task (
        id TEXT PRIMARY KEY CHECK (id = 'primary'),
        state TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'code',
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        document_id TEXT NOT NULL DEFAULT '',
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        baseline_commit TEXT NOT NULL,
        progress_json TEXT NOT NULL,
        approval_json TEXT,
        result TEXT NOT NULL,
        diff TEXT NOT NULL,
        error TEXT,
        browser_run_json TEXT,
        delivery_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    const columns = this.database.prepare('PRAGMA table_info(active_task)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'kind')) {
      this.database.exec("ALTER TABLE active_task ADD COLUMN kind TEXT NOT NULL DEFAULT 'code'");
    }
    if (!columns.some((column) => column.name === 'delivery_json')) {
      this.database.exec('ALTER TABLE active_task ADD COLUMN delivery_json TEXT');
    }
    if (!columns.some((column) => column.name === 'browser_run_json')) {
      this.database.exec('ALTER TABLE active_task ADD COLUMN browser_run_json TEXT');
    }
    if (!columns.some((column) => column.name === 'document_id')) {
      this.database.exec("ALTER TABLE active_task ADD COLUMN document_id TEXT NOT NULL DEFAULT ''");
    }
    this.database.exec("UPDATE active_task SET document_id = thread_id WHERE document_id = ''");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS task_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
  }

  /** Remembers which agent harness the user selected, across restarts. */
  getSelectedAgentId(): string | null {
    const row = this.database.prepare("SELECT value FROM task_settings WHERE key = 'agent_id'").get() as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setSelectedAgentId(agentId: string): void {
    this.database.prepare(`
      INSERT INTO task_settings (key, value) VALUES ('agent_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(agentId);
  }

  load(): TaskRecordSnapshot | null {
    const row = this.database.prepare(`
      SELECT state, kind, prompt, model, reasoning_effort, document_id, thread_id, turn_id, baseline_commit,
        progress_json, approval_json, result, diff, error, browser_run_json, delivery_json, created_at, updated_at
      FROM active_task WHERE id = 'primary'
    `).get() as unknown as TaskRow | undefined;
    if (!row) return null;
    try {
      const progress = JSON.parse(row.progress_json) as TaskProgressSnapshot[];
      const pendingApproval = row.approval_json
        ? JSON.parse(row.approval_json) as TaskApprovalSnapshot
        : null;
      const delivery = row.delivery_json ? JSON.parse(row.delivery_json) as TaskDeliverySnapshot : undefined;
      const browserRun = row.browser_run_json
        ? parseBrowserRun(JSON.parse(row.browser_run_json))
        : emptyBrowserRun();
      if (!Array.isArray(progress)) throw new Error('Invalid progress');
      return {
        state: row.state,
        kind: row.kind === 'work' ? 'work' : 'code',
        prompt: row.prompt,
        model: row.model,
        reasoningEffort: row.reasoning_effort,
        documentId: row.document_id || row.thread_id,
        threadId: row.thread_id,
        turnId: row.turn_id,
        baselineCommit: row.baseline_commit,
        progress,
        pendingApproval,
        result: row.result,
        diff: row.diff,
        error: row.error,
        browserRun,
        ...(delivery ? { delivery } : {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch {
      this.clear();
      return null;
    }
  }

  save(task: TaskRecordSnapshot): void {
    this.database.prepare(`
      INSERT INTO active_task (
        id, state, kind, prompt, model, reasoning_effort, document_id, thread_id, turn_id, baseline_commit,
        progress_json, approval_json, result, diff, error, browser_run_json, delivery_json, created_at, updated_at
      ) VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        kind = excluded.kind,
        prompt = excluded.prompt,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        document_id = excluded.document_id,
        thread_id = excluded.thread_id,
        turn_id = excluded.turn_id,
        baseline_commit = excluded.baseline_commit,
        progress_json = excluded.progress_json,
        approval_json = excluded.approval_json,
        result = excluded.result,
        diff = excluded.diff,
        error = excluded.error,
        browser_run_json = excluded.browser_run_json,
        delivery_json = excluded.delivery_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      task.state,
      task.kind,
      task.prompt,
      task.model,
      task.reasoningEffort,
      task.documentId,
      task.threadId,
      task.turnId,
      task.baselineCommit,
      JSON.stringify(task.progress),
      task.pendingApproval ? JSON.stringify(task.pendingApproval) : null,
      task.result,
      task.diff,
      task.error,
      JSON.stringify(task.browserRun),
      task.delivery ? JSON.stringify(task.delivery) : null,
      task.createdAt,
      task.updatedAt,
    );
  }

  clear(): void {
    this.database.prepare("DELETE FROM active_task WHERE id = 'primary'").run();
  }

  close(): void {
    this.database.close();
  }
}

function emptyBrowserRun(): TaskBrowserRunSnapshot {
  return {
    required: false,
    state: 'not-required',
    taskSpaceId: null,
    successfulActionCount: 0,
    retryCount: 0,
    lastActionAt: null,
    sources: [],
  };
}

function parseBrowserRun(value: unknown): TaskBrowserRunSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid browser run');
  const candidate = value as Partial<TaskBrowserRunSnapshot>;
  const states = new Set<TaskBrowserRunSnapshot['state']>(['not-required', 'awaiting-action', 'retrying', 'action-observed', 'completed', 'incomplete']);
  if (typeof candidate.required !== 'boolean' || !candidate.state || !states.has(candidate.state)) throw new Error('Invalid browser run');
  if (candidate.taskSpaceId !== null && typeof candidate.taskSpaceId !== 'string') throw new Error('Invalid browser run');
  if (!Number.isInteger(candidate.successfulActionCount) || candidate.successfulActionCount! < 0) throw new Error('Invalid browser run');
  if (!Number.isInteger(candidate.retryCount) || candidate.retryCount! < 0) throw new Error('Invalid browser run');
  if (candidate.lastActionAt !== null && typeof candidate.lastActionAt !== 'string') throw new Error('Invalid browser run');
  const sources = candidate.sources === undefined ? [] : candidate.sources;
  if (!Array.isArray(sources) || !sources.every((source) => source && typeof source === 'object'
    && typeof source.title === 'string' && typeof source.url === 'string')) throw new Error('Invalid browser run');
  return { ...(candidate as TaskBrowserRunSnapshot), sources: sources.slice(0, 100) };
}
