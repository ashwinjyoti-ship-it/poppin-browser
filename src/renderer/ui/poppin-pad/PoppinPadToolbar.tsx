import {
  ArrowUpRight,
  Eraser,
  FileDown,
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

const TOOLS: Array<{ id: PadTool; label: string; shortLabel: string; icon: typeof MousePointer2 }> = [
  { id: 'select', label: 'Select / move', shortLabel: 'Select', icon: MousePointer2 },
  { id: 'pen', label: 'Freehand pen', shortLabel: 'Pen', icon: PenLine },
  { id: 'arrow', label: 'Directional arrow', shortLabel: 'Arrow', icon: ArrowUpRight },
  { id: 'rect', label: 'Rectangle', shortLabel: 'Rect', icon: Square },
  { id: 'text', label: 'Text callout — click canvas, then type', shortLabel: 'Text', icon: Type },
  { id: 'sticky', label: 'Sticky note — click canvas, then type', shortLabel: 'Sticky', icon: StickyNote },
];

export function PoppinPadToolbar({ tool, onCommand, onMessage, active }: PoppinPadToolbarProps) {
  return (
    <div className="poppin-pad-toolbar" role="toolbar" aria-label="Poppin Pad tools">
      {TOOLS.map(({ id, label, shortLabel, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`poppin-pad-tool ${tool === id ? 'poppin-pad-tool-active' : ''}`}
          aria-label={label}
          title={label}
          data-tooltip={shortLabel}
          aria-pressed={tool === id}
          onClick={() => {
            void onCommand({ type: 'setTool', tool: id });
          }}
        >
          <Icon size={15} />
        </button>
      ))}
      <button
        type="button"
        className="poppin-pad-tool"
        aria-label="Clear canvas"
        title="Clear canvas"
        data-tooltip="Clear"
        onClick={() => {
          void onCommand({ type: 'clearCanvas', scope: 'all' }).then((result) => {
            if (result.message) onMessage(result.message);
          });
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
      <div className="poppin-pad-export-group">
        <button
          type="button"
          className="poppin-pad-export"
          title="Save the pad as a PDF"
          onClick={() => {
            void onCommand({ type: 'exportToPdf' }).then((result) => {
              onMessage(result.message ?? (result.ok ? 'Saved PDF.' : 'PDF export failed.'));
            });
          }}
        >
          <FileDown size={13} />
          Export PDF
        </button>
        <button
          type="button"
          className="poppin-pad-export"
          title="Create a readable Tandem page from this pad"
          onClick={() => {
            void onCommand({ type: 'exportToTandem' }).then((result) => {
              onMessage(result.message ?? (result.ok ? 'Exported to Tandem.' : 'Export failed.'));
            });
          }}
        >
          Create Tandem page
        </button>
      </div>
    </div>
  );
}
