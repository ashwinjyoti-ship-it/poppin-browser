// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { splitCommand } from '../src/main/project/preview-engine';

describe('preview command parsing', () => {
  it('parses configured arguments without invoking a shell', () => {
    expect(splitCommand('npm run dev -- --host "127.0.0.1"')).toEqual(['npm', 'run', 'dev', '--', '--host', '127.0.0.1']);
    expect(splitCommand("node 'scripts/dev server.mjs'")).toEqual(['node', 'scripts/dev server.mjs']);
  });

  it('rejects incomplete quoted commands', () => {
    expect(() => splitCommand('npm run "dev')).toThrow(/unmatched quote/i);
  });
});
