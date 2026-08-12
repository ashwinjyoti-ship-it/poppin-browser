import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import { useState } from 'react';

import type { PoppinPadCommand, PoppinPadCommandResult, PoppinPadSnapshot } from '../../shared/poppin-pad';
import { PoppinPadCanvas } from './poppin-pad/PoppinPadCanvas';
import { PoppinPadToolbar } from './poppin-pad/PoppinPadToolbar';

interface PoppinPadPaneProps {
  snapshot: PoppinPadSnapshot;
  onCollapseChange: (collapsed: boolean) => void;
  onCommand: (command: PoppinPadCommand) => Promise<PoppinPadCommandResult>;
}

export function PoppinPadPane({ snapshot, onCollapseChange, onCommand }: PoppinPadPaneProps) {
  const [message, setMessage] = useState('');

  if (snapshot.pad.collapsed) {
    return (
      <aside className="side-rail side-rail-right" aria-label="Poppin Pad collapsed">
        <button type="button" className="pane-toggle" onClick={() => { void onCommand({ type: 'setCollapsed', collapsed: false }); onCollapseChange(false); }} aria-label="Open Poppin Pad" title="Open Poppin Pad">
          <ChevronLeft size={16} />
        </button>
        <LayoutGrid size={16} aria-hidden="true" />
      </aside>
    );
  }

  return (
    <aside className="poppin-pad-pane side-pane" aria-label="Poppin Pad">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Poppin Pad</span>
          <h2>{snapshot.pad.title}</h2>
        </div>
        <button
          type="button"
          className="pane-toggle"
          onClick={() => { void onCommand({ type: 'setCollapsed', collapsed: true }); onCollapseChange(true); }}
          aria-label="Collapse Poppin Pad"
          title="Collapse Poppin Pad"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <PoppinPadToolbar
        tool={snapshot.pad.tool}
        active={snapshot.pad.active}
        onCommand={onCommand}
        onMessage={setMessage}
      />
      <PoppinPadCanvas objects={snapshot.objects} tool={snapshot.pad.tool} onCommand={onCommand} />
      {message ? <p className="poppin-pad-message">{message}</p> : null}
    </aside>
  );
}
