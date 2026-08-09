import { useState } from 'react';
import { Database, FileText, Folder, RefreshCw, Search, Shapes } from 'lucide-react';

import type { TandemCommand, TandemPageSnapshot, TandemSnapshot } from '../../shared/tandem';

interface TandemSectionProps {
  snapshot: TandemSnapshot;
  onCommand: (command: TandemCommand) => Promise<string | null>;
}

/**
 * Tandem as a first-class context source in Poppin's left pane. Checking a page
 * freezes its Markdown into explicit context; only checked pages are sent to the
 * selected agent.
 */
export function TandemSection({ snapshot, onCommand }: TandemSectionProps) {
  const [query, setQuery] = useState(snapshot.searchQuery);
  const [baseUrl, setBaseUrl] = useState(snapshot.connection.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (command: TandemCommand) => {
    setBusy(true);
    const error = await onCommand(command);
    setBusy(false);
    setMessage(error ?? '');
  };

  if (snapshot.connection.state !== 'ready') {
    return (
      <section className="workspace-section tandem-section" aria-label="Tandem">
        <div className="section-heading"><span>Tandem</span></div>
        <p className="section-empty">{snapshot.connection.message}</p>
        <label className="tandem-field">
          <span>Tandem address</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://tandem.example.com" autoComplete="off" />
        </label>
        <label className="tandem-field">
          <span>API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="udm_…"
            autoComplete="off"
          />
        </label>
        <p className="context-note">The key is sealed in the macOS Keychain and never reaches a web page.</p>
        <div className="tandem-actions">
          <button type="button" className="primary-button" disabled={busy || !baseUrl.trim() || !apiKey.trim()} onClick={() => { void run({ type: 'connect', baseUrl, apiKey }).then(() => setApiKey('')); }}>
            Connect Tandem
          </button>
          {snapshot.connection.hasCredential ? (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { void run({ type: 'refreshConnection' }); }}>Retry</button>
          ) : null}
        </div>
        {message ? <span className="form-error" role="alert">{message}</span> : null}
      </section>
    );
  }

  const selectedIds = new Set(snapshot.selected.map((item) => item.pageId));
  const results = snapshot.searchQuery.trim() ? snapshot.searchResults : null;
  const tree = snapshot.pages.filter((page) => page.kind !== 'folder' || snapshot.pages.some((child) => child.parentId === page.id));

  return (
    <section className="workspace-section tandem-section" aria-label="Tandem">
      <div className="section-heading">
        <span>Tandem</span>
        <button type="button" disabled={busy} onClick={() => { void run({ type: 'refreshContext' }); }} aria-label="Refresh Tandem context">
          <RefreshCw size={13} /> Refresh Context
        </button>
      </div>
      {snapshot.workspaces.length > 1 ? (
        <label className="tandem-field">
          <span className="sr-only">Tandem workspace</span>
          <select
            value={snapshot.activeWorkspaceId ?? ''}
            onChange={(event) => { void run({ type: 'selectWorkspace', workspaceId: event.target.value }); }}
            aria-label="Tandem workspace"
          >
            {snapshot.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
      ) : null}
      <form
        className="tandem-search"
        onSubmit={(event) => { event.preventDefault(); void run({ type: 'search', query }); }}
      >
        <Search size={13} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Tandem…" aria-label="Search Tandem" />
      </form>
      <div className="selection-list">
        {results ? (
          results.length === 0
            ? <span className="section-empty">No Tandem pages matched.</span>
            : results.map((page) => <TandemRow key={page.id} page={page} checked={selectedIds.has(page.id)} busy={busy} onToggle={(selected) => { void run({ type: 'setPageSelected', pageId: page.id, selected }); }} onOpen={() => { void run({ type: 'openWorld', pageId: page.id }); }} />)
        ) : (
          <>
            {snapshot.recent.length ? <span className="section-subheading">Recent</span> : null}
            {snapshot.recent.slice(0, 6).map((page) => (
              <TandemRow key={`recent-${page.id}`} page={page} checked={selectedIds.has(page.id)} busy={busy} onToggle={(selected) => { void run({ type: 'setPageSelected', pageId: page.id, selected }); }} onOpen={() => { void run({ type: 'openWorld', pageId: page.id }); }} />
            ))}
            {tree.length ? <span className="section-subheading">Pages</span> : null}
            {tree.slice(0, 200).map((page) => (
              <TandemRow key={page.id} page={page} checked={selectedIds.has(page.id)} busy={busy} onToggle={(selected) => { void run({ type: 'setPageSelected', pageId: page.id, selected }); }} onOpen={() => { void run({ type: 'openWorld', pageId: page.id }); }} />
            ))}
            {tree.length === 0 && snapshot.recent.length === 0 ? <span className="section-empty">This Tandem workspace has no pages yet.</span> : null}
          </>
        )}
      </div>
      {message ? <span className="form-error" role="alert">{message}</span> : null}
    </section>
  );
}

function TandemRow({ page, checked, busy, onToggle, onOpen }: {
  page: TandemPageSnapshot;
  checked: boolean;
  busy: boolean;
  onToggle: (selected: boolean) => void;
  onOpen: () => void;
}) {
  const selectable = page.kind === 'page' || page.kind === 'database';
  return (
    <div className="document-row">
      <label className={`selection-row ${selectable ? '' : 'selection-row-disabled'}`}>
        <input type="checkbox" checked={checked} disabled={busy || !selectable} onChange={(event) => onToggle(event.target.checked)} />
        <PageIcon kind={page.kind} />
        <span>{page.icon ? `${page.icon} ` : ''}{page.title}</span>
      </label>
      <span />
      <button type="button" onClick={onOpen} aria-label={`Open ${page.title} in Tandem World`} title="Open in Tandem World">↗</button>
    </div>
  );
}

function PageIcon({ kind }: { kind: TandemPageSnapshot['kind'] }) {
  if (kind === 'folder') return <Folder size={14} />;
  if (kind === 'database') return <Database size={14} />;
  if (kind === 'canvas') return <Shapes size={14} />;
  return <FileText size={14} />;
}
