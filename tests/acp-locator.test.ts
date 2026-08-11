// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { locateAcpHarness, locateClaudeAcp, locateCursorAcp, parseArgs } from '../src/main/acp/acp-locator';

describe('acp locator', () => {
  it('parses whitespace-separated override args', () => {
    expect(parseArgs(undefined)).toEqual([]);
    expect(parseArgs('  acp --flag  ')).toEqual(['acp', '--flag']);
  });

  it('honours harness-specific command overrides', async () => {
    const previousClaude = process.env.POPPIN_CLAUDE_ACP_COMMAND;
    const previousClaudeArgs = process.env.POPPIN_CLAUDE_ACP_ARGS;
    const previousCursor = process.env.POPPIN_CURSOR_ACP_COMMAND;
    const previousCursorArgs = process.env.POPPIN_CURSOR_ACP_ARGS;
    try {
      process.env.POPPIN_CLAUDE_ACP_COMMAND = '/tmp/fake-claude-acp';
      process.env.POPPIN_CLAUDE_ACP_ARGS = '--verbose';
      process.env.POPPIN_CURSOR_ACP_COMMAND = '/tmp/fake-cursor-agent';
      process.env.POPPIN_CURSOR_ACP_ARGS = 'acp --trust';

      await expect(locateClaudeAcp()).resolves.toEqual({
        executable: '/tmp/fake-claude-acp',
        args: ['--verbose'],
      });
      await expect(locateCursorAcp()).resolves.toEqual({
        executable: '/tmp/fake-cursor-agent',
        args: ['acp', '--trust'],
      });
      await expect(locateAcpHarness('claude-code')).resolves.toEqual({
        executable: '/tmp/fake-claude-acp',
        args: ['--verbose'],
      });
      await expect(locateAcpHarness('cursor-acp')).resolves.toEqual({
        executable: '/tmp/fake-cursor-agent',
        args: ['acp', '--trust'],
      });
      await expect(locateAcpHarness('codex-app-server')).resolves.toBeNull();
    } finally {
      if (previousClaude === undefined) delete process.env.POPPIN_CLAUDE_ACP_COMMAND;
      else process.env.POPPIN_CLAUDE_ACP_COMMAND = previousClaude;
      if (previousClaudeArgs === undefined) delete process.env.POPPIN_CLAUDE_ACP_ARGS;
      else process.env.POPPIN_CLAUDE_ACP_ARGS = previousClaudeArgs;
      if (previousCursor === undefined) delete process.env.POPPIN_CURSOR_ACP_COMMAND;
      else process.env.POPPIN_CURSOR_ACP_COMMAND = previousCursor;
      if (previousCursorArgs === undefined) delete process.env.POPPIN_CURSOR_ACP_ARGS;
      else process.env.POPPIN_CURSOR_ACP_ARGS = previousCursorArgs;
    }
  });
});
