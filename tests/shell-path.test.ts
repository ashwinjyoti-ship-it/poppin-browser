// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { mergePathDirs } from '../src/main/acp/shell-path';

describe('mergePathDirs', () => {
  it('deduplicates while preferring the order entries were first seen', () => {
    expect(mergePathDirs(['/usr/bin', '/opt/homebrew/bin'], ['/opt/homebrew/bin', '/usr/local/bin']))
      .toEqual(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin']);
  });

  it('drops empty entries', () => {
    expect(mergePathDirs(['', '/usr/bin', ''], [])).toEqual(['/usr/bin']);
  });
});
