import { ChevronLeft, ChevronRight, FilePlus2, FileText, Globe2, Layers3, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { WorkspaceSnapshot } from '../../shared/workspace';
import type { BrowserTabSnapshot } from '../../shared/browser';

interface WorkspacePaneProps {
  collapsed: boolean;
  snapshot: WorkspaceSnapshot;
  tabs: BrowserTabSnapshot[];
  onCollapseChange: (collapsed: boolean) => void;
  onCreate: (name: string) => Promise<string | null>;
  onCommand: (command: import('../../shared/workspace').WorkspaceCommand) => void;
}

export function WorkspacePane({ collapsed, snapshot, tabs, onCollapseChange, onCreate, onCommand }: WorkspacePaneProps) {
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
        <div className="workspace-content">
          <section className="workspace-section">
            <div className="section-heading"><span>Tabs</span><span>{tabs.length}</span></div>
            <div className="selection-list">
              {tabs.map((tab) => {
                const selected = snapshot.tabContexts.some((context) => context.tabId === tab.id);
                const selectable = tab.url.startsWith('http://') || tab.url.startsWith('https://');
                return (
                  <label className={`selection-row ${selectable ? '' : 'selection-row-disabled'}`} key={tab.id}>
                    <input type="checkbox" checked={selected} disabled={!selectable} onChange={(event) => onCommand({ type: 'setTabSelected', tabId: tab.id, selected: event.target.checked })} />
                    <Globe2 size={14} />
                    <span>{tab.title}</span>
                  </label>
                );
              })}
            </div>
          </section>
          <section className="workspace-section">
            <div className="section-heading"><span>Documents</span><button type="button" onClick={() => onCommand({ type: 'chooseDocuments' })}><FilePlus2 size={14} /> Add</button></div>
            <div className="selection-list">
              {snapshot.documents.length === 0 ? <span className="section-empty">No documents added.</span> : null}
              {snapshot.documents.map((document) => (
                <div className="document-row" key={document.id}>
                  <label className="selection-row">
                    <input type="checkbox" checked={document.selected} onChange={(event) => onCommand({ type: 'setDocumentSelected', documentId: document.id, selected: event.target.checked })} />
                    <FileText size={14} />
                    <span>{document.name}</span>
                  </label>
                  <button type="button" onClick={() => onCommand({ type: 'removeDocument', documentId: document.id })} aria-label={`Remove ${document.name}`}><X size={13} /></button>
                </div>
              ))}
            </div>
          </section>
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
