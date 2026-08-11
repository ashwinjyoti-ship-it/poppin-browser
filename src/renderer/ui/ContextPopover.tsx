import { FilePlus2, FileText, Globe2, Layers3, RefreshCw, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import type { BrowserTabSnapshot } from '../../shared/browser';
import type { PagesCommand } from '../../shared/pages';
import type { TandemCommand, TandemSnapshot } from '../../shared/tandem';
import type { WorkspaceCommand, WorkspaceCommandResult, WorkspaceSnapshot } from '../../shared/workspace';
import { contextItemCount } from './context-item-count';
import { MemorySection } from './MemorySection';
import { ProjectSection } from './ProjectSection';
import { TandemSection } from './TandemSection';
import {
  BrowserSessionsSection,
  ContextPacksSection,
  RecipesSection,
} from './WorkspacePane';

export interface ContextPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceSnapshot;
  tabs: BrowserTabSnapshot[];
  activeTab?: BrowserTabSnapshot | null;
  tandem: TandemSnapshot;
  onWorkspaceCommand: (command: WorkspaceCommand) => Promise<string | null>;
  onPagesCommand: (command: PagesCommand) => Promise<string | null>;
  onTandemCommand: (command: TandemCommand) => Promise<string | null>;
  onRefreshTab: (tabId: string) => void;
  onOpenSettings?: () => void;
  onCreateWorkspace: (name: string) => Promise<string | null>;
  onCaptureVisualSelection?: (tabId: string) => Promise<WorkspaceCommandResult>;
  onClearVisualSelection?: () => void;
  onRunRecipe?: (prompt: string) => void;
}

/** Prompt-bar workspace surface: exact context package without a standing pane. */
export function ContextPopover({
  open, onOpenChange, workspace, tabs, activeTab, tandem, onWorkspaceCommand, onPagesCommand,
  onTandemCommand, onRefreshTab, onOpenSettings, onCreateWorkspace,
  onCaptureVisualSelection, onClearVisualSelection, onRunRecipe,
}: ContextPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const count = contextItemCount(workspace, tandem);
  const [selectionMessage, setSelectionMessage] = useState('');
  const [selecting, setSelecting] = useState(false);
  const activeIsLocalhost = Boolean(activeTab && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(activeTab.url));

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [onOpenChange, open]);

  const capture = async () => {
    if (!activeTab || !onCaptureVisualSelection) return;
    setSelecting(true);
    setSelectionMessage('Click an element in the visible localhost preview. Press Escape to cancel.');
    const result = await onCaptureVisualSelection(activeTab.id);
    setSelecting(false);
    setSelectionMessage(result.ok ? 'Element captured in explicit context.' : result.message ?? 'Selection was not captured.');
  };

  return (
    <div className="context-chip-wrap" ref={panelRef}>
      <button
        type="button"
        className={`context-chip ${open ? 'context-chip-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(!open)}
      >
        <Layers3 size={14} />
        <span>Context{count > 0 ? ` (${count})` : ''}</span>
      </button>
      {open ? (
        <div className="context-popover" role="dialog" aria-label="Task context">
          {!workspace.workspace ? (
            <CreateWorkspaceForm onCreate={onCreateWorkspace} />
          ) : (
            <div className="context-popover-body workspace-content">
              <p className="context-popover-lead">Only checked items are sent. Preview matches the frozen package.</p>
              <TandemSection snapshot={tandem} onCommand={onTandemCommand} onOpenSettings={onOpenSettings} />
              <MemorySection
                memorySelected={workspace.memorySelected ?? false}
                memoryBrief={workspace.memoryBrief ?? null}
                onCommand={onPagesCommand}
                onWorkspaceCommand={onWorkspaceCommand}
              />
              <ContextPacksSection snapshot={workspace} onCommand={onWorkspaceCommand} />
              <BrowserSessionsSection snapshot={workspace} onCommand={onWorkspaceCommand} />
              <RecipesSection snapshot={workspace} onCommand={onWorkspaceCommand} onRunRecipe={onRunRecipe} />
              <section className="workspace-section">
                <div className="section-heading"><span>Tabs</span><span>{tabs.length}</span></div>
                <div className="selection-list">
                  {tabs.map((tab) => {
                    const context = workspace.tabContexts.find((candidate) => candidate.tabId === tab.id);
                    const selectable = tab.url.startsWith('http://') || tab.url.startsWith('https://');
                    return (
                      <div key={tab.id}>
                        <label className={`selection-row ${selectable ? '' : 'selection-row-disabled'}`}>
                          <input
                            type="checkbox"
                            checked={Boolean(context)}
                            disabled={!selectable}
                            onChange={(event) => { void onWorkspaceCommand({ type: 'setTabSelected', tabId: tab.id, selected: event.target.checked }); }}
                          />
                          <Globe2 size={14} />
                          <span>{tab.title}</span>
                          {context ? (
                            <button type="button" className="context-refresh" onClick={() => onRefreshTab(tab.id)} aria-label={`Refresh ${tab.title} context`}>
                              <RefreshCw size={12} />
                            </button>
                          ) : null}
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
                {workspace.visualSelection ? (
                  <div className="context-preview visual-selection-card">
                    <div className="context-card-heading"><strong>Selected localhost UI</strong><button type="button" onClick={onClearVisualSelection} aria-label="Clear visual selection"><X size={13} /></button></div>
                    <span className="context-source">{workspace.visualSelection.selector}</span>
                    <img src={workspace.visualSelection.screenshotDataUrl} alt="Captured localhost element" />
                    <pre>{workspace.visualSelection.html}</pre>
                    <span className="context-note">{Math.round(workspace.visualSelection.boundingBox.width)} × {Math.round(workspace.visualSelection.boundingBox.height)} px captured.</span>
                  </div>
                ) : null}
              </section>
              <section className="workspace-section">
                <div className="section-heading">
                  <span>Documents</span>
                  <button type="button" onClick={() => { void onWorkspaceCommand({ type: 'chooseDocuments' }); }}><FilePlus2 size={14} /> Add</button>
                </div>
                <div className="selection-list">
                  {workspace.documents.length === 0 ? <span className="section-empty">No documents added.</span> : null}
                  {workspace.documents.map((document) => (
                    <div key={document.id}>
                      <div className="document-row">
                        <label className="selection-row">
                          <input
                            type="checkbox"
                            checked={document.selected}
                            onChange={(event) => { void onWorkspaceCommand({ type: 'setDocumentSelected', documentId: document.id, selected: event.target.checked }); }}
                          />
                          <FileText size={14} />
                          <span>{document.name}</span>
                        </label>
                        <span />
                        <button type="button" onClick={() => { void onWorkspaceCommand({ type: 'removeDocument', documentId: document.id }); }} aria-label={`Remove ${document.name}`}><X size={13} /></button>
                      </div>
                      {document.selected ? (
                        <div className="context-preview">
                          <pre>{document.capturedText ?? '(File metadata only; this format is not read as text.)'}</pre>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
              <ProjectSection project={workspace.project} onCommand={onWorkspaceCommand} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CreateWorkspaceForm({ onCreate }: { onCreate: (name: string) => Promise<string | null> }) {
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
  return (
    <form className="workspace-create" onSubmit={(event) => { void submit(event); }}>
      <p>Create a workspace once. Context selection then lives in this chip.</p>
      <label htmlFor="context-workspace-name">Workspace name</label>
      <input id="context-workspace-name" value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setError(''); }} autoFocus />
      {error ? <span className="form-error" role="alert">{error}</span> : null}
      <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Creating…' : 'Create workspace'}</button>
    </form>
  );
}
