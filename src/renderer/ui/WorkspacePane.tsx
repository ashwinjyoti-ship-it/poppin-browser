import { ChevronLeft, ChevronRight, FilePlus2, FileText, Globe2, Layers3, RefreshCw, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { WorkspaceSnapshot } from '../../shared/workspace';
import type { BrowserTabSnapshot } from '../../shared/browser';
import type { PagesCommand, PagesSnapshot } from '../../shared/pages';
import type { TandemCommand, TandemSnapshot } from '../../shared/tandem';
import type { WorkspaceCommandResult } from '../../shared/workspace';
import { ProjectSection } from './ProjectSection';
import { PagesSection } from './PagesSection';
import { TandemSection } from './TandemSection';

interface WorkspacePaneProps {
  collapsed: boolean;
  snapshot: WorkspaceSnapshot;
  tabs: BrowserTabSnapshot[];
  pages: PagesSnapshot;
  activeTab?: BrowserTabSnapshot | null;
  onCollapseChange: (collapsed: boolean) => void;
  onCreate: (name: string) => Promise<string | null>;
  onCommand: (command: import('../../shared/workspace').WorkspaceCommand) => Promise<string | null>;
  onPagesCommand: (command: PagesCommand) => Promise<string | null>;
  onRefreshTab: (tabId: string) => void;
  onCaptureVisualSelection?: (tabId: string) => Promise<WorkspaceCommandResult>;
  onClearVisualSelection?: () => void;
  tandem: TandemSnapshot;
  onTandemCommand: (command: TandemCommand) => Promise<string | null>;
}

/**
 * Owns both context selection and its preview: checking an item freezes its
 * captured content right here, inline, instead of in a separate pane. Only
 * checked items are ever sent to the agent.
 */
export function WorkspacePane({
  collapsed, snapshot, tabs, pages, activeTab, onCollapseChange, onCreate, onCommand, onPagesCommand,
  onRefreshTab, onCaptureVisualSelection, onClearVisualSelection, tandem, onTandemCommand,
}: WorkspacePaneProps) {
  const [name, setName] = useState('My Workspace');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState('');
  const [selecting, setSelecting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const message = await onCreate(name);
    setError(message ?? '');
    setSubmitting(false);
  };

  const activeIsLocalhost = Boolean(activeTab && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(activeTab.url));
  const capture = async () => {
    if (!activeTab || !onCaptureVisualSelection) return;
    setSelecting(true);
    setSelectionMessage('Click an element in the visible localhost preview. Press Escape to cancel.');
    const result = await onCaptureVisualSelection(activeTab.id);
    setSelecting(false);
    setSelectionMessage(result.ok ? 'Element captured in explicit context.' : result.message ?? 'Selection was not captured.');
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
          <PagesSection snapshot={pages} pageContexts={snapshot.pageContexts ?? []} onCommand={onPagesCommand} />
          <TandemSection snapshot={tandem} onCommand={onTandemCommand} />
          <section className="workspace-section">
            <div className="section-heading"><span>Tabs</span><span>{tabs.length}</span></div>
            <div className="selection-list">
              {tabs.map((tab) => {
                const context = snapshot.tabContexts.find((candidate) => candidate.tabId === tab.id);
                const selectable = tab.url.startsWith('http://') || tab.url.startsWith('https://');
                return (
                  <div key={tab.id}>
                    <label className={`selection-row ${selectable ? '' : 'selection-row-disabled'}`}>
                      <input type="checkbox" checked={Boolean(context)} disabled={!selectable} onChange={(event) => { void onCommand({ type: 'setTabSelected', tabId: tab.id, selected: event.target.checked }); }} />
                      <Globe2 size={14} />
                      <span>{tab.title}</span>
                      {context ? <button type="button" className="context-refresh" onClick={() => onRefreshTab(tab.id)} aria-label={`Refresh ${tab.title} context`}><RefreshCw size={12} /></button> : null}
                    </label>
                    {context ? (
                      <div className="context-preview">
                        <pre>{context.capturedText || '(No visible page text)'}</pre>
                        {context.truncated ? <span className="context-note">Captured at the 60,000-character limit.</span> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {activeIsLocalhost ? (
              <div className="visual-selection-tools">
                <button type="button" className="secondary-button" disabled={selecting} onClick={() => { void capture(); }}>{selecting ? 'Pick an element…' : 'Select UI from preview'}</button>
                {selectionMessage ? <p>{selectionMessage}</p> : null}
              </div>
            ) : null}
            {snapshot.visualSelection ? (
              <div className="context-preview visual-selection-card">
                <div className="context-card-heading"><strong>Selected localhost UI</strong><button type="button" onClick={onClearVisualSelection} aria-label="Clear visual selection"><X size={13} /></button></div>
                <span className="context-source">{snapshot.visualSelection.selector}</span>
                <img src={snapshot.visualSelection.screenshotDataUrl} alt="Captured localhost element" />
                <pre>{snapshot.visualSelection.html}</pre>
                <span className="context-note">{Math.round(snapshot.visualSelection.boundingBox.width)} × {Math.round(snapshot.visualSelection.boundingBox.height)} px captured.</span>
              </div>
            ) : null}
          </section>
          <section className="workspace-section">
            <div className="section-heading"><span>Documents</span><button type="button" onClick={() => { void onCommand({ type: 'chooseDocuments' }); }}><FilePlus2 size={14} /> Add</button></div>
            <div className="selection-list">
              {snapshot.documents.length === 0 ? <span className="section-empty">No documents added.</span> : null}
              {snapshot.documents.map((document) => (
                <div key={document.id}>
                  <div className="document-row">
                    <label className="selection-row">
                      <input type="checkbox" checked={document.selected} onChange={(event) => { void onCommand({ type: 'setDocumentSelected', documentId: document.id, selected: event.target.checked }); }} />
                      <FileText size={14} />
                      <span>{document.name}</span>
                    </label>
                    {/\.xlsx$/i.test(document.name) ? <button type="button" className="document-open-database" onClick={() => { void onCommand({ type: 'openDocumentAsDatabase', documentId: document.id }); }} aria-label={`Open ${document.name} as Database`}>DB</button> : <span />}
                    <button type="button" onClick={() => { void onCommand({ type: 'removeDocument', documentId: document.id }); }} aria-label={`Remove ${document.name}`}><X size={13} /></button>
                  </div>
                  {document.selected ? (
                    <div className="context-preview">
                      <pre>{document.capturedText ?? '(File metadata only; this format is not read as text.)'}</pre>
                      {document.truncated ? <span className="context-note">Captured at the 60,000-character limit.</span> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
          <ProjectSection project={snapshot.project} onCommand={onCommand} />
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
