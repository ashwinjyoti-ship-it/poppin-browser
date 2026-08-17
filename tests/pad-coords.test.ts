import { describe, expect, it } from 'vitest';

import type { PadObjectSnapshot } from '../src/shared/poppin-pad';
import { hitTestPadObject, padObjectBounds, resizePadObject, translatePadObject } from '../src/renderer/ui/poppin-pad/pad-coords';

function object(partial: Partial<PadObjectSnapshot> & Pick<PadObjectSnapshot, 'kind' | 'payload'>): PadObjectSnapshot {
  return {
    id: 'obj-1',
    x: 10,
    y: 20,
    width: 100,
    height: 40,
    rotation: 0,
    zIndex: 1,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    ...partial,
  };
}

describe('pad object transform', () => {
  it('moves text by x/y only', () => {
    const moved = translatePadObject(object({ kind: 'text', payload: { text: 'Hello', fontSize: 14, color: '#000' } }), 5, -3);
    expect(moved).toMatchObject({ x: 15, y: 17, width: 100, height: 40 });
  });

  it('translates arrow endpoints with the bounding box', () => {
    const moved = translatePadObject(object({
      kind: 'arrow',
      x: 10,
      y: 20,
      payload: { x1: 10, y1: 20, x2: 40, y2: 50, color: '#d8892b', width: 2 },
    }), 10, 10);
    expect(moved.payload).toMatchObject({ x1: 20, y1: 30, x2: 50, y2: 60 });
  });

  it('translates every stroke point', () => {
    const moved = translatePadObject(object({
      kind: 'stroke',
      payload: { points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], color: '#40372f', width: 2 },
    }), 4, 6);
    expect(moved.payload).toMatchObject({ points: [{ x: 14, y: 26 }, { x: 34, y: 46 }] });
  });

  it('hit-tests a rect and resizes it', () => {
    const rect = object({ kind: 'rect', payload: { stroke: '#000', fill: 'none', strokeWidth: 2 } });
    expect(hitTestPadObject(rect, { x: 12, y: 22 })).toBe(true);
    expect(hitTestPadObject(rect, { x: 400, y: 400 })).toBe(false);
    expect(padObjectBounds(rect)).toMatchObject({ x: 10, y: 20, width: 100, height: 40 });
    expect(resizePadObject(rect, 160, 80)).toMatchObject({ width: 160, height: 80 });
  });
});
