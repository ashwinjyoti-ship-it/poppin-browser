// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { GitHubEngine } from '../src/main/project/github-engine';

describe('GitHubEngine', () => {
  it('uses argument arrays for push, PR creation, status, and merge without tokens', async () => {
    const runner = vi.fn(async (file: string, args: string[]) => {
      if (file === 'gh' && args[1] === 'create') return { stdout: 'https://github.com/acme/poppin/pull/42\n', stderr: '' };
      if (file === 'gh' && args[1] === 'view') return { stdout: JSON.stringify({ number: 42, url: 'https://github.com/acme/poppin/pull/42', baseRefName: 'main', headRefName: 'codex/task', state: 'OPEN', statusCheckRollup: [{ conclusion: 'SUCCESS' }], reviewDecision: 'APPROVED' }), stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const engine = new GitHubEngine(runner);
    await engine.push('/repo', 'origin', 'codex/task');
    const created = await engine.createPullRequest('/repo', 'main', 'codex/task', 'Title', 'Body');
    expect(created).toMatchObject({ number: 42, checks: '1/1 checks passing', review: 'APPROVED' });
    await engine.mergePullRequest('/repo', 42, 'squash');
    expect(runner).toHaveBeenCalledWith('git', ['push', '--set-upstream', 'origin', 'codex/task'], { cwd: '/repo' });
    expect(runner).toHaveBeenCalledWith('gh', ['pr', 'merge', '42', '--squash'], { cwd: '/repo' });
    expect(JSON.stringify(runner.mock.calls)).not.toMatch(/token|authorization/i);
  });

  it('rejects unsafe branch names before execution', async () => {
    const runner = vi.fn();
    const engine = new GitHubEngine(runner);
    await expect(engine.push('/repo', 'origin', '../main')).rejects.toThrow(/valid Git branch/i);
    expect(runner).not.toHaveBeenCalled();
  });
});
