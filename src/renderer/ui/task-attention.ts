import type { BrowserAgentSnapshot } from '../../shared/browser-agent';
import type { TaskSnapshot } from '../../shared/task';

export function taskAttentionKey(snapshot: TaskSnapshot): string | null {
  const task = snapshot.task;
  if (task?.pendingApproval) return `approval:${String(task.pendingApproval.requestId)}`;
  if (task?.state === 'Failed') return `failure:${task.updatedAt}`;
  return null;
}

export function browserApprovalAttentionKey(snapshot: BrowserAgentSnapshot): string | null {
  return snapshot.pendingApproval ? `browser:${snapshot.pendingApproval.actionId}` : null;
}
