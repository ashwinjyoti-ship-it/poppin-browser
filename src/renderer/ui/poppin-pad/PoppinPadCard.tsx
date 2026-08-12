import { useRef } from 'react';

import type { PadCardPayload, PadObjectSnapshot } from '../../../shared/poppin-pad';
import { PAD_ATTACHMENT_MIME } from '../../../shared/poppin-pad';

interface PoppinPadCardProps {
  object: PadObjectSnapshot;
  selected: boolean;
  onSelect: (objectId: string) => void;
  onMove: (objectId: string, x: number, y: number) => void;
  onResize: (objectId: string, width: number, height: number) => void;
}

export function PoppinPadCard({ object, selected, onSelect, onMove, onResize }: PoppinPadCardProps) {
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; mode: 'move' | 'resize' } | null>(null);
  const payload = object.payload as PadCardPayload;

  const finish = () => { drag.current = null; };

  return (
    <div
      className={`poppin-pad-card ${selected ? 'poppin-pad-card-selected' : ''} poppin-pad-card-${payload.subtype}`}
      style={{ left: object.x, top: object.y, width: object.width, height: object.height, zIndex: object.zIndex }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(PAD_ATTACHMENT_MIME, object.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        const mode = target.dataset.handle === 'resize' ? 'resize' : 'move';
        drag.current = { startX: event.clientX, startY: event.clientY, originX: object.x, originY: object.y, mode };
        onSelect(object.id);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.startX;
        const dy = event.clientY - drag.current.startY;
        if (drag.current.mode === 'move') {
          onMove(object.id, drag.current.originX + dx, drag.current.originY + dy);
        } else {
          onResize(object.id, Math.max(120, object.width + dx), Math.max(80, object.height + dy));
        }
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div className="poppin-pad-card-header">
        <span className="poppin-pad-card-tag">{payload.subtype}</span>
        <strong>{payload.title}</strong>
      </div>
      <div className="poppin-pad-card-body">
        {payload.imageDataUrl ? <img src={payload.imageDataUrl} alt={payload.title} /> : null}
        {payload.text ? <p>{payload.text}</p> : null}
        {payload.sourceUrl ? <a href={payload.sourceUrl} onClick={(event) => event.preventDefault()}>{payload.sourceUrl}</a> : null}
      </div>
      <button type="button" className="poppin-pad-card-resize" data-handle="resize" aria-label="Resize card" />
    </div>
  );
}
