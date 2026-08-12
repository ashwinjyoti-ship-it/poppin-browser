import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  PadObjectSnapshot,
  PadTool,
  PoppinPadCommand,
  PoppinPadCommandResult,
} from '../../../shared/poppin-pad';
import { PoppinPadCard } from './PoppinPadCard';
import { clientToCanvasPoint, strokePath } from './pad-coords';

interface PoppinPadCanvasProps {
  objects: PadObjectSnapshot[];
  tool: PadTool;
  onCommand: (command: PoppinPadCommand) => Promise<PoppinPadCommandResult>;
}

interface DraftState {
  kind: 'stroke' | 'arrow' | 'rect';
  id: string;
  start: { x: number; y: number };
  current: { x: number; y: number };
  points?: { x: number; y: number }[];
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `pad-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function PoppinPadCanvas({ objects, tool, onCommand }: PoppinPadCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const suppressBlurRef = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [localObjects, setLocalObjects] = useState<Record<string, PadObjectSnapshot>>({});

  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const storeEmpty = objects.length === 0;
  const activeEditingId = storeEmpty ? null : editingId;

  const mergedObjects = useMemo(() => {
    // After Clear (or any full wipe), ignore optimistic locals so the canvas matches the store.
    if (storeEmpty) return [];
    const map = new Map(objects.map((object) => [object.id, object]));
    Object.values(localObjects).forEach((object) => map.set(object.id, object));
    return [...map.values()].sort((a, b) => a.zIndex - b.zIndex);
  }, [localObjects, objects, storeEmpty]);

  // Electron's native BrowserView often steals focus right after a pad click.
  // Pull focus back to the shell, then hold it on the editor briefly.
  useEffect(() => {
    if (!activeEditingId) return;
    let cancelled = false;
    const editingTarget = activeEditingId;
    const input = editInputRef.current;
    void onCommand({ type: 'focusShell' }).then(() => {
      if (cancelled) return;
      input?.focus();
      input?.select();
    });
    const keep = window.setInterval(() => {
      if (cancelled || editingIdRef.current !== editingTarget) return;
      if (document.activeElement !== editInputRef.current) {
        void onCommand({ type: 'focusShell' }).then(() => {
          editInputRef.current?.focus();
        });
      }
    }, 40);
    const stop = window.setTimeout(() => window.clearInterval(keep), 800);
    return () => {
      cancelled = true;
      window.clearInterval(keep);
      window.clearTimeout(stop);
    };
  }, [activeEditingId, onCommand]);

  const upsertLocal = (object: PadObjectSnapshot) => {
    setLocalObjects((current) => ({ ...current, [object.id]: object }));
    void onCommand({ type: 'upsertObject', object });
  };

  const pointFromEvent = (event: React.PointerEvent | React.DragEvent) => {
    const container = surfaceRef.current;
    if (!container) return { x: 0, y: 0 };
    return clientToCanvasPoint(container, event.clientX, event.clientY);
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    const point = pointFromEvent(event);
    const uri = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    const html = event.dataTransfer.getData('text/html');
    const text = event.dataTransfer.getData('text/plain');
    if (uri && /^https?:\/\//i.test(uri.trim())) {
      await onCommand({ type: 'ingestDrop', payload: { kind: 'url', url: uri.trim(), text: uri.trim() }, x: point.x, y: point.y });
      return;
    }
    if (html) {
      await onCommand({ type: 'ingestDrop', payload: { kind: 'html', html, text }, x: point.x, y: point.y });
      return;
    }
    const file = [...event.dataTransfer.files].find((entry) => entry.type.startsWith('image/'));
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        void onCommand({
          type: 'ingestDrop',
          payload: { kind: 'image', imageName: file.name, imageDataUrl: String(reader.result ?? '') },
          x: point.x,
          y: point.y,
        });
      };
      reader.readAsDataURL(file);
      return;
    }
    if (text.trim()) {
      await onCommand({ type: 'ingestDrop', payload: { kind: 'text', text }, x: point.x, y: point.y });
    }
  };

  const finishDraft = (state: DraftState) => {
    const now = new Date().toISOString();
    const zIndex = mergedObjects.length + 1;
    if (state.kind === 'stroke' && state.points && state.points.length > 1) {
      upsertLocal({
        id: state.id,
        kind: 'stroke',
        x: Math.min(...state.points.map((point) => point.x)),
        y: Math.min(...state.points.map((point) => point.y)),
        width: 0,
        height: 0,
        rotation: 0,
        zIndex,
        payload: { points: state.points, color: '#40372f', width: 2 },
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    if (state.kind === 'arrow') {
      upsertLocal({
        id: state.id,
        kind: 'arrow',
        x: state.start.x,
        y: state.start.y,
        width: state.current.x - state.start.x,
        height: state.current.y - state.start.y,
        rotation: 0,
        zIndex,
        payload: {
          x1: state.start.x,
          y1: state.start.y,
          x2: state.current.x,
          y2: state.current.y,
          color: '#d8892b',
          width: 2,
        },
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    if (state.kind === 'rect') {
      const x = Math.min(state.start.x, state.current.x);
      const y = Math.min(state.start.y, state.current.y);
      upsertLocal({
        id: state.id,
        kind: 'rect',
        x,
        y,
        width: Math.abs(state.current.x - state.start.x),
        height: Math.abs(state.current.y - state.start.y),
        rotation: 0,
        zIndex,
        payload: { stroke: '#40372f', fill: 'rgba(216, 137, 43, 0.08)', strokeWidth: 2 },
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  const placeObject = (point: { x: number; y: number }) => {
    const now = new Date().toISOString();
    const id = createId();
    const zIndex = mergedObjects.length + 1;
    if (tool === 'text') {
      upsertLocal({
        id,
        kind: 'text',
        x: point.x,
        y: point.y,
        width: 180,
        height: 48,
        rotation: 0,
        zIndex,
        payload: { text: '', fontSize: 14, color: '#40372f' },
        createdAt: now,
        updatedAt: now,
      });
      setDrafts((current) => ({ ...current, [id]: '' }));
      suppressBlurRef.current = true;
      window.setTimeout(() => { suppressBlurRef.current = false; }, 500);
      setEditingId(id);
      return;
    }
    if (tool === 'sticky') {
      upsertLocal({
        id,
        kind: 'sticky',
        x: point.x,
        y: point.y,
        width: 160,
        height: 120,
        rotation: 0,
        zIndex,
        payload: { text: '', color: '#fff4bf' },
        createdAt: now,
        updatedAt: now,
      });
      setDrafts((current) => ({ ...current, [id]: '' }));
      suppressBlurRef.current = true;
      window.setTimeout(() => { suppressBlurRef.current = false; }, 500);
      setEditingId(id);
    }
  };

  const clearDraft = (objectId: string) => {
    setDrafts((currentDrafts) => {
      const next = { ...currentDrafts };
      delete next[objectId];
      return next;
    });
  };

  const commitEdit = (objectId: string, nextText: string) => {
    const current = mergedObjects.find((entry) => entry.id === objectId);
    if (!current || (current.kind !== 'text' && current.kind !== 'sticky')) return;
    const text = nextText.trim();
    // Empty text/sticky after blur, Escape, or tool switch should vanish — not become a "Text"/"Note" label.
    if (!text) {
      setLocalObjects((locals) => {
        const next = { ...locals };
        delete next[objectId];
        return next;
      });
      void onCommand({ type: 'deleteObject', objectId });
      clearDraft(objectId);
      setEditingId(null);
      return;
    }
    upsertLocal({
      ...current,
      payload: { ...current.payload, text },
      updatedAt: new Date().toISOString(),
    });
    clearDraft(objectId);
    setEditingId(null);
  };

  // Leaving text/sticky tool while editing must finalize (empty → delete, not "Text" label).
  useEffect(() => {
    if (tool === 'text' || tool === 'sticky') return;
    const id = editingIdRef.current;
    if (!id) return;
    commitEdit(id, draftsRef.current[id] ?? '');
    // Tool-only deps: Select + double-click edit must not auto-commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const beginEdit = (objectId: string, initial: string) => {
    setDrafts((current) => ({ ...current, [objectId]: initial }));
    suppressBlurRef.current = true;
    window.setTimeout(() => { suppressBlurRef.current = false; }, 500);
    setEditingId(objectId);
  };

  const handleEditorBlur = (objectId: string) => {
    // Ignore the immediate BrowserView focus steal after placing/opening the editor.
    if (suppressBlurRef.current) {
      window.requestAnimationFrame(() => editInputRef.current?.focus());
      return;
    }
    window.setTimeout(() => {
      if (editingIdRef.current !== objectId) return;
      if (document.activeElement === editInputRef.current) return;
      commitEdit(objectId, draftsRef.current[objectId] ?? '');
    }, 0);
  };

  const stopEditPointer = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      ref={surfaceRef}
      className="poppin-pad-canvas"
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
      onDrop={(event) => { void handleDrop(event); }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('textarea')) return;
        // Commit the open editor when clicking elsewhere on the canvas.
        if (activeEditingId && !(event.target as HTMLElement).closest(`[data-pad-object="${activeEditingId}"]`)) {
          commitEdit(activeEditingId, drafts[activeEditingId] ?? '');
        }
        if (tool === 'select') return;
        if ((event.target as HTMLElement).closest('.poppin-pad-text, .poppin-pad-sticky')) return;
        const point = pointFromEvent(event);
        if (tool === 'text' || tool === 'sticky') {
          placeObject(point);
          return;
        }
        const id = createId();
        if (tool === 'pen') {
          setDraft({ kind: 'stroke', id, start: point, current: point, points: [point] });
        } else {
          setDraft({ kind: tool === 'arrow' ? 'arrow' : 'rect', id, start: point, current: point });
        }
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!draft) return;
        const point = pointFromEvent(event);
        if (draft.kind === 'stroke') {
          setDraft({ ...draft, current: point, points: [...(draft.points ?? []), point] });
          return;
        }
        setDraft({ ...draft, current: point });
      }}
      onPointerUp={() => {
        if (!draft) return;
        finishDraft(draft);
        setDraft(null);
      }}
      onPointerCancel={() => setDraft(null)}
    >
      <svg className="poppin-pad-svg" aria-hidden="true">
        {mergedObjects.filter((object) => object.kind === 'stroke').map((object) => {
          const payload = object.payload as { points: { x: number; y: number }[]; color: string; width: number };
          return <path key={object.id} d={strokePath(payload.points)} stroke={payload.color} strokeWidth={payload.width} fill="none" strokeLinecap="round" />;
        })}
        {mergedObjects.filter((object) => object.kind === 'arrow').map((object) => {
          const payload = object.payload as { x1: number; y1: number; x2: number; y2: number; color: string; width: number };
          return (
            <g key={object.id}>
              <line x1={payload.x1} y1={payload.y1} x2={payload.x2} y2={payload.y2} stroke={payload.color} strokeWidth={payload.width} markerEnd="url(#poppin-pad-arrowhead)" />
            </g>
          );
        })}
        {mergedObjects.filter((object) => object.kind === 'rect').map((object) => {
          const payload = object.payload as { stroke: string; fill: string; strokeWidth: number };
          return <rect key={object.id} x={object.x} y={object.y} width={object.width} height={object.height} stroke={payload.stroke} fill={payload.fill} strokeWidth={payload.strokeWidth} rx="8" />;
        })}
        {draft?.kind === 'stroke' && draft.points ? (
          <path d={strokePath(draft.points)} stroke="#40372f" strokeWidth="2" fill="none" strokeLinecap="round" />
        ) : null}
        {draft && draft.kind !== 'stroke' ? (
          <rect
            x={Math.min(draft.start.x, draft.current.x)}
            y={Math.min(draft.start.y, draft.current.y)}
            width={Math.abs(draft.current.x - draft.start.x)}
            height={Math.abs(draft.current.y - draft.start.y)}
            stroke="#d8892b"
            fill="rgba(216, 137, 43, 0.08)"
            strokeWidth="2"
            rx="8"
          />
        ) : null}
        <defs>
          <marker id="poppin-pad-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#d8892b" />
          </marker>
        </defs>
      </svg>

      {mergedObjects.filter((object) => object.kind === 'text').map((object) => {
        const payload = object.payload as { text: string; fontSize: number; color: string };
        const editing = activeEditingId === object.id;
        return (
          <div
            key={object.id}
            data-pad-object={object.id}
            className="poppin-pad-text"
            style={{ left: object.x, top: object.y, fontSize: payload.fontSize, color: payload.color, zIndex: object.zIndex }}
            draggable={!editing}
            onDragStart={(event) => event.dataTransfer.setData('application/x-poppin-pad-attachment', object.id)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginEdit(object.id, payload.text);
            }}
          >
            {editing ? (
              <textarea
                ref={editInputRef}
                className="poppin-pad-inline-input"
                value={drafts[object.id] ?? payload.text}
                placeholder="Type here…"
                aria-label="Text callout"
                onChange={(event) => setDrafts((current) => ({ ...current, [object.id]: event.target.value }))}
                onPointerDown={stopEditPointer}
                onMouseDown={(event) => { event.stopPropagation(); }}
                onClick={stopEditPointer}
                onBlur={() => handleEditorBlur(object.id)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    commitEdit(object.id, drafts[object.id] ?? '');
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    commitEdit(object.id, drafts[object.id] ?? '');
                  }
                }}
              />
            ) : (
              payload.text
            )}
          </div>
        );
      })}

      {mergedObjects.filter((object) => object.kind === 'sticky').map((object) => {
        const payload = object.payload as { text: string; color: string };
        const editing = activeEditingId === object.id;
        return (
          <div
            key={object.id}
            data-pad-object={object.id}
            className="poppin-pad-sticky"
            style={{ left: object.x, top: object.y, width: object.width, height: object.height, background: payload.color, zIndex: object.zIndex }}
            draggable={!editing}
            onDragStart={(event) => event.dataTransfer.setData('application/x-poppin-pad-attachment', object.id)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginEdit(object.id, payload.text);
            }}
          >
            {editing ? (
              <textarea
                ref={editInputRef}
                className="poppin-pad-inline-input poppin-pad-inline-input-sticky"
                value={drafts[object.id] ?? payload.text}
                placeholder="Sticky note…"
                aria-label="Sticky note"
                onChange={(event) => setDrafts((current) => ({ ...current, [object.id]: event.target.value }))}
                onPointerDown={stopEditPointer}
                onMouseDown={(event) => { event.stopPropagation(); }}
                onClick={stopEditPointer}
                onBlur={() => handleEditorBlur(object.id)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) || event.key === 'Escape') {
                    event.preventDefault();
                    commitEdit(object.id, drafts[object.id] ?? '');
                  }
                }}
              />
            ) : (
              payload.text || 'Note'
            )}
          </div>
        );
      })}

      {mergedObjects.filter((object) => object.kind === 'card').map((object) => (
        <PoppinPadCard
          key={object.id}
          object={object}
          selected={selectedId === object.id}
          onSelect={setSelectedId}
          onMove={(objectId, x, y) => {
            const current = mergedObjects.find((entry) => entry.id === objectId);
            if (!current) return;
            upsertLocal({ ...current, x, y, updatedAt: new Date().toISOString() });
          }}
          onResize={(objectId, width, height) => {
            const current = mergedObjects.find((entry) => entry.id === objectId);
            if (!current) return;
            upsertLocal({ ...current, width, height, updatedAt: new Date().toISOString() });
          }}
        />
      ))}
    </div>
  );
}
