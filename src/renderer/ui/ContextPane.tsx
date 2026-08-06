import { ChevronLeft, ChevronRight, FileText, Globe2, RefreshCw } from 'lucide-react';

import type { WorkspaceSnapshot } from '../../shared/workspace';

interface ContextPaneProps {
  collapsed: boolean;
  snapshot: WorkspaceSnapshot;
  onCollapseChange: (collapsed: boolean) => void;
  onRefreshTab: (tabId: string) => void;
}

export function ContextPane({ collapsed, snapshot, onCollapseChange, onRefreshTab }: ContextPaneProps) {
  const selectedDocuments = snapshot.documents.filter((document) => document.selected);
  const itemCount = snapshot.tabContexts.length + selectedDocuments.length;

  if (collapsed) {
    return (
      <aside className="side-rail side-rail-right" aria-label="Context collapsed">
        <button type="button" className="pane-toggle" onClick={() => onCollapseChange(false)} aria-label="Open context">
          <ChevronLeft size={17} />
        </button>
        <span className="rail-count">{itemCount}</span>
      </aside>
    );
  }

  return (
    <aside className="context-pane side-pane" aria-label="Context">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Context</span>
          <h2>What Codex will see</h2>
        </div>
        <button type="button" className="pane-toggle" onClick={() => onCollapseChange(true)} aria-label="Collapse context">
          <ChevronRight size={17} />
        </button>
      </div>
      <p className="context-explainer">Only checked items appear here. Captured content is frozen until you refresh it.</p>
      <div className="context-list">
        {itemCount === 0 ? <div className="context-empty">Nothing selected. Check a tab or document in the workspace.</div> : null}
        {snapshot.tabContexts.map((context) => (
          <article className="context-card" key={context.tabId}>
            <div className="context-card-heading">
              <Globe2 size={14} />
              <strong>{context.title}</strong>
              <button type="button" onClick={() => onRefreshTab(context.tabId)} aria-label={`Refresh ${context.title} context`}><RefreshCw size={13} /></button>
            </div>
            <span className="context-source">{context.url}</span>
            <pre>{context.capturedText || '(No visible page text)'}</pre>
            {context.truncated ? <span className="context-note">Captured at the 60,000-character limit.</span> : null}
          </article>
        ))}
        {selectedDocuments.map((document) => (
          <article className="context-card" key={document.id}>
            <div className="context-card-heading"><FileText size={14} /><strong>{document.name}</strong></div>
            <span className="context-source">{document.path}</span>
            <pre>{document.capturedText ?? '(File metadata only; this format is not read as text.)'}</pre>
            {document.truncated ? <span className="context-note">Captured at the 60,000-character limit.</span> : null}
          </article>
        ))}
      </div>
    </aside>
  );
}
