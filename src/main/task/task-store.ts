import { DatabaseSync } from 'node:sqlite';

import type { TaskApprovalSnapshot, TaskProgressSnapshot, TaskRecordSnapshot, TaskState } from '../../shared/task';

interface TaskRow {
  state: TaskState;
  prompt: string;
  model: string;
  reasoning_effort: string;
  thread_id: string;
  turn_id: string;
  baseline_commit: string;
  progress_json: string;
  approval_json: string | null;
  result: string;
  diff: string;
  error: string | null;
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
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        baseline_commit TEXT NOT NULL,
        progress_json TEXT NOT NULL,
        approval_json TEXT,
        result TEXT NOT NULL,
        diff TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  load(): TaskRecordSnapshot | null {
    const row = this.database.prepare(`
      SELECT state, prompt, model, reasoning_effort, thread_id, turn_id, baseline_commit,
        progress_json, approval_json, result, diff, error, created_at, updated_at
      FROM active_task WHERE id = 'primary'
    `).get() as unknown as TaskRow | undefined;
    if (!row) return null;
    try {
      const progress = JSON.parse(row.progress_json) as TaskProgressSnapshot[];
      const pendingApproval = row.approval_json
        ? JSON.parse(row.approval_json) as TaskApprovalSnapshot
        : null;
      if (!Array.isArray(progress)) throw new Error('Invalid progress');
      return {
        state: row.state,
        prompt: row.prompt,
        model: row.model,
        reasoningEffort: row.reasoning_effort,
        threadId: row.thread_id,
        turnId: row.turn_id,
        baselineCommit: row.baseline_commit,
        progress,
        pendingApproval,
        result: row.result,
        diff: row.diff,
        error: row.error,
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
        id, state, prompt, model, reasoning_effort, thread_id, turn_id, baseline_commit,
        progress_json, approval_json, result, diff, error, created_at, updated_at
      ) VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        prompt = excluded.prompt,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        thread_id = excluded.thread_id,
        turn_id = excluded.turn_id,
        baseline_commit = excluded.baseline_commit,
        progress_json = excluded.progress_json,
        approval_json = excluded.approval_json,
        result = excluded.result,
        diff = excluded.diff,
        error = excluded.error,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      task.state,
      task.prompt,
      task.model,
      task.reasoningEffort,
      task.threadId,
      task.turnId,
      task.baselineCommit,
      JSON.stringify(task.progress),
      task.pendingApproval ? JSON.stringify(task.pendingApproval) : null,
      task.result,
      task.diff,
      task.error,
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
