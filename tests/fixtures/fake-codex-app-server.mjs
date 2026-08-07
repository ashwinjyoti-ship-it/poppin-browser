import { createInterface } from 'node:readline';
import process from 'node:process';
import { setImmediate } from 'node:timers';

const lines = createInterface({ input: process.stdin });

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialized') return;
  const result = responseFor(message.method, message.params);
  if (message.id !== undefined) process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
});

function responseFor(method, params) {
  if (method === 'initialize') return { userAgent: 'fake-codex/1.0', codexHome: '/tmp/codex' };
  if (method === 'account/read') return { account: { type: 'chatgpt', email: 'person@example.test', planType: 'plus' }, requiresOpenaiAuth: true };
  if (method === 'model/list') return {
    data: [{
      id: 'test-model',
      model: 'test-model',
      displayName: 'Test Model',
      description: 'Deterministic model',
      hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
      defaultReasoningEffort: 'medium',
      isDefault: true,
    }],
    nextCursor: null,
  };
  if (method === 'thread/start' || method === 'thread/resume') return {
    thread: { id: params.threadId ?? 'thread-test', sessionId: 'thread-test', preview: '', ephemeral: false },
  };
  if (method === 'turn/start') {
    setImmediate(() => {
      process.stdout.write(`${JSON.stringify({ method: 'turn/started', params: { threadId: params.threadId, turn: { id: 'turn-test', status: 'inProgress', error: null } } })}\n`);
      process.stdout.write(`${JSON.stringify({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId: params.threadId, turnId: 'turn-test', itemId: 'item-test', startedAtMs: 1, command: 'npm test', cwd: params.cwd } })}\n`);
    });
    return { turn: { id: 'turn-test', status: 'inProgress', error: null } };
  }
  if (method === 'turn/interrupt') return {};
  return {};
}
