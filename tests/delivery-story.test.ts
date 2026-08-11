import { describe, expect, it } from 'vitest';

import { buildDeliveryStory } from '../src/shared/delivery-story';

describe('buildDeliveryStory', () => {
  it('starts at commit when delivery is empty', () => {
    const stages = buildDeliveryStory(undefined);
    expect(stages.map((stage) => stage.status)).toEqual(['current', 'pending', 'pending', 'pending', 'pending']);
    expect(stages[0]?.id).toBe('commit');
  });

  it('advances through push, PR, merge, and local', () => {
    const afterCommit = buildDeliveryStory({
      branch: 'feat/x',
      commit: 'abcdef123456',
      remote: 'origin',
      pushed: false,
      pullRequest: null,
      message: 'Prepared',
    });
    expect(afterCommit.find((stage) => stage.id === 'commit')?.status).toBe('done');
    expect(afterCommit.find((stage) => stage.id === 'push')?.status).toBe('current');

    const afterMerge = buildDeliveryStory({
      branch: 'feat/x',
      commit: 'abcdef123456',
      remote: 'origin',
      pushed: true,
      pullRequest: {
        number: 12,
        url: 'https://example.com/pr/12',
        base: 'main',
        head: 'feat/x',
        state: 'MERGED',
        checks: 'passing',
        review: 'approved',
      },
      message: 'Merged',
    });
    expect(afterMerge.find((stage) => stage.id === 'merge')?.status).toBe('done');
    expect(afterMerge.find((stage) => stage.id === 'local')?.status).toBe('current');
  });
});
