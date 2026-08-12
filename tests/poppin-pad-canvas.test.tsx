import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PoppinPadToolbar } from '../src/renderer/ui/poppin-pad/PoppinPadToolbar';

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
