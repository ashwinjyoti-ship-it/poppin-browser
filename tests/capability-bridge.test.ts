// @vitest-environment node

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CapabilityBridge } from '../src/main/mcp/capability-bridge';

const MCP_SCRIPT = path.join(process.cwd(), 'scripts', 'poppin-mcp-server.mjs');

describe('CapabilityBridge + poppin-mcp-server', () => {
  const bridges: CapabilityBridge[] = [];

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  });

  it('resolves the MCP stdio entry from the repo scripts path', () => {
    const bridge = new CapabilityBridge();
    bridges.push(bridge);
    expect(bridge.isAvailable()).toBe(true);
  });

  it('lists and executes tools through the MCP stdio process', async () => {
    const bridge = new CapabilityBridge();
    bridges.push(bridge);
    await bridge.bind(
      [{
        name: 'tandem',
        description: 'Tandem test tool',
        inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
      }],
      async (name, args) => {
        expect(name).toBe('tandem');
        expect(args).toEqual({ action: 'list_pages' });
        return { ok: true, text: 'pages: 2' };
      },
    );

    const server = bridge.toAcpMcpServer();
    expect(server).toMatchObject({
      name: 'poppin',
      command: expect.any(String),
      args: expect.arrayContaining([MCP_SCRIPT]),
    });
    expect(server?.env.some((entry) => entry.name === 'POPPIN_CAPABILITY_SOCKET')).toBe(true);
    expect(server?.env.some((entry) => entry.name === 'POPPIN_CAPABILITY_TOKEN')).toBe(true);

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const entry of server!.env) env[entry.name] = entry.value;

    const child = spawn(server!.command, server!.args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = createInterface({ input: child.stdout! });
    const replies: Array<Record<string, unknown>> = [];
    stdout.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      replies.push(JSON.parse(trimmed) as Record<string, unknown>);
    });

    const waitForId = async (id: number) => {
      const started = Date.now();
      while (Date.now() - started < 5_000) {
        const hit = replies.find((entry) => entry.id === id);
        if (hit) return hit;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for MCP reply id=${id}`);
    };

    child.stdin!.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    })}\n`);
    await waitForId(1);

    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
    const listed = await waitForId(2);
    expect(listed.result).toMatchObject({
      tools: [{ name: 'tandem', description: 'Tandem test tool' }],
    });

    child.stdin!.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'tandem', arguments: { action: 'list_pages' } },
    })}\n`);
    const called = await waitForId(3);
    expect(called.result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: 'pages: 2' }],
    });

    child.stdin!.end();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }, 15_000);

  it('rejects bridge calls with the wrong token', async () => {
    const bridge = new CapabilityBridge();
    bridges.push(bridge);
    await bridge.bind(
      [{ name: 'tandem', description: 'x', inputSchema: { type: 'object' } }],
      async () => ({ ok: true, text: 'ok' }),
    );
    const server = bridge.toAcpMcpServer();
    expect(server).not.toBeNull();
    const socket = server!.env.find((entry) => entry.name === 'POPPIN_CAPABILITY_SOCKET')!.value;

    const { createConnection } = await import('node:net');
    const reply = await new Promise<string>((resolve, reject) => {
      const client = createConnection(socket);
      let buffer = '';
      client.setEncoding('utf8');
      client.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.includes('\n')) {
          client.end();
          resolve(buffer.trim());
        }
      });
      client.on('error', reject);
      client.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        token: 'wrong',
      })}\n`);
    });
    expect(JSON.parse(reply)).toMatchObject({
      id: 1,
      error: { message: expect.stringMatching(/Unauthorized/i) },
    });
  });
});
