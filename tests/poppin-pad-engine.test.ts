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
  objects: [
    {
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
    },
    {
      id: 'stroke-1',
      kind: 'stroke',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      zIndex: 2,
      payload: { points: [{ x: 12, y: 20 }, { x: 40, y: 80 }], color: '#40372f', width: 2 },
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    },
  ],
  pendingAttachments: [],
};

describe('exportPadToMarkdown', () => {
  it('exports readable markdown without a raw JSON payload fence', () => {
    const markdown = exportPadToMarkdown(SNAPSHOT, 'Debug board');
    expect(markdown).toContain('# Debug board');
    expect(markdown).toContain('## API log');
    expect(markdown).toContain('Canvas drawings');
    expect(markdown).toContain('<svg');
    expect(markdown).not.toContain('```poppin-pad');
    expect(markdown).not.toContain('"id": "card-1"');
  });
});
