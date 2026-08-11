import type { TaskDeliverySnapshot } from './task';

export type DeliveryStoryStageId = 'commit' | 'push' | 'pr' | 'merge' | 'local';

export type DeliveryStoryStageStatus = 'pending' | 'current' | 'done';

export interface DeliveryStoryStage {
  id: DeliveryStoryStageId;
  label: string;
  status: DeliveryStoryStageStatus;
  detail: string;
}

/**
 * Maps the existing gated delivery snapshot onto a quiet commit→…→local
 * story strip. Forms and approvals stay elsewhere; this is presentation only.
 */
export function buildDeliveryStory(delivery: TaskDeliverySnapshot | undefined | null): DeliveryStoryStage[] {
  const pullRequest = delivery?.pullRequest ?? null;
  const merged = Boolean(pullRequest && /^merged$/i.test(pullRequest.state));
  const commitDone = Boolean(delivery?.commit);
  const pushDone = Boolean(delivery?.pushed);
  const prDone = Boolean(pullRequest);
  const mergeDone = merged;
  const localDone = Boolean(delivery?.localUpdated);

  const stages: Array<{ id: DeliveryStoryStageId; label: string; done: boolean; detail: string }> = [
    {
      id: 'commit',
      label: 'Commit',
      done: commitDone,
      detail: commitDone
        ? `${delivery!.branch} · ${delivery!.commit.slice(0, 7)}`
        : 'Prepare a reviewed commit',
    },
    {
      id: 'push',
      label: 'Push',
      done: pushDone,
      detail: pushDone ? 'Branch on remote' : commitDone ? 'Review push' : 'Waiting on commit',
    },
    {
      id: 'pr',
      label: 'Pull request',
      done: prDone,
      detail: pullRequest
        ? `PR #${pullRequest.number} · ${pullRequest.state}`
        : pushDone ? 'Create pull request' : 'Waiting on push',
    },
    {
      id: 'merge',
      label: 'Merge',
      done: mergeDone,
      detail: mergeDone
        ? 'Merged'
        : prDone ? `${pullRequest!.checks} · ${pullRequest!.review}` : 'Waiting on PR',
    },
    {
      id: 'local',
      label: 'Local',
      done: localDone,
      detail: localDone
        ? `Local ${pullRequest?.base ?? 'base'} up to date`
        : mergeDone ? 'Update local folder' : 'Waiting on merge',
    },
  ];

  let foundCurrent = false;
  return stages.map((stage) => {
    if (stage.done) return { id: stage.id, label: stage.label, status: 'done' as const, detail: stage.detail };
    if (!foundCurrent) {
      foundCurrent = true;
      return { id: stage.id, label: stage.label, status: 'current' as const, detail: stage.detail };
    }
    return { id: stage.id, label: stage.label, status: 'pending' as const, detail: stage.detail };
  });
}
