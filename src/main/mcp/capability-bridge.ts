import { accessSync, constants } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AcpEnvVariable, AcpMcpServerStdio } from '../acp/acp-protocol';
import type { AgentToolSpec } from '../agent/agent-adapter';

/**
 * Host-side half of the Poppin MCP bridge.
 *
 * ACP agents cannot receive client-defined tools. Poppin therefore starts a
 * local Unix-socket capability host in the Electron main process and registers
 * a stdio MCP server (`scripts/poppin-mcp-server.mjs`) in `session/new`. The
 * MCP process forwards `tools/list` and `tools/call` here so Browser Use,
 * Tandem, and the other Work capabilities stay governed by Poppin.
 */

export type CapabilityToolExecutor = (
  name: string,
  args: unknown,
) => Promise<{ ok: boolean; text: string }>;

interface BridgeRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
  token?: string;
}

interface BridgeResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

export class CapabilityBridge {
  private server: Server | null = null;
  private socketPath: string | null = null;
  private token: string | null = null;
  private tools: AgentToolSpec[] = [];
  private executor: CapabilityToolExecutor | null = null;
  private readonly sockets = new Set<Socket>();

  /** True when the packaged/dev MCP stdio entry can be launched. */
  isAvailable(): boolean {
    return Boolean(resolveMcpServerEntry());
  }

  async bind(tools: AgentToolSpec[], executor: CapabilityToolExecutor): Promise<void> {
    this.tools = tools;
    this.executor = executor;
    if (!this.server) await this.listen();
  }

  clearTools(): void {
    this.tools = [];
    this.executor = null;
  }

  async close(): Promise<void> {
    this.clearTools();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    const socketPath = this.socketPath;
    this.socketPath = null;
    this.token = null;
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    if (socketPath) await unlink(socketPath).catch(() => undefined);
  }

  toAcpMcpServer(): AcpMcpServerStdio | null {
    const entry = resolveMcpServerEntry();
    if (!entry || !this.socketPath || !this.token || this.tools.length === 0) return null;
    const env: AcpEnvVariable[] = [
      { name: 'POPPIN_CAPABILITY_SOCKET', value: this.socketPath },
      { name: 'POPPIN_CAPABILITY_TOKEN', value: this.token },
    ];
    return {
      name: 'poppin',
      command: entry.command,
      args: entry.args,
      env,
    };
  }

  private async listen(): Promise<void> {
    const socketPath = path.join(tmpdir(), `poppin-capability-${process.pid}-${randomBytes(6).toString('hex')}.sock`);
    await unlink(socketPath).catch(() => undefined);
    this.token = randomBytes(24).toString('hex');
    this.socketPath = socketPath;
    this.server = createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(socketPath, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
  }

  private handleSocket(socket: Socket): void {
    this.sockets.add(socket);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) void this.handleLine(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {
      this.sockets.delete(socket);
      socket.destroy();
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: BridgeRequest;
    try {
      request = JSON.parse(line) as BridgeRequest;
    } catch {
      this.write(socket, { jsonrpc: '2.0', id: null as unknown as string, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (request.token !== this.token) {
      this.write(socket, { jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'Unauthorized capability bridge token.' } });
      return;
    }
    try {
      if (request.method === 'tools/list') {
        this.write(socket, { jsonrpc: '2.0', id: request.id, result: { tools: this.tools } });
        return;
      }
      if (request.method === 'tools/call') {
        const params = isRecord(request.params) ? request.params : {};
        const name = typeof params.name === 'string' ? params.name : '';
        if (!name || !this.executor) {
          this.write(socket, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Tool is not available.' } });
          return;
        }
        const result = await this.executor(name, params.arguments);
        this.write(socket, { jsonrpc: '2.0', id: request.id, result });
        return;
      }
      this.write(socket, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } });
    } catch (error) {
      this.write(socket, {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: error instanceof Error ? error.message : 'Capability bridge failed.' },
      });
    }
  }

  private write(socket: Socket, message: BridgeResponse): void {
    if (socket.destroyed) return;
    socket.write(`${JSON.stringify(message)}\n`);
  }
}

export function resolveMcpServerEntry(): { command: string; args: string[] } | null {
  const configured = process.env.POPPIN_MCP_SERVER_COMMAND?.trim();
  if (configured) {
    return { command: configured, args: parseArgs(process.env.POPPIN_MCP_SERVER_ARGS) };
  }
  const script = resolveMcpServerScriptPath();
  if (!script) return null;
  const node = process.env.POPPIN_NODE_PATH?.trim() || process.env.npm_node_execpath?.trim() || 'node';
  return { command: node, args: [script] };
}

function resolveMcpServerScriptPath(): string | null {
  const candidates = [
    process.env.POPPIN_MCP_SERVER_SCRIPT?.trim(),
    typeof process.resourcesPath === 'string' ? path.join(process.resourcesPath, 'poppin-mcp-server.mjs') : null,
    path.join(process.cwd(), 'scripts', 'poppin-mcp-server.mjs'),
    path.join(__dirname, '..', '..', '..', 'scripts', 'poppin-mcp-server.mjs'),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.R_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function parseArgs(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/u).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
