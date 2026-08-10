import { Check, X } from 'lucide-react';

import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import type { BrowserAgentCommand, BrowserAgentCommandResult, BrowserAgentSnapshot } from '../../shared/browser-agent';

interface AgentDockProps {
  taskSnapshot: TaskSnapshot;
  browserAgentSnapshot?: BrowserAgentSnapshot;
  onTaskCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onBrowserAgentCommand?: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult>;
  /** Brings the task tab into view — the dock's "show me everything" escape hatch. */
  onOpenTaskTab: () => void;
}

/**
 * The one thing that must reach the user regardless of which tab is active.
 * Everything else about a task lives in its tab; the dock only surfaces what
 * cannot wait: approvals and questions on any surface, plus controls/status
 * while an Agent Tab is active. It renders in Poppin's own reserved chrome —
 * a WebContentsView tab paints above ordinary DOM content, so a floating div
 * would be hidden behind an active browsing tab.
 */
export function AgentDock({ taskSnapshot, browserAgentSnapshot, onTaskCommand, onBrowserAgentCommand, onOpenTaskTab }: AgentDockProps) {
  const task = taskSnapshot.task;
  if (!task) return null;

  if (task.pendingApproval?.kind === 'question') {
    return (
      <div className="agent-dock agent-dock-card" role="status">
        <p>{task.pendingApproval.title}</p>
        <button type="button" className="dock-btn dock-btn-primary" onClick={onOpenTaskTab}>Open task tab</button>
      </div>
    );
  }

  if (task.pendingApproval) {
    const { pendingApproval } = task;
    return (
      <div className="agent-dock agent-dock-card" role="status">
        <p>{pendingApproval.title}</p>
        <div className="dock-actions">
          <button type="button" className="dock-btn dock-btn-primary" onClick={() => { void onTaskCommand({ type: 'respondApproval', decision: 'accept' }); }}><Check size={12} /> {pendingApproval.kind === 'git' || pendingApproval.kind === 'github' ? 'Approve' : 'Allow'}</button>
          <button type="button" className="dock-btn" onClick={() => { void onTaskCommand({ type: 'respondApproval', decision: 'decline' }); }}><X size={12} /> Decline</button>
        </div>
      </div>
    );
  }

  if (browserAgentSnapshot?.pendingApproval && onBrowserAgentCommand) {
    const { pendingApproval } = browserAgentSnapshot;
    return (
      <div className="agent-dock agent-dock-card" role="status">
        <p>{pendingApproval.target}</p>
        <p className="dock-detail">{pendingApproval.consequence}</p>
        <div className="dock-actions">
          <button type="button" className="dock-btn dock-btn-primary" onClick={() => { void onBrowserAgentCommand({ type: 'respondApproval', decision: 'approve' }); }}><Check size={12} /> Approve</button>
          <button type="button" className="dock-btn" onClick={() => { void onBrowserAgentCommand({ type: 'respondApproval', decision: 'reject' }); }}><X size={12} /> Reject</button>
        </div>
      </div>
    );
  }

  if (browserAgentSnapshot?.taskSpace?.status === 'user-controlling' && onBrowserAgentCommand) {
    return (
      <div className="agent-dock agent-dock-card" role="status">
        <p>You're in control of the agent's tab.</p>
        <button type="button" className="dock-btn dock-btn-primary" onClick={() => { void onBrowserAgentCommand({ type: 'resume' }); }}>Resume agent</button>
      </div>
    );
  }

  if (browserAgentSnapshot?.taskSpace && ['completed', 'stopped'].includes(browserAgentSnapshot.state) && onBrowserAgentCommand) {
    return (
      <div className="agent-dock agent-dock-card" role="status">
        <p>{browserAgentSnapshot.state === 'completed' ? 'Browsing finished.' : 'Browsing stopped.'}</p>
        <div className="dock-actions">
          <button type="button" className="dock-btn dock-btn-primary" onClick={() => { void onBrowserAgentCommand({ type: 'closeTaskTabs' }); }}>Close task tabs</button>
          <button type="button" className="dock-btn" onClick={() => { void onBrowserAgentCommand({ type: 'keepTabs' }); }}>Keep tabs</button>
        </div>
      </div>
    );
  }

  if (task.state === 'Running') {
    return (
      <button type="button" className="agent-dock agent-dock-pill" onClick={onOpenTaskTab}>
        <span className="agent-dock-dot" aria-hidden="true" />
        {browserAgentSnapshot?.currentAction ?? (task.kind === 'code' ? 'Codex is working…' : 'The agent is working…')}
      </button>
    );
  }

  return null;
}
