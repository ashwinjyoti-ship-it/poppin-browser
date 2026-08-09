import { Brain } from 'lucide-react';

import type { PagesCommand } from '../../shared/pages';

export function MemorySection({ onCommand }: {
  onCommand: (command: PagesCommand) => Promise<string | null>;
}) {
  return (
    <section className="workspace-section memory-section" aria-label="Memory">
      <div className="section-heading"><span>Memory</span></div>
      <button type="button" className="memory-open-button" onClick={() => { void onCommand({ type: 'openMemory' }); }}>
        <Brain size={15} />
        <span><strong>Open Memory</strong><small>Encrypted locally on this Mac</small></span>
      </button>
    </section>
  );
}
