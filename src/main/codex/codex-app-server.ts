import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

import type { CodexLaunch } from './codex-locator';
import {
  isRecord,
  isRpcNotification,
  isRpcServerRequest,
  type CodexAccount,
  type CodexModel,
  type CodexThread,
  type CodexTurn,
  type JsonObject,
  type RpcNotification,
  type RpcServerRequest,
} from './protocol';

const REQUEST_TIMEOUT_MS = 15_000;
const STDERR_LIMIT = 12_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface CodexAppServerEvents {
  notification: [notification: RpcNotification];
  request: [request: RpcServerRequest];
  exit: [error: Error | null];
}

export class CodexAppServer extends EventEmitter<CodexAppServerEvents> {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderr = '';
  private closing = false;

  constructor(private readonly launch: CodexLaunch) {
    super();
  }

  async connect(): Promise<void> {
    if (this.child) return;
    this.closing = false;
    const child = spawn(this.launch.executable, this.launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
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
        : new Error(this.stderr.trim() || `Codex stopped unexpectedly (${signal ?? `exit ${String(code)}`}).`);
      this.handleExit(error);
    });

    await this.request('initialize', {
      clientInfo: { name: 'poppin-browser', title: 'Poppin Browser', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify('initialized');
  }

  async getAccount(): Promise<{ account: CodexAccount | null; requiresOpenaiAuth: boolean }> {
    return this.request('account/read', { refreshToken: false });
  }

  async listModels(): Promise<CodexModel[]> {
    const response = await this.request<{ data: CodexModel[] }>('model/list', {
      limit: 100,
      includeHidden: false,
    });
    return response.data;
  }

  async startThread(params: {
    cwd: string;
    model: string;
    developerInstructions: string;
  }): Promise<CodexThread> {
    const response = await this.request<{ thread: CodexThread }>('thread/start', {
      model: params.model,
      cwd: params.cwd,
      runtimeWorkspaceRoots: [params.cwd],
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      serviceName: 'poppin-browser',
      developerInstructions: params.developerInstructions,
      ephemeral: false,
    });
    return response.thread;
  }

  async resumeThread(threadId: string, cwd: string): Promise<CodexThread> {
    const response = await this.request<{ thread: CodexThread }>('thread/resume', {
      threadId,
      cwd,
      runtimeWorkspaceRoots: [cwd],
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    });
    return response.thread;
  }

  async startTurn(params: {
    threadId: string;
    prompt: string;
    cwd: string;
    model: string;
    effort: string;
  }): Promise<CodexTurn> {
    const response = await this.request<{ turn: CodexTurn }>('turn/start', {
      threadId: params.threadId,
      input: [{ type: 'text', text: params.prompt, text_elements: [] }],
      cwd: params.cwd,
      runtimeWorkspaceRoots: [params.cwd],
      approvalPolicy: 'on-request',
      model: params.model,
      effort: params.effort,
      summary: 'concise',
    });
    return response.turn;
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request('turn/interrupt', { threadId, turnId });
  }

  respond(requestId: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id: requestId, result });
  }

  async request<T = unknown>(method: string, params: JsonObject): Promise<T> {
    if (!this.child?.stdin.writable) throw new Error('Codex is not connected.');
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not respond to ${method}.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: JsonObject): void {
    this.write(params ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', method });
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
    this.rejectPending(new Error('Codex connection closed.'));
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
      if (message.error !== undefined) {
        pending.reject(new Error(rpcErrorMessage(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (isRpcServerRequest(message)) {
      this.emit('request', message);
    } else if (isRpcNotification(message)) {
      this.emit('notification', message);
    }
  }

  private write(message: JsonObject): void {
    if (!this.child?.stdin.writable) throw new Error('Codex is not connected.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleExit(error: Error | null): void {
    if (!this.child && this.closing) return;
    this.child = null;
    this.rejectPending(error ?? new Error('Codex connection closed.'));
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

function rpcErrorMessage(value: unknown): string {
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  return 'Codex returned an unknown protocol error.';
}
