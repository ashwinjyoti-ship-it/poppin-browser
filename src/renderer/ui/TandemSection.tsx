import { type ReactNode, useEffect, useRef, useState } from 'react';
import { BookOpenText, ChevronDown, ChevronRight, Database, FileText, Folder, RefreshCw, Search, Settings2, Shapes } from 'lucide-react';

import type { TandemCommand, TandemContextSnapshot, TandemPageSnapshot, TandemSnapshot } from '../../shared/tandem';

/** How often the expanded picker re-reads Tandem's live project/page tree. */
const BROWSE_POLL_MS = 20_000;

interface TandemSectionProps {
  snapshot: TandemSnapshot;
  onCommand: (command: TandemCommand) => Promise<string | null>;
  onOpenSettings?: () => void;
}

/**
 * Compact explicit-context picker for Tandem. The remote Tandem application
 * remains the full editing surface; this list only freezes checked pages for
 * the agent and can collapse so it never consumes the whole workspace pane.
 */
export function TandemSection({ snapshot, onCommand, onOpenSettings }: TandemSectionProps) {
  const [query, setQuery] = useState(snapshot.searchQuery);
  const [expanded, setExpanded] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [pagesExpanded, setPagesExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const onCommandRef = useRef(onCommand);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  const run = async (command: TandemCommand) => {
    setBusy(true);
    const error = await onCommand(command);
    setBusy(false);
    setMessage(error ?? '');
  };

  // Keep Recent / Projects & pages aligned with Tandem while the picker is open.
  // Frozen selected snapshots are intentionally left alone until the user hits refresh.
  useEffect(() => {
    if (snapshot.connection.state !== 'ready' || !expanded) return;
    let cancelled = false;
    const refreshBrowse = () => {
      if (cancelled) return;
      void onCommandRef.current({ type: 'refreshBrowse' });
    };
    refreshBrowse();
    const interval = window.setInterval(refreshBrowse, BROWSE_POLL_MS);
    const onFocus = () => refreshBrowse();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [snapshot.connection.state, snapshot.activeWorkspaceId, expanded]);

  if (snapshot.connection.state !== 'ready') {
    return (
      <section className="workspace-section tandem-section tandem-section-disconnected" aria-label="Tandem">
        <div className="section-heading"><span>Tandem</span><span className={`integration-status integration-status-${snapshot.connection.state}`}>{snapshot.connection.state}</span></div>
        <p className="section-empty">{snapshot.connection.message}</p>
        <button type="button" className="tandem-settings-button" onClick={onOpenSettings}><Settings2 size={14} /> Open Tandem settings</button>
      </section>
    );
  }

  const selectedById = new Map(snapshot.selected.map((item) => [item.pageId, item]));
  const results = snapshot.searchQuery.trim() ? snapshot.searchResults : null;
  const tree = snapshot.pages.filter((page) => page.kind !== 'folder' || snapshot.pages.some((child) => child.parentId === page.id));

  const rows = (pages: TandemPageSnapshot[], prefix: string) => pages.map((page) => (
    <TandemRow
      key={`${prefix}-${page.id}`}
      page={page}
      context={selectedById.get(page.id)}
      busy={busy}
      nested={Boolean(page.parentId)}
      onToggle={(selected) => { void run({ type: 'setPageSelected', pageId: page.id, selected }); }}
      onOpen={() => { void run({ type: 'openWorld', pageId: page.id }); }}
    />
  ));

  return (
    <section className="workspace-section tandem-section" aria-label="Tandem">
      <div className="section-heading tandem-heading">
        <button type="button" className="section-disclosure" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>Tandem</span>
          <span className="section-count">{snapshot.selected.length} selected</span>
        </button>
        <button type="button" disabled={busy} onClick={() => { void run({ type: 'refreshContext' }); }} aria-label="Refresh Tandem pages and selected context"><RefreshCw size={13} /></button>
      </div>
      <button type="button" className="tandem-world-button" disabled={busy} onClick={() => { void run({ type: 'openWorld' }); }}>
        <BookOpenText size={15} /> Open Tandem World
      </button>
      {expanded ? (
        <div className="tandem-picker-body">
          {snapshot.workspaces.length > 1 ? (
            <label className="tandem-field">
              <span>Tandem workspace</span>
              <select value={snapshot.activeWorkspaceId ?? ''} onChange={(event) => { void run({ type: 'selectWorkspace', workspaceId: event.target.value }); }}>
                {snapshot.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              </select>
            </label>
          ) : snapshot.workspaces[0] ? <p className="tandem-workspace-name">{snapshot.workspaces[0].name}</p> : null}
          <form className="tandem-search" onSubmit={(event) => { event.preventDefault(); void run({ type: 'search', query }); }}>
            <Search size={13} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Tandem…" aria-label="Search Tandem" />
          </form>
          {results ? (
            <div className="selection-list tandem-list" aria-label="Tandem search results">
              {results.length ? rows(results, 'search') : <span className="section-empty">No Tandem pages matched.</span>}
            </div>
          ) : (
            <>
              {snapshot.recent.length ? <TandemList heading="Recent" count={Math.min(snapshot.recent.length, 6)} expanded={recentExpanded} onExpandedChange={setRecentExpanded}>{rows(snapshot.recent.slice(0, 6), 'recent')}</TandemList> : null}
              {tree.length ? <TandemList heading="Projects & pages" count={tree.length} expanded={pagesExpanded} onExpandedChange={setPagesExpanded}>{rows(tree.slice(0, 200), 'page')}</TandemList> : null}
              {tree.length === 0 && snapshot.recent.length === 0 ? <span className="section-empty">This Tandem workspace has no pages yet.</span> : null}
            </>
          )}
        </div>
      ) : null}
      {message ? <span className="form-error" role="alert">{message}</span> : null}
    </section>
  );
}

function TandemList({ heading, count, expanded, onExpandedChange, children }: {
  heading: string;
  count: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="tandem-list-group">
      <button type="button" className="tandem-list-disclosure" aria-expanded={expanded} onClick={() => onExpandedChange(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{heading}</span><span>{count}</span>
      </button>
      {expanded ? <div className="selection-list tandem-list">{children}</div> : null}
    </div>
  );
}

function TandemRow({ page, context, busy, nested, onToggle, onOpen }: {
  page: TandemPageSnapshot;
  context?: TandemContextSnapshot;
  busy: boolean;
  nested: boolean;
  onToggle: (selected: boolean) => void;
  onOpen: () => void;
}) {
  const selectable = page.kind === 'page' || page.kind === 'database';
  return (
    <div className={nested ? 'tandem-row-nested' : undefined}>
      <div className="document-row">
        <label className={`selection-row ${selectable ? '' : 'selection-row-disabled'}`}>
          <input type="checkbox" checked={Boolean(context)} disabled={busy || !selectable} onChange={(event) => onToggle(event.target.checked)} />
          <PageIcon kind={page.kind} />
          <span>{page.icon ? `${page.icon} ` : ''}{page.title}</span>
        </label>
        <span />
        <button type="button" onClick={onOpen} aria-label={`Open ${page.title} in Tandem World`} title="Open in Tandem World">↗</button>
      </div>
      {context ? (
        <details className="context-preview tandem-context-preview">
          <summary>Selected context snapshot</summary>
          <pre>{context.capturedMarkdown || '(Empty Tandem page)'}</pre>
          <span className="context-note">
            Frozen {new Date(context.capturedAt).toLocaleString()}.{context.stale ? ' This snapshot could not be refreshed.' : ''}
            {context.truncated ? ' Captured at the 60,000-character limit.' : ''}
          </span>
        </details>
      ) : null}
    </div>
  );
}

function PageIcon({ kind }: { kind: TandemPageSnapshot['kind'] }) {
  if (kind === 'folder') return <Folder size={14} />;
  if (kind === 'database') return <Database size={14} />;
  if (kind === 'canvas') return <Shapes size={14} />;
  return <FileText size={14} />;
}
