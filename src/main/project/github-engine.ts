import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PullRequestStatus {
  number: number;
  url: string;
  base: string;
  head: string;
  state: string;
  checks: string;
  review: string;
}

type Runner = (file: string, args: string[], options: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

export class GitHubEngine {
  constructor(private readonly runner: Runner = defaultRunner) {}

  async push(repositoryPath: string, remote: string, branch: string): Promise<void> {
    validateRemoteName(remote);
    validateBranch(branch);
    await this.run('git', ['push', '--set-upstream', remote, branch], repositoryPath);
  }

  async createPullRequest(repositoryPath: string, base: string, head: string, title: string, body: string): Promise<PullRequestStatus> {
    validateBranch(base);
    validateBranch(head);
    const url = (await this.run('gh', ['pr', 'create', '--base', base, '--head', head, '--title', validateText(title, 'title', 240), '--body', validateText(body, 'body', 20_000)], repositoryPath)).trim();
    const number = pullRequestNumber(url);
    return this.viewPullRequest(repositoryPath, number);
  }

  async viewPullRequest(repositoryPath: string, number: number): Promise<PullRequestStatus> {
    const output = await this.run('gh', ['pr', 'view', String(validatePrNumber(number)), '--json', 'number,url,baseRefName,headRefName,state,statusCheckRollup,reviewDecision'], repositoryPath);
    const value = JSON.parse(output) as Record<string, unknown>;
    return {
      number: Number(value.number), url: String(value.url ?? ''), base: String(value.baseRefName ?? ''), head: String(value.headRefName ?? ''),
      state: String(value.state ?? 'UNKNOWN'), checks: summarizeChecks(value.statusCheckRollup), review: String(value.reviewDecision ?? 'REVIEW_REQUIRED'),
    };
  }

  async mergePullRequest(repositoryPath: string, number: number, strategy: 'merge' | 'squash' | 'rebase'): Promise<PullRequestStatus> {
    await this.run('gh', ['pr', 'merge', String(validatePrNumber(number)), `--${strategy}`], repositoryPath);
    return this.viewPullRequest(repositoryPath, number);
  }

  private async run(file: string, args: string[], cwd: string): Promise<string> {
    try {
      return (await this.runner(file, args, { cwd })).stdout.trim();
    } catch (error) {
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr: unknown }).stderr).trim() : '';
      throw new Error(stderr || `${file} could not complete the GitHub operation.`);
    }
  }
}

async function defaultRunner(file: string, args: string[], options: { cwd: string }): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, { ...options, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
}

function validateBranch(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value) || value.includes('..') || value.endsWith('/')) throw new Error('Use a valid Git branch name.');
  return value;
}

function validateRemoteName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value)) throw new Error('Use a valid Git remote name.');
  return value;
}

function validateText(value: string, label: string, maximum: number): string {
  const text = value.trim();
  if (!text || text.length > maximum) throw new Error(`Use a ${label} between 1 and ${maximum} characters.`);
  return text;
}

function validatePrNumber(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('The pull-request number is invalid.');
  return value;
}

function pullRequestNumber(url: string): number {
  const match = url.match(/\/pull\/(\d+)(?:\/?$)/);
  if (!match) throw new Error('GitHub did not return a pull-request URL.');
  return Number(match[1]);
}

function summarizeChecks(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'No checks reported';
  const states = value.map((item) => item && typeof item === 'object' && 'conclusion' in item ? String((item as { conclusion: unknown }).conclusion || 'PENDING') : 'PENDING');
  const passing = states.filter((state) => /success|neutral|skipped/i.test(state)).length;
  return `${passing}/${states.length} checks passing`;
}
