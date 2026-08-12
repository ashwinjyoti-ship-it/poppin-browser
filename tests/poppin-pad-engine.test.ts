import { describe, expect, it } from 'vitest';

import { exportPadToMarkdown } from '../src/main/poppin-pad/pad-tandem-export';
import type { PoppinPadSnapshot } from '../src/shared/poppin-pad';

const SNAPSHOT: PoppinPadSnapshot = {
  pad: {
    id: 'primary',
    title: 'Poppin Pad',
    collapsed: false,
    width: 320,
    active: false,
    tool: 'select',
    updatedAt: '2026-08-12T00:00:00.000Z',
  },
  objects: [{
    id: 'card-1',
    kind: 'card',
    x: 10,
    y: 10,
    width: 200,
    height: 120,
    rotation: 0,
    zIndex: 1,
    payload: { title: 'API log', subtype: 'log', text: 'timeout waiting for upstream' },
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  }],
  pendingAttachments: [],
};

describe('exportPadToMarkdown', () => {
  it('includes human summary and poppin-pad payload fence', () => {
    const markdown = exportPadToMarkdown(SNAPSHOT, 'Debug board');
    expect(markdown).toContain('# Debug board');
    expect(markdown).toContain('## API log');
    expect(markdown).toContain('```poppin-pad');
    expect(markdown).toContain('"id": "card-1"');
  });
});
