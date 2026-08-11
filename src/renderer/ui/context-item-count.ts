import type { TandemSnapshot } from '../../shared/tandem';
import type { WorkspaceSnapshot } from '../../shared/workspace';

/** Counts items currently checked into the Ask context package. */
export function contextItemCount(workspace: WorkspaceSnapshot, tandem: TandemSnapshot): number {
  return workspace.tabContexts.length
    + workspace.documents.filter((item) => item.selected).length
    + (workspace.memorySelected ? 1 : 0)
    + (workspace.visualSelection ? 1 : 0)
    + tandem.selected.length;
}
