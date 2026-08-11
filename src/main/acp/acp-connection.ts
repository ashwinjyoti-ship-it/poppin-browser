import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

const REQUEST_TIMEOUT_MS = 30_000;
const STDERR_LIMIT = 12_000;

export interface AcpLaunch {
  executable: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface AcpIncomingRequest {
  id: number | string;
  method: string;
  params: unknown;
}

export interface AcpIncomingNotification {
  method: string;
  params: unknown;
}

export interface AcpConnectionEvents {
  request: [AcpIncomingRequest];
  notification: [AcpIncomingNotification];
  exit: [Error | null];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Minimal JSON-RPC 2.0 client for an ACP agent spoken over stdio.
 *
 * ACP is line-delimited JSON-RPC 2.0 in both directions: the client calls the
 * agent (`initialize`, `session/*`) and the agent calls back into the client
 * (`session/update`, `session/request_permission`, `fs/*`, `terminal/*`).
 */
export class AcpConnection extends EventEmitter<AcpConnectionEvents> {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderr = '';
  private closing = false;

  constructor(private readonly launch: AcpLaunch) {
    super();
  }

  get connected(): boolean {
    return Boolean(this.child?.stdin.writable);
  }

  /** Last stderr from the agent process, used to build actionable error messages. */
  get stderrTail(): string {
    return this.stderr.trim();
  }

  start(): void {
    if (this.child) return;
    this.closing = false;
    const child = spawn(this.launch.executable, this.launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...(this.launch.cwd ? { cwd: this.launch.cwd } : {}),
      env: {
        ...process.env,
        PATH: enrichPath(process.env.PATH),
        ...this.launch.env,
      },
    });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-STDERR_LIMIT);
    });
    child.once('error', (error) => this.handleExit(error));
    child.once('exit', (code, signal) => {
      const error = this.closing || code === 0
        ? null
        : new Error(this.stderr.trim() || `The ACP agent stopped unexpectedly (${signal ?? `exit ${String(code)}`}).`);
      this.handleExit(error);
    });
  }

  async request<T = unknown>(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (!this.child?.stdin.writable) throw new Error('The ACP agent is not connected.');
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The ACP agent did not respond to ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
  }

  respond(id: number | string, result: unknown): void {
    if (!this.child?.stdin.writable) return;
    this.write({ jsonrpc: '2.0', id, result });
  }

  respondError(id: number | string, code: number, message: string): void {
    if (!this.child?.stdin.writable) return;
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.closing = true;
    this.child = null;
    child.stdin.end();
    if (!child.killed) child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timeout = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
        resolve();
      }, 2_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.rejectPending(new Error('The ACP agent connection closed.'));
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (typeof message.id === 'number' && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error !== undefined) pending.reject(new Error(errorMessage(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method !== 'string') return;
    if (message.id === undefined) {
      this.emit('notification', { method: message.method, params: message.params });
      return;
    }
    if (typeof message.id === 'number' || typeof message.id === 'string') {
      this.emit('request', { id: message.id, method: message.method, params: message.params });
    }
  }

  private write(message: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) throw new Error('The ACP agent is not connected.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleExit(error: Error | null): void {
    if (!this.child) return;
    this.child = null;
    this.rejectPending(error ?? new Error('The ACP agent connection closed.'));
    this.emit('exit', error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorMessage(value: unknown): string {
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  return 'The ACP agent returned an unknown protocol error.';
}

/** Ensure Homebrew / user-local bins are visible to ACP children spawned from a GUI app. */
function enrichPath(existing: string | undefined): string {
  const extras = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${process.env.HOME ?? ''}/.local/bin`,
    `${process.env.HOME ?? ''}/.cursor/bin`,
  ].filter(Boolean);
  const parts = [...extras, ...(existing ? existing.split(':') : [])];
  return [...new Set(parts.filter(Boolean))].join(':');
}
