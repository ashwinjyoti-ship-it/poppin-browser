import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FileText, Globe2, RefreshCw, RotateCcw, X } from 'lucide-react';

import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import type { WorkspaceSnapshot } from '../../shared/workspace';

interface ContextPaneProps {
  collapsed: boolean;
  snapshot: WorkspaceSnapshot;
  taskSnapshot: TaskSnapshot;
  onCollapseChange: (collapsed: boolean) => void;
  onRefreshTab: (tabId: string) => void;
  onTaskCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
}

type PaneSection = 'context' | 'task' | 'result';

export function ContextPane({ collapsed, snapshot, taskSnapshot, onCollapseChange, onRefreshTab, onTaskCommand }: ContextPaneProps) {
  const [section, setSection] = useState<PaneSection>('context');
  const selectedDocuments = snapshot.documents.filter((document) => document.selected);
  const itemCount = snapshot.tabContexts.length + selectedDocuments.length;

  if (collapsed) {
    return (
      <aside className="side-rail side-rail-right" aria-label="Right pane collapsed">
        <button type="button" className="pane-toggle" onClick={() => onCollapseChange(false)} aria-label="Open context and task pane"><ChevronLeft size={17} /></button>
        <span className="rail-count">{itemCount}</span>
        {taskSnapshot.task ? <span className={`rail-task-dot rail-task-${slug(taskSnapshot.task.state)}`} title={taskSnapshot.task.state} /> : null}
      </aside>
    );
  }

  return (
    <aside className="context-pane side-pane" aria-label="Context, task and result">
      <div className="right-pane-top">
        <nav className="right-pane-tabs" aria-label="Right pane sections">
          {(['context', 'task', 'result'] as const).map((value) => (
            <button key={value} type="button" className={section === value ? 'right-pane-tab-active' : ''} onClick={() => setSection(value)}>
              {titleCase(value)}
              {value === 'context' && itemCount > 0 ? <span>{itemCount}</span> : null}
              {value === 'task' && taskSnapshot.task?.state === 'Needs Approval' ? <i /> : null}
            </button>
          ))}
        </nav>
        <button type="button" className="pane-toggle" onClick={() => onCollapseChange(true)} aria-label="Collapse right pane"><ChevronRight size={17} /></button>
      </div>
      {section === 'context' ? <ContextView snapshot={snapshot} onRefreshTab={onRefreshTab} /> : null}
      {section === 'task' ? <TaskView snapshot={taskSnapshot} onCommand={onTaskCommand} /> : null}
      {section === 'result' ? <ResultView snapshot={taskSnapshot} onCommand={onTaskCommand} /> : null}
    </aside>
  );
}

function ContextView({ snapshot, onRefreshTab }: { snapshot: WorkspaceSnapshot; onRefreshTab: (tabId: string) => void }) {
  const documents = snapshot.documents.filter((document) => document.selected);
  const itemCount = snapshot.tabContexts.length + documents.length;
  return (
    <div className="right-pane-content">
      <div className="pane-heading"><div><span className="eyebrow">Context</span><h2>What Codex will see</h2></div></div>
      <p className="context-explainer">Only checked items appear here. Captured content is frozen until you refresh it.</p>
      <div className="context-list">
        {itemCount === 0 ? <div className="context-empty">Nothing selected. Check a tab or document in the workspace.</div> : null}
        {snapshot.tabContexts.map((context) => (
          <article className="context-card" key={context.tabId}>
            <div className="context-card-heading"><Globe2 size={14} /><strong>{context.title}</strong><button type="button" onClick={() => onRefreshTab(context.tabId)} aria-label={`Refresh ${context.title} context`}><RefreshCw size={13} /></button></div>
            <span className="context-source">{context.url}</span>
            <pre>{context.capturedText || '(No visible page text)'}</pre>
            {context.truncated ? <span className="context-note">Captured at the 60,000-character limit.</span> : null}
          </article>
        ))}
        {documents.map((document) => (
          <article className="context-card" key={document.id}>
            <div className="context-card-heading"><FileText size={14} /><strong>{document.name}</strong></div>
            <span className="context-source">{document.path}</span>
            <pre>{document.capturedText ?? '(File metadata only; this format is not read as text.)'}</pre>
            {document.truncated ? <span className="context-note">Captured at the 60,000-character limit.</span> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function TaskView({ snapshot, onCommand }: { snapshot: TaskSnapshot; onCommand: (command: TaskCommand) => Promise<TaskCommandResult> }) {
  const task = snapshot.task;
  return (
    <div className="right-pane-content task-view">
      <div className="pane-heading"><div><span className="eyebrow">Codex</span><h2>{task ? task.state : 'Ready for a task'}</h2></div><span className={`connection-pill connection-${snapshot.connection.state}`}>{snapshot.connection.state}</span></div>
      <p className="task-account">{snapshot.connection.accountLabel ?? snapshot.connection.message}</p>
      {snapshot.connection.state !== 'ready' ? <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'refreshConnection' }); }}>Reconnect Codex</button> : null}
      {task?.pendingApproval ? (
        <section className="approval-card" aria-label="Codex approval required">
          <span className="eyebrow">Approval required</span>
          <h3>{task.pendingApproval.title}</h3>
          {task.pendingApproval.reason ? <p>{task.pendingApproval.reason}</p> : null}
          <pre>{task.pendingApproval.detail}</pre>
          <div className="approval-actions">
            <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'respondApproval', decision: 'accept' }); }}><Check size={14} /> Allow once</button>
            <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'respondApproval', decision: 'decline' }); }}><X size={14} /> Decline</button>
          </div>
        </section>
      ) : null}
      {task ? (
        <div className="task-progress-list">
          {task.progress.map((item) => (
            <article key={item.id} className="task-progress-item"><i className={`progress-state progress-${item.status}`} /><div><strong>{item.title}</strong>{item.detail ? <pre>{item.detail}</pre> : null}</div></article>
          ))}
        </div>
      ) : <div className="context-empty">Connect a project, choose visible context, then describe one concrete change in the command bar.</div>}
      {task?.state === 'Running' || task?.pendingApproval ? <button type="button" className="task-cancel" onClick={() => { void onCommand({ type: 'cancelTask' }); }}>Cancel task</button> : null}
      {task?.error ? <p className="task-error">{task.error}</p> : null}
    </div>
  );
}

function ResultView({ snapshot, onCommand }: { snapshot: TaskSnapshot; onCommand: (command: TaskCommand) => Promise<TaskCommandResult> }) {
  const task = snapshot.task;
  const [revision, setRevision] = useState('');
  const [message, setMessage] = useState('');
  if (!task) return <div className="right-pane-content"><div className="context-empty">The Codex result and exact Git diff will appear here.</div></div>;
  const canReview = task.state === 'Needs Approval' && !task.pendingApproval;
  return (
    <div className="right-pane-content result-view">
      <div className="pane-heading"><div><span className="eyebrow">Result</span><h2>Review the change</h2></div><span className={`task-state task-state-${slug(task.state)}`}>{task.state}</span></div>
      <section className="result-section"><h3>Codex summary</h3><pre>{task.result || (task.state === 'Running' ? 'Codex is working…' : 'No summary was returned.')}</pre></section>
      <section className="result-section diff-section"><h3>Git diff</h3><pre>{task.diff || 'No project diff yet.'}</pre></section>
      {canReview ? (
        <div className="review-actions">
          <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'approveResult' }).then((result) => setMessage(result.message ?? 'Approved. The changes remain in your working tree.')); }}><Check size={14} /> Approve</button>
          <label><span>Or revise</span><textarea value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="Tell Codex what should change…" /></label>
          <button type="button" className="secondary-button" disabled={!revision.trim()} onClick={() => { void onCommand({ type: 'reviseTask', prompt: revision }).then((result) => { setMessage(result.message ?? 'Revision started.'); if (result.ok) setRevision(''); }); }}><RotateCcw size={14} /> Send revision</button>
        </div>
      ) : null}
      {message ? <p className="review-message">{message}</p> : null}
    </div>
  );
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-');
}
