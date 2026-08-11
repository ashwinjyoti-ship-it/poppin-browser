#!/usr/bin/env node
/**
 * Poppin MCP stdio server.
 *
 * ACP agents spawn this process from `session/new` mcpServers. It speaks the
 * Model Context Protocol over stdin/stdout and forwards tool list/call requests
 * to Poppin's local capability bridge (Unix socket) so Browser Use and Tandem
 * stay inside the Electron main process.
 *
 * Env:
 *   POPPIN_CAPABILITY_SOCKET — absolute path to the bridge socket
 *   POPPIN_CAPABILITY_TOKEN  — session token issued by Poppin
 */

import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';
const socketPath = process.env.POPPIN_CAPABILITY_SOCKET?.trim();
const token = process.env.POPPIN_CAPABILITY_TOKEN?.trim();

if (!socketPath || !token) {
  process.stderr.write('poppin-mcp-server: POPPIN_CAPABILITY_SOCKET and POPPIN_CAPABILITY_TOKEN are required.\n');
  process.exit(1);
}

/** @type {Map<number|string, {resolve: (v: unknown) => void, reject: (e: Error) => void}>} */
const pending = new Map();
let nextBridgeId = 1;
let buffer = '';

const bridge = createConnection(socketPath);
bridge.setEncoding('utf8');
bridge.on('error', (error) => {
  process.stderr.write(`poppin-mcp-server: bridge error: ${error.message}\n`);
  process.exit(1);
});
bridge.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) handleBridgeLine(line);
    newline = buffer.indexOf('\n');
  }
});

function handleBridgeLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message || 'Capability bridge error'));
  else waiter.resolve(message.result);
}

function bridgeRequest(method, params) {
  const id = nextBridgeId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    bridge.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params, token })}\n`);
  });
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleMcpRequest(message) {
  const { id, method, params } = message;
  try {
    if (method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'poppin', version: '0.1.0' },
        },
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return;
    }
    if (method === 'ping') {
      writeMessage({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    if (method === 'tools/list') {
      const listed = await bridgeRequest('tools/list');
      const tools = Array.isArray(listed?.tools) ? listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: 'object' },
      })) : [];
      writeMessage({ jsonrpc: '2.0', id, result: { tools } });
      return;
    }
    if (method === 'tools/call') {
      const name = typeof params?.name === 'string' ? params.name : '';
      const result = await bridgeRequest('tools/call', { name, arguments: params?.arguments ?? {} });
      const ok = Boolean(result?.ok);
      const text = typeof result?.text === 'string' ? result.text : ok ? 'OK' : 'Tool failed.';
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text }],
          isError: !ok,
        },
      });
      return;
    }
    writeMessage({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (error) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: error instanceof Error ? error.message : 'Poppin MCP server failed.' },
    });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message.method && message.id !== undefined) {
    void handleMcpRequest(message);
    return;
  }
  // Notifications have no id; ignore.
});

rl.on('close', () => {
  bridge.end();
  process.exit(0);
});
