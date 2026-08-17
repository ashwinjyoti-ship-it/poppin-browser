import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PoppinPadCanvas } from '../src/renderer/ui/poppin-pad/PoppinPadCanvas';
import { PoppinPadToolbar } from '../src/renderer/ui/poppin-pad/PoppinPadToolbar';
import type { PadObjectSnapshot } from '../src/shared/poppin-pad';

describe('PoppinPadToolbar', () => {
  it('switches tools and triggers exports', () => {
    const onCommand = vi.fn().mockResolvedValue({ ok: true, message: 'Exported to Tandem.' });
    render(<PoppinPadToolbar tool="select" active={false} onCommand={onCommand} onMessage={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Freehand pen' }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'setTool', tool: 'pen' });

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note — click canvas, then type' }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'setTool', tool: 'sticky' });

    fireEvent.click(screen.getByRole('button', { name: /Export PDF/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'exportToPdf' });

    fireEvent.click(screen.getByRole('button', { name: 'Create Tandem page' }));
    expect(onCommand).toHaveBeenCalledWith({ type: 'exportToTandem' });
  });
});

describe('PoppinPadCanvas', () => {
  const textObject: PadObjectSnapshot = {
    id: 'text-1',
    kind: 'text',
    x: 40,
    y: 50,
    width: 120,
    height: 32,
    rotation: 0,
    zIndex: 1,
    payload: { text: 'Hello', fontSize: 14, color: '#40372f' },
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  };

  it('selects and moves a rendered text object', () => {
    const onCommand = vi.fn().mockResolvedValue({ ok: true });
    render(<PoppinPadCanvas objects={[textObject]} tool="select" onCommand={onCommand} />);
    const node = screen.getByText('Hello');
    fireEvent.pointerDown(node, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(node, { clientX: 70, clientY: 80 });
    fireEvent.pointerUp(node);
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'upsertObject',
      object: expect.objectContaining({ id: 'text-1', x: 70, y: 80 }),
    }));
  });
});
