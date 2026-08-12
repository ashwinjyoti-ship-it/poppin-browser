import {
  ArrowUpRight,
  Eraser,
  MousePointer2,
  PenLine,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';

import type { PadTool, PoppinPadCommand, PoppinPadCommandResult } from '../../../shared/poppin-pad';

interface PoppinPadToolbarProps {
  tool: PadTool;
  onCommand: (command: PoppinPadCommand) => Promise<PoppinPadCommandResult>;
  onMessage: (message: string) => void;
  active: boolean;
}

const TOOLS: Array<{ id: PadTool; label: string; icon: typeof MousePointer2 }> = [
  { id: 'select', label: 'Select / move', icon: MousePointer2 },
  { id: 'pen', label: 'Freehand pen', icon: PenLine },
  { id: 'arrow', label: 'Directional arrow', icon: ArrowUpRight },
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'text', label: 'Text callout', icon: Type },
  { id: 'sticky', label: 'Sticky note', icon: StickyNote },
];

export function PoppinPadToolbar({ tool, onCommand, onMessage, active }: PoppinPadToolbarProps) {
  return (
    <div className="poppin-pad-toolbar" role="toolbar" aria-label="Poppin Pad tools">
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`poppin-pad-tool ${tool === id ? 'poppin-pad-tool-active' : ''}`}
          aria-label={label}
          title={label}
          aria-pressed={tool === id}
          onClick={() => { void onCommand({ type: 'setTool', tool: id }); }}
        >
          <Icon size={15} />
        </button>
      ))}
      <button
        type="button"
        className="poppin-pad-tool"
        aria-label="Clear canvas"
        title="Clear canvas"
        onClick={() => {
          if (!window.confirm('Clear drawings and cards from Poppin Pad?')) return;
          void onCommand({ type: 'clearCanvas', scope: 'all' });
        }}
      >
        <Eraser size={15} />
      </button>
      <button
        type="button"
        className={`poppin-pad-tool poppin-pad-tool-focus ${active ? 'poppin-pad-tool-active' : ''}`}
        aria-label={active ? 'Exit focus mode' : 'Expand pad to workspace'}
        title={active ? 'Exit focus mode' : 'Expand pad to workspace'}
        onClick={() => { void onCommand({ type: 'setActive', active: !active }); }}
      >
        Focus
      </button>
      <button
        type="button"
        className="poppin-pad-export"
        onClick={() => {
          void onCommand({ type: 'exportToTandem' }).then((result) => {
            onMessage(result.message ?? (result.ok ? 'Exported to Tandem.' : 'Export failed.'));
          });
        }}
      >
        Create Tandem page
      </button>
    </div>
  );
}
