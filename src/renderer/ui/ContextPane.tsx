import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, Globe2, RefreshCw, RotateCcw, X } from 'lucide-react';

import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import type { WorkspaceSnapshot } from '../../shared/workspace';
import type { BrowserAgentCommand, BrowserAgentCommandResult, BrowserAgentSnapshot } from '../../shared/browser-agent';
import type { BrowserTabSnapshot } from '../../shared/browser';
import type { WorkspaceCommandResult } from '../../shared/workspace';

interface ContextPaneProps {
  collapsed: boolean;
  snapshot: WorkspaceSnapshot;
  taskSnapshot: TaskSnapshot;
  onCollapseChange: (collapsed: boolean) => void;
  onRefreshTab: (tabId: string) => void;
  onTaskCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onOpenResult: () => void;
  section?: PaneSection;
  onSectionChange?: (section: PaneSection) => void;
  browserAgentSnapshot?: BrowserAgentSnapshot;
  onBrowserAgentCommand?: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult>;
  activeTab?: BrowserTabSnapshot | null;
  onCaptureVisualSelection?: (tabId: string) => Promise<WorkspaceCommandResult>;
  onClearVisualSelection?: () => void;
}

export type PaneSection = 'context' | 'task' | 'result';

export function ContextPane({ collapsed, snapshot, taskSnapshot, onCollapseChange, onRefreshTab, onTaskCommand, onOpenResult, section, onSectionChange, browserAgentSnapshot, onBrowserAgentCommand, activeTab, onCaptureVisualSelection, onClearVisualSelection }: ContextPaneProps) {
  const [internalSection, setInternalSection] = useState<PaneSection>('context');
  const activeSection = section ?? internalSection;
  const selectedDocuments = snapshot.documents.filter((document) => document.selected);
  const itemCount = snapshot.tabContexts.length + selectedDocuments.length + (snapshot.visualSelection ? 1 : 0);

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
            <button key={value} type="button" className={activeSection === value ? 'right-pane-tab-active' : ''} onClick={() => { setInternalSection(value); onSectionChange?.(value); }}>
              {titleCase(value)}
              {value === 'context' && itemCount > 0 ? <span>{itemCount}</span> : null}
              {value === 'task' && taskSnapshot.task?.state === 'Needs Approval' ? <i /> : null}
            </button>
          ))}
        </nav>
        <button type="button" className="pane-toggle" onClick={() => onCollapseChange(true)} aria-label="Collapse right pane"><ChevronRight size={17} /></button>
      </div>
      {activeSection === 'context' ? <ContextView snapshot={snapshot} activeTab={activeTab} onRefreshTab={onRefreshTab} onCaptureVisualSelection={onCaptureVisualSelection} onClearVisualSelection={onClearVisualSelection} /> : null}
      {activeSection === 'task' ? <TaskView snapshot={taskSnapshot} workspace={snapshot} browserAgent={browserAgentSnapshot} onCommand={onTaskCommand} onBrowserAgentCommand={onBrowserAgentCommand} /> : null}
      {activeSection === 'result' ? <ResultView snapshot={taskSnapshot} workspace={snapshot} onCommand={onTaskCommand} onOpenResult={onOpenResult} /> : null}
    </aside>
  );
}

function ContextView({ snapshot, activeTab, onRefreshTab, onCaptureVisualSelection, onClearVisualSelection }: {
  snapshot: WorkspaceSnapshot;
  activeTab?: BrowserTabSnapshot | null;
  onRefreshTab: (tabId: string) => void;
  onCaptureVisualSelection?: (tabId: string) => Promise<WorkspaceCommandResult>;
  onClearVisualSelection?: () => void;
}) {
  const [selectionMessage, setSelectionMessage] = useState('');
  const [selecting, setSelecting] = useState(false);
  const documents = snapshot.documents.filter((document) => document.selected);
  const itemCount = snapshot.tabContexts.length + documents.length + (snapshot.visualSelection ? 1 : 0);
  const activeIsLocalhost = Boolean(activeTab && /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(activeTab.url));
  const capture = async () => {
    if (!activeTab || !onCaptureVisualSelection) return;
    setSelecting(true);
    setSelectionMessage('Click an element in the visible localhost preview. Press Escape to cancel.');
    const result = await onCaptureVisualSelection(activeTab.id);
    setSelecting(false);
    setSelectionMessage(result.ok ? 'Element captured in explicit context.' : result.message ?? 'Selection was not captured.');
  };
  return (
    <div className="right-pane-content">
      <div className="pane-heading"><div><span className="eyebrow">Context</span><h2>What Codex will see</h2></div></div>
      <p className="context-explainer">Only checked items appear here. Captured content is frozen until you refresh it.</p>
      {activeIsLocalhost ? <div className="visual-selection-tools"><button type="button" className="secondary-button" disabled={selecting} onClick={() => { void capture(); }}>{selecting ? 'Pick an element…' : 'Select UI from preview'}</button>{selectionMessage ? <p>{selectionMessage}</p> : null}</div> : null}
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
        {snapshot.visualSelection ? (
          <article className="context-card visual-selection-card">
            <div className="context-card-heading"><strong>Selected localhost UI</strong><button type="button" onClick={onClearVisualSelection} aria-label="Clear visual selection"><X size={13} /></button></div>
            <span className="context-source">{snapshot.visualSelection.selector}</span>
            <img src={snapshot.visualSelection.screenshotDataUrl} alt="Captured localhost element" />
            <pre>{snapshot.visualSelection.html}</pre>
            <span className="context-note">{Math.round(snapshot.visualSelection.boundingBox.width)} × {Math.round(snapshot.visualSelection.boundingBox.height)} px · HTML, CSS, DOM context, and screenshot captured.</span>
          </article>
        ) : null}
      </div>
    </div>
  );
}

function TaskView({ snapshot, workspace, browserAgent, onCommand, onBrowserAgentCommand }: {
  snapshot: TaskSnapshot;
  workspace: WorkspaceSnapshot;
  browserAgent?: BrowserAgentSnapshot;
  onCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onBrowserAgentCommand?: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult>;
}) {
  const task = snapshot.task;
  const [questionAnswer, setQuestionAnswer] = useState('');
  const approvalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (typeof approvalRef.current?.scrollIntoView === 'function') approvalRef.current.scrollIntoView({ block: 'nearest' });
  }, [task?.pendingApproval]);
  return (
    <div className="right-pane-content task-view">
      <div className="pane-heading"><div><span className="eyebrow">Codex</span><h2>{task ? task.state : 'Ready for a task'}</h2></div><span className={`connection-pill connection-${snapshot.connection.state}`}>{snapshot.connection.state}</span></div>
      <p className="task-account">{snapshot.connection.accountLabel ?? snapshot.connection.message}</p>
      {snapshot.connection.state !== 'ready' ? <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'refreshConnection' }); }}>Reconnect Codex</button> : null}
      {task?.pendingApproval ? (
        <section ref={approvalRef} className="approval-card" aria-label="Codex approval required">
          <span className="eyebrow">Approval required</span>
          <h3>{task.pendingApproval.title}</h3>
          {task.pendingApproval.reason ? <p>{task.pendingApproval.reason}</p> : null}
          <pre>{task.pendingApproval.detail}</pre>
          {task.pendingApproval.kind === 'question' ? <div className="question-response"><textarea value={questionAnswer} onChange={(event) => setQuestionAnswer(event.target.value)} aria-label="Answer blocking question" placeholder="Type the missing detail…" /><button type="button" className="primary-button" disabled={!questionAnswer.trim()} onClick={() => { void onCommand({ type: 'respondQuestion', answer: questionAnswer }).then((result) => { if (result.ok) setQuestionAnswer(''); }); }}>Continue task</button></div> : <div className="approval-actions">
            <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'respondApproval', decision: 'accept' }); }}><Check size={14} /> {task.pendingApproval.kind === 'git' || task.pendingApproval.kind === 'github' ? 'Approve' : 'Allow once'}</button>
            <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'respondApproval', decision: 'decline' }); }}><X size={14} /> Decline</button>
          </div>}
        </section>
      ) : null}
      {browserAgent?.pendingApproval && onBrowserAgentCommand ? (
        <section ref={approvalRef} className="approval-card" aria-label="Browser action approval required">
          <span className="eyebrow">Browser approval required</span>
          <h3>{browserAgent.pendingApproval.title}</h3>
          <p><strong>Target:</strong> {browserAgent.pendingApproval.target}</p>
          <p><strong>Scope:</strong> {browserAgent.pendingApproval.scope}</p>
          <p><strong>Consequence:</strong> {browserAgent.pendingApproval.consequence}</p>
          <div className="approval-actions"><button type="button" className="primary-button" onClick={() => { void onBrowserAgentCommand({ type: 'respondApproval', decision: 'approve' }); }}><Check size={14} /> Approve</button><button type="button" className="secondary-button" onClick={() => { void onBrowserAgentCommand({ type: 'respondApproval', decision: 'reject' }); }}><X size={14} /> Reject</button></div>
        </section>
      ) : null}
      {task && onBrowserAgentCommand ? <BrowserUseView taskId={task.threadId || task.createdAt} workspace={workspace} snapshot={browserAgent} onCommand={onBrowserAgentCommand} /> : null}
      {task ? (
        <div className="task-progress-list">
          {task.progress.map((item) => (
            <article key={item.id} className="task-progress-item"><i className={`progress-state progress-${item.status}`} /><div><strong>{item.title}</strong>{item.detail ? <pre>{item.detail}</pre> : null}</div></article>
          ))}
        </div>
      ) : <div className="context-empty">Choose visible context, then ask for a summary, report, research, or a project change.</div>}
      {task?.state === 'Running' || task?.pendingApproval ? <button type="button" className="task-cancel" onClick={() => { void onCommand({ type: 'cancelTask' }); }}>Cancel task</button> : null}
      {task?.error ? <p className="task-error">{task.error}</p> : null}
    </div>
  );
}

function BrowserUseView({ taskId, workspace, snapshot, onCommand }: { taskId: string; workspace: WorkspaceSnapshot; snapshot?: BrowserAgentSnapshot; onCommand: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult> }) {
  const selectedTabs = workspace.tabContexts;
  const canStart = !snapshot || ['idle', 'stopped', 'completed'].includes(snapshot.state);
  return (
    <section className="browser-use-card" aria-label="Controlled browser use">
      <div className="browser-use-heading"><div><span className="eyebrow">Visible browser use</span><h3>{snapshot?.currentAction ?? titleCase(snapshot?.state ?? 'idle')}</h3></div><span className={`task-state browser-state-${snapshot?.state ?? 'idle'}`}>{snapshot?.state ?? 'idle'}</span></div>
      {canStart ? <button type="button" className="secondary-button" disabled={selectedTabs.length === 0} onClick={() => { void onCommand({ type: 'start', taskId, tabIds: selectedTabs.map((item) => item.tabId) }); }}>Start with {selectedTabs.length} selected tab{selectedTabs.length === 1 ? '' : 's'}</button> : null}
      {snapshot?.state === 'running' ? <div className="browser-controls"><button type="button" onClick={() => { void onCommand({ type: 'pause' }); }}>Pause</button><button type="button" onClick={() => { void onCommand({ type: 'takeOver' }); }}>Take Over</button><button type="button" onClick={() => { void onCommand({ type: 'stop' }); }}>Stop</button></div> : null}
      {snapshot?.state === 'paused' ? <div className="browser-controls"><button type="button" onClick={() => { void onCommand({ type: 'resume' }); }}>Resume</button><button type="button" onClick={() => { void onCommand({ type: 'stop' }); }}>Stop</button></div> : null}
      {snapshot?.state === 'running' ? selectedTabs.map((tab) => <div className="browser-tab-action" key={tab.tabId}><span>{tab.title}</span><button type="button" onClick={() => { void onCommand({ type: 'act', tabId: tab.tabId, action: /(?:youtube\.com|youtu\.be)/i.test(tab.url) ? { type: 'captureTranscript' } : { type: 'read' } }); }}>{/(?:youtube\.com|youtu\.be)/i.test(tab.url) ? 'Read transcript' : 'Read page'}</button></div>) : null}
      {snapshot?.log.length ? <ol className="browser-action-log">{snapshot.log.slice(-12).map((entry) => <li key={entry.id}><span>{entry.action}</span><small>{entry.outcome} · {entry.detail}</small></li>)}</ol> : null}
    </section>
  );
}

function ResultView({ snapshot, workspace, onCommand, onOpenResult }: { snapshot: TaskSnapshot; workspace: WorkspaceSnapshot; onCommand: (command: TaskCommand) => Promise<TaskCommandResult>; onOpenResult: () => void }) {
  const task = snapshot.task;
  const [revision, setRevision] = useState('');
  const [message, setMessage] = useState('');
  const [branch, setBranch] = useState(workspace.project?.branch ?? 'codex/poppin-task');
  const [commitMessage, setCommitMessage] = useState('feat: complete Poppin task');
  const [base, setBase] = useState('main');
  const [prTitle, setPrTitle] = useState(task?.prompt.slice(0, 120) ?? 'Poppin task');
  const [prBody, setPrBody] = useState('Completed and verified with Poppin Browser.');
  const [mergeStrategy, setMergeStrategy] = useState<'merge' | 'squash' | 'rebase'>('squash');
  if (!task) return <div className="right-pane-content"><div className="context-empty">The Codex result and exact Git diff will appear here.</div></div>;
  const canReview = task.state === 'Needs Approval' && !task.pendingApproval;
  return (
    <div className="right-pane-content result-view">
      <div className="pane-heading"><div><span className="eyebrow">{task.kind} result</span><h2>{task.kind === 'code' ? 'Review the change' : 'Review the output'}</h2></div><span className={`task-state task-state-${slug(task.state)}`}>{task.state}</span></div>
      {task.kind === 'code' ? <button type="button" className="secondary-button preview-button" onClick={() => { void onCommand({ type: 'openPreview' }).then((result) => setMessage(result.message ?? 'Preview opened in the centre browser.')); }}>Open localhost preview</button> : null}
      {task.result ? <div className="result-toolbar"><button type="button" className="secondary-button" onClick={onOpenResult}><ExternalLink size={13} /> Open result tab</button><button type="button" className="secondary-button" onClick={() => { void navigator.clipboard.writeText(task.result).then(() => setMessage('Copied result.')); }}><Copy size={13} /> Copy</button><button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'exportResult', format: 'markdown' }).then((result) => setMessage(result.message ?? 'Saved.')); }}>Save</button><button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'exportResult', format: 'text' }).then((result) => setMessage(result.message ?? 'Exported.')); }}>Export</button></div> : null}
      <section className="result-section"><h3>Codex summary</h3><pre>{task.result || (task.state === 'Running' ? 'Codex is working…' : 'No summary was returned.')}</pre></section>
      {task.kind === 'code' ? <section className="result-section diff-section"><h3>Git diff</h3><pre>{task.diff || 'No project diff yet.'}</pre></section> : null}
      {canReview ? (
        <div className="review-actions">
          <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'approveResult' }).then((result) => setMessage(result.message ?? 'Approved. The changes remain in your working tree.')); }}><Check size={14} /> Approve</button>
          <label><span>Or revise</span><textarea value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="Tell Codex what should change…" /></label>
          <button type="button" className="secondary-button" disabled={!revision.trim()} onClick={() => { void onCommand({ type: 'reviseTask', prompt: revision }).then((result) => { setMessage(result.message ?? 'Revision started.'); if (result.ok) setRevision(''); }); }}><RotateCcw size={14} /> Send revision</button>
        </div>
      ) : null}
      {message ? <p className="review-message">{message}</p> : null}
      {task.kind === 'code' && task.state === 'Completed' ? (
        <section className="delivery-card">
          <h3>GitHub delivery</h3>
          {!task.delivery?.commit ? <div className="delivery-form"><label>Branch<input value={branch} onChange={(event) => setBranch(event.target.value)} /></label><label>Commit message<input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} /></label><button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'prepareCommit', branch, message: commitMessage }).then((result) => setMessage(result.message ?? 'Commit prepared.')); }}>Prepare commit</button></div> : null}
          {task.delivery?.commit ? <div className="delivery-status"><p><strong>{task.delivery.branch}</strong> · {task.delivery.commit.slice(0, 7)}</p><p>{task.delivery.message}</p>{!task.delivery.pushed ? <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'requestPush' }).then((result) => setMessage(result.message ?? 'Review the push approval.')); }}>Review push</button> : null}</div> : null}
          {task.delivery?.pushed && !task.delivery.pullRequest ? <div className="delivery-form"><label>Base branch<input value={base} onChange={(event) => setBase(event.target.value)} /></label><label>PR title<input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} /></label><label>PR summary<textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} /></label><button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'requestPullRequest', base, title: prTitle, body: prBody }).then((result) => setMessage(result.message ?? 'Review the pull-request approval.')); }}>Create Pull Request</button></div> : null}
          {task.delivery?.pullRequest ? <div className="delivery-status"><p><strong>PR #{task.delivery.pullRequest.number}</strong> · {task.delivery.pullRequest.state}</p><p>{task.delivery.pullRequest.base} ← {task.delivery.pullRequest.head}</p><p>{task.delivery.pullRequest.checks} · {task.delivery.pullRequest.review}</p><div className="delivery-actions"><button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'refreshPullRequest' }).then((result) => setMessage(result.message ?? 'Pull request updated.')); }}>Refresh status</button><select aria-label="Merge strategy" value={mergeStrategy} onChange={(event) => setMergeStrategy(event.target.value as typeof mergeStrategy)}><option value="merge">Merge</option><option value="squash">Squash</option><option value="rebase">Rebase</option></select><button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'requestMerge', strategy: mergeStrategy }).then((result) => setMessage(result.message ?? 'Review the separate merge approval.')); }}>Review Merge</button></div></div> : null}
        </section>
      ) : null}
    </div>
  );
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-');
}
