import type { BrowserAgentSnapshot } from '../../shared/browser-agent';
import type { TaskRecordSnapshot, TaskSnapshot } from '../../shared/task';

export type AgentDockPresentation = 'hidden' | 'pill' | 'card';
export type TaskTabStatus = 'working' | 'attention' | 'complete' | 'failed' | 'cancelled' | 'discarded';

interface AgentDockPresentationInput {
  taskSnapshot: TaskSnapshot;
  browserAgentSnapshot: BrowserAgentSnapshot;
  activeBrowserTaskSpaceId: string | null;
  taskTabActive: boolean;
  commandCollapsed: boolean;
}

/**
 * Reserves bottom chrome only when it belongs to the surface being viewed.
 * Blocking requests remain globally reachable; ordinary status and cleanup
 * controls are confined to an active Agent Tab.
 */
export function getAgentDockPresentation({
  taskSnapshot,
  browserAgentSnapshot,
  activeBrowserTaskSpaceId,
  taskTabActive,
  commandCollapsed,
}: AgentDockPresentationInput): AgentDockPresentation {
  const task = taskSnapshot.task;
  if (!task || commandCollapsed || taskTabActive) return 'hidden';
  if (task.pendingApproval || browserAgentSnapshot.pendingApproval) return 'card';

  const onActiveAgentTab = Boolean(
    browserAgentSnapshot.watching
      && activeBrowserTaskSpaceId
      && activeBrowserTaskSpaceId === browserAgentSnapshot.taskSpace?.id,
  );
  if (!onActiveAgentTab) return 'hidden';

  if (browserAgentSnapshot.taskSpace?.status === 'user-controlling') return 'card';
  if (browserAgentSnapshot.taskSpace && ['completed', 'stopped'].includes(browserAgentSnapshot.state)) return 'card';
  return task.state === 'Running' ? 'pill' : 'hidden';
}

export function getTaskTabStatus(task: TaskRecordSnapshot): TaskTabStatus {
  if (task.pendingApproval || task.state === 'Needs Approval') return 'attention';
  if (task.state === 'Running') return 'working';
  if (task.state === 'Completed') return 'complete';
  if (task.state === 'Failed') return 'failed';
  return task.state === 'Cancelled' ? 'cancelled' : 'discarded';
}
