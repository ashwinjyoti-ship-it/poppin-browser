import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';

import { DEFAULT_PANE_WIDTHS, type PaneSide } from './pane-layout';

interface PaneResizerProps {
  side: PaneSide;
  width: number;
  minimum: number;
  maximum: number;
  onResize: (width: number) => void;
}

export function PaneResizer({ side, width, minimum, maximum, onResize }: PaneResizerProps) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const label = side === 'left' ? 'Resize workspace pane' : 'Resize context and task pane';

  useEffect(() => () => {
    document.body.classList.remove('pane-is-resizing');
  }, []);

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setIsDragging(false);
    document.body.classList.remove('pane-is-resizing');
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = side === 'left' ? 1 : -1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const screenDirection = event.key === 'ArrowRight' ? 1 : -1;
      onResize(width + screenDirection * direction * (event.shiftKey ? 24 : 8));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onResize(minimum);
    } else if (event.key === 'End') {
      event.preventDefault();
      onResize(maximum);
    }
  };

  return (
    <button
      type="button"
      className={`pane-resizer pane-resizer-${side} ${isDragging ? 'pane-resizer-active' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      title={`${label}. Drag, use arrow keys, or double-click to reset.`}
      onDoubleClick={() => onResize(DEFAULT_PANE_WIDTHS[side])}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        if (typeof event.currentTarget.setPointerCapture === 'function') {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        document.body.classList.add('pane-is-resizing');
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.current.startX;
        onResize(drag.current.startWidth + (side === 'left' ? delta : -delta));
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    />
  );
}
