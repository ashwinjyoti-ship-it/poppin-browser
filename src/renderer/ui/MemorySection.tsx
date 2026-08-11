import { Brain } from 'lucide-react';

import type { PagesCommand } from '../../shared/pages';
import type { MemoryBriefSnapshot, WorkspaceCommand } from '../../shared/workspace';

interface MemorySectionProps {
  memorySelected: boolean;
  memoryBrief: MemoryBriefSnapshot | null;
  onCommand: (command: PagesCommand) => Promise<string | null>;
  onWorkspaceCommand: (command: WorkspaceCommand) => Promise<string | null>;
}

/**
 * Memory is a working brief that lives entirely on this Mac. Opting it into
 * context freezes the current OS-encrypted contents inline, just like tabs
 * and documents, so the user can see exactly what will be sent.
 */
export function MemorySection({ memorySelected, memoryBrief, onCommand, onWorkspaceCommand }: MemorySectionProps) {
  const hasBrief = Boolean(memoryBrief);
  return (
    <section className="workspace-section memory-section" aria-label="Memory">
      <div className="section-heading"><span>Memory</span></div>
      <label className={`selection-row ${hasBrief ? '' : 'selection-row-disabled'}`}>
        <input
          type="checkbox"
          checked={memorySelected}
          disabled={!hasBrief && !memorySelected}
          onChange={(event) => { void onWorkspaceCommand({ type: 'setMemorySelected', selected: event.target.checked }); }}
        />
        <Brain size={14} />
        <span>Use as context{hasBrief ? '' : ' (open Memory first)'}</span>
      </label>
      <button type="button" className="memory-open-button" onClick={() => { void onCommand({ type: 'openMemory' }); }}>
        <Brain size={15} />
        <span><strong>Open Memory</strong><small>Encrypted locally on this Mac</small></span>
      </button>
      {memorySelected && memoryBrief ? (
        <div className="context-preview">
          <pre>{memoryBrief.content || '(Memory is empty)'}</pre>
          {memoryBrief.truncated ? <span className="context-note">Captured at the 60,000-character limit.</span> : null}
        </div>
      ) : null}
    </section>
  );
}
