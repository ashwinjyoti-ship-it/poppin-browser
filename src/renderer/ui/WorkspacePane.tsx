import { ChevronLeft, ChevronRight, Layers3 } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { WorkspaceSnapshot } from '../../shared/workspace';

interface WorkspacePaneProps {
  collapsed: boolean;
  snapshot: WorkspaceSnapshot;
  onCollapseChange: (collapsed: boolean) => void;
  onCreate: (name: string) => Promise<string | null>;
}

export function WorkspacePane({ collapsed, snapshot, onCollapseChange, onCreate }: WorkspacePaneProps) {
  const [name, setName] = useState('My Workspace');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const message = await onCreate(name);
    setError(message ?? '');
    setSubmitting(false);
  };

  if (collapsed) {
    return (
      <aside className="side-rail side-rail-left" aria-label="Workspace collapsed">
        <button type="button" className="pane-toggle" onClick={() => onCollapseChange(false)} aria-label="Open workspace">
          <ChevronRight size={17} />
        </button>
        <Layers3 size={17} aria-hidden="true" />
      </aside>
    );
  }

  return (
    <aside className="workspace-pane side-pane" aria-label="Workspace">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h2>{snapshot.workspace?.name ?? 'Create your workspace'}</h2>
        </div>
        <button type="button" className="pane-toggle" onClick={() => onCollapseChange(true)} aria-label="Collapse workspace">
          <ChevronLeft size={17} />
        </button>
      </div>
      {snapshot.workspace ? (
        <div className="workspace-empty-state">
          <div className="workspace-mark"><Layers3 size={20} /></div>
          <h3>One place for the work</h3>
          <p>Your tabs, documents, project, and task will stay grouped here.</p>
        </div>
      ) : (
        <form className="workspace-create" onSubmit={submit}>
          <p>Keep the browser central while grouping everything needed for one outcome.</p>
          <label htmlFor="workspace-name">Workspace name</label>
          <input id="workspace-name" value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setError(''); }} autoFocus />
          {error ? <span className="form-error" role="alert">{error}</span> : null}
          <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Creating…' : 'Create workspace'}</button>
        </form>
      )}
    </aside>
  );
}
