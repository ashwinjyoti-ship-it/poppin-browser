// @vitest-environment node

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CodexAppServer } from '../src/main/codex/codex-app-server';

describe('Codex app-server client', () => {
  it('handshakes, discovers account/models, starts work, and routes approvals', async () => {
    const server = new CodexAppServer({
      executable: process.execPath,
      args: [path.resolve('tests/fixtures/fake-codex-app-server.mjs')],
    });
    const approval = new Promise<{ method: string; id: number | string }>((resolve) => {
      server.on('request', (request) => resolve({ method: request.method, id: request.id }));
    });

    await server.connect();
    await expect(server.getAccount()).resolves.toMatchObject({ account: { type: 'chatgpt' } });
    await expect(server.listModels()).resolves.toEqual([
      expect.objectContaining({ id: 'test-model', defaultReasoningEffort: 'medium' }),
    ]);
    const thread = await server.startThread({ cwd: '/tmp/project', model: 'test-model', developerInstructions: 'Stay scoped.' });
    const turn = await server.startTurn({ threadId: thread.id, prompt: 'Fix it', cwd: '/tmp/project', model: 'test-model', effort: 'medium' });
    expect(turn.id).toBe('turn-test');
    await expect(approval).resolves.toEqual({ method: 'item/commandExecution/requestApproval', id: 900 });
    server.respond(900, { decision: 'accept' });
    await expect(server.interruptTurn(thread.id, turn.id)).resolves.toBeUndefined();
    await server.close();
  });

  it('rejects pending requests when the connection closes', async () => {
    const server = new CodexAppServer({ executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] });
    const connection = server.connect();
    await server.close();
    await expect(connection).rejects.toThrow(/closed/i);
  });
});
