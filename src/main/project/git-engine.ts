import { execFile } from 'node:child_process';
import { access, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { repositoryFolderName } from '../../shared/project-source';
import type { WorkspaceProjectSnapshot } from '../../shared/workspace';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
const BASELINE_NAME = 'Poppin';
const BASELINE_EMAIL = 'poppin@localhost';

export class GitEngine {
  async inspect(repositoryPath: string): Promise<WorkspaceProjectSnapshot> {
    const root = await this.run(['-C', repositoryPath, 'rev-parse', '--show-toplevel']);
    const branch = await this.run(['-C', root, 'branch', '--show-current']);
    const remote = await this.run(['-C', root, 'remote', 'get-url', 'origin'], true);
    return {
      repositoryPath: root,
      remote: remote || null,
      branch: branch || 'detached HEAD',
      installCommand: '',
      devCommand: '',
      previewUrl: 'http://localhost:3000',
    };
  }

  async clone(remote: string, destination: string): Promise<WorkspaceProjectSnapshot> {
    const normalizedRemote = remote.trim();
    if (!isSupportedRemote(normalizedRemote)) {
      throw new Error('Use an HTTPS, SSH, or GitHub-style Git remote.');
    }
    if (await exists(destination)) {
      throw new Error(`A folder named ${path.basename(destination)} already exists there.`);
    }
    try {
      await this.run(['clone', '--', normalizedRemote, destination]);
    } catch (error) {
      throw new Error(describeCloneFailure(error, normalizedRemote));
    }
    return this.ensureUsableBaseline(destination);
  }

  async create(repositoryPath: string): Promise<WorkspaceProjectSnapshot> {
    await this.run(['-C', repositoryPath, 'init', '-b', 'main']);
    await this.writeInitialReadme(repositoryPath);
    await this.createInitialCommit(repositoryPath, 'Initial commit');
    return this.inspect(repositoryPath);
  }

  /**
   * Connect a local folder: existing Git repo, empty folder to initialize, or
   * an empty Git repo that still needs a Code-task baseline commit.
   */
  async openLocal(repositoryPath: string): Promise<WorkspaceProjectSnapshot> {
    if (await this.isGitRepository(repositoryPath)) {
      return this.ensureUsableBaseline(repositoryPath);
    }
    if (!(await isEmptyDirectory(repositoryPath))) {
      throw new Error('That folder is not a Git repository. Choose a Git checkout, or an empty folder to create a new project.');
    }
    return this.create(repositoryPath);
  }

  /** Ensures HEAD exists so Code tasks can take a trustworthy baseline. */
  async ensureUsableBaseline(repositoryPath: string): Promise<WorkspaceProjectSnapshot> {
    const project = await this.inspect(repositoryPath);
    if (await this.hasHead(repositoryPath)) return project;
    await this.writeInitialReadme(repositoryPath);
    await this.createInitialCommit(repositoryPath, 'Initial commit');
    return this.inspect(repositoryPath);
  }

  async hasHead(repositoryPath: string): Promise<boolean> {
    try {
      await this.getHead(repositoryPath);
      return true;
    } catch {
      return false;
    }
  }

  async isGitRepository(repositoryPath: string): Promise<boolean> {
    try {
      await this.run(['-C', repositoryPath, 'rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  async getHead(repositoryPath: string): Promise<string> {
    return this.run(['-C', repositoryPath, 'rev-parse', 'HEAD']);
  }

  async getWorkingTreeChanges(repositoryPath: string): Promise<string[]> {
    const output = await this.run([
      '-C', repositoryPath, 'status', '--porcelain=v1', '-z', '--untracked-files=all',
    ]);
    return output ? output.split('\0').filter(Boolean) : [];
  }

  async getDiff(repositoryPath: string, baselineHead: string): Promise<string> {
    if (!/^[0-9a-f]{40,64}$/i.test(baselineHead)) throw new Error('The task baseline is invalid.');
    const tracked = await this.run([
      '-C', repositoryPath, 'diff', '--no-ext-diff', '--no-color', '--find-renames', baselineHead, '--',
    ], false, 8 * 1024 * 1024);
    const untracked = await this.run([
      '-C', repositoryPath, 'ls-files', '--others', '--exclude-standard', '-z',
    ]);
    const names = untracked ? untracked.split('\0').filter(Boolean) : [];
    if (names.length === 0) return tracked;
    const untrackedDiffs: string[] = [];
    for (const name of names) {
      untrackedDiffs.push(await this.runDiff([
        '-C', repositoryPath, 'diff', '--no-index', '--binary', '--no-color', '--', '/dev/null', name,
      ]));
    }
    return [tracked, ...untrackedDiffs].filter(Boolean).join('\n\n');
  }

  async prepareCommit(repositoryPath: string, branch: string, message: string): Promise<{ branch: string; commit: string }> {
    const normalizedBranch = validateBranch(branch);
    const normalizedMessage = message.trim();
    if (!normalizedMessage || normalizedMessage.length > 240) throw new Error('Use a commit message between 1 and 240 characters.');
    const changes = await this.getWorkingTreeChanges(repositoryPath);
    if (changes.length === 0) throw new Error('There are no project changes to commit.');
    const currentBranch = await this.run(['-C', repositoryPath, 'branch', '--show-current']);
    if (currentBranch !== normalizedBranch) await this.run(['-C', repositoryPath, 'switch', '-c', normalizedBranch]);
    await this.run(['-C', repositoryPath, 'add', '--all', '--']);
    await this.run(['-C', repositoryPath, 'commit', '-m', normalizedMessage]);
    return { branch: normalizedBranch, commit: await this.getHead(repositoryPath) };
  }

  async listCommits(repositoryPath: string, baselineHead: string): Promise<string[]> {
    if (!/^[0-9a-f]{40,64}$/i.test(baselineHead)) throw new Error('The task baseline is invalid.');
    const output = await this.run(['-C', repositoryPath, 'log', '--format=%h %s', `${baselineHead}..HEAD`]);
    return output ? output.split('\n').filter(Boolean) : [];
  }

  /**
   * After a remote merge, check out the base branch and fast-forward it from the remote.
   * Refuses a dirty working tree so the update cannot discard local edits.
   */
  async updateLocalBase(repositoryPath: string, baseBranch: string, remote = 'origin'): Promise<WorkspaceProjectSnapshot> {
    const branch = validateBranch(baseBranch);
    const remoteName = validateRemoteName(remote);
    const changes = await this.getWorkingTreeChanges(repositoryPath);
    if (changes.length > 0) {
      throw new Error('Commit or stash local changes before updating the base branch.');
    }
    await this.run(['-C', repositoryPath, 'fetch', '--', remoteName, branch]);
    const current = await this.run(['-C', repositoryPath, 'branch', '--show-current']);
    if (current !== branch) {
      try {
        await this.run(['-C', repositoryPath, 'switch', '--', branch]);
      } catch {
        await this.run(['-C', repositoryPath, 'switch', '-c', branch, '--track', `${remoteName}/${branch}`]);
      }
    }
    await this.run(['-C', repositoryPath, 'pull', '--ff-only', '--', remoteName, branch]);
    return this.inspect(repositoryPath);
  }

  suggestedCloneDestination(parentDirectory: string, remote: string): string {
    return path.join(parentDirectory, repositoryFolderName(remote));
  }

  private async createInitialCommit(repositoryPath: string, message: string): Promise<void> {
    await this.run(['-C', repositoryPath, 'add', '--all', '--']);
    await this.run([
      '-C', repositoryPath,
      '-c', `user.name=${BASELINE_NAME}`,
      '-c', `user.email=${BASELINE_EMAIL}`,
      'commit', '--allow-empty', '-m', message,
    ]);
  }

  private async writeInitialReadme(repositoryPath: string): Promise<void> {
    const readme = path.join(repositoryPath, 'README.md');
    if (await exists(readme)) return;
    const title = path.basename(repositoryPath) || 'Project';
    await writeFile(readme, `# ${title}\n\nCreated with Poppin Browser.\n`, 'utf8');
  }

  private async run(args: string[], allowFailure = false, maxBuffer = 2 * 1024 * 1024): Promise<string> {
    try {
      const result = await execFileAsync('git', args, {
        encoding: 'utf8',
        maxBuffer,
        timeout: GIT_TIMEOUT_MS,
      });
      return result.stdout.trim();
    } catch (error) {
      if (allowFailure) return '';
      const stderr = isExecError(error) ? error.stderr.trim() : '';
      throw new Error(stderr || 'Git could not complete that operation.');
    }
  }

  private async runDiff(args: string[]): Promise<string> {
    try {
      const result = await execFileAsync('git', args, {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS,
      });
      return result.stdout.trim();
    } catch (error) {
      if (isDiffOutput(error)) return error.stdout.trim();
      const stderr = isExecError(error) ? error.stderr.trim() : '';
      throw new Error(stderr || 'Git could not build the task diff.');
    }
  }
}

function isSupportedRemote(remote: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(remote);
}

function validateBranch(value: string): string {
  const branch = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch) || branch.includes('..') || branch.endsWith('/')) {
    throw new Error('Use a valid Git branch name.');
  }
  return branch;
}

function validateRemoteName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value)) throw new Error('Use a valid Git remote name.');
  return value;
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

async function isEmptyDirectory(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory);
    return entries.length === 0;
  } catch {
    return false;
  }
}

function describeCloneFailure(error: unknown, remote: string): string {
  const stderr = (isExecError(error) ? error.stderr : error instanceof Error ? error.message : '').toLowerCase();
  if (/authentication failed|could not read username|invalid username or password|permission denied \(publickey\)|terminal prompts disabled|error: http.?401|error: http.?403/.test(stderr)) {
    return `Git could not authenticate to ${remote}. Sign in with the gh CLI or SSH keys, then try again.`;
  }
  if (/could not resolve host|nodename nor servname|name or service not known|network is unreachable|timed out|ssl|tls/.test(stderr)) {
    return `Git could not reach ${remote}. Check the URL and your network connection.`;
  }
  if (/repository not found|not found/.test(stderr)) {
    return `Git could not find ${remote}. Check the URL and that you have access.`;
  }
  if (/already exists/.test(stderr)) {
    return 'That destination folder already exists.';
  }
  const detail = isExecError(error) ? error.stderr.trim() : error instanceof Error ? error.message : '';
  return detail || 'Git could not clone that repository.';
}

function isExecError(error: unknown): error is { stderr: string } {
  return Boolean(error && typeof error === 'object' && 'stderr' in error && typeof (error as { stderr: unknown }).stderr === 'string');
}

function isDiffOutput(error: unknown): error is { code: number; stdout: string } {
  return Boolean(
    error && typeof error === 'object'
    && 'code' in error && (error as { code: unknown }).code === 1
    && 'stdout' in error && typeof (error as { stdout: unknown }).stdout === 'string',
  );
}
