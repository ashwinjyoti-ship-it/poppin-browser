import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { WorkspaceProjectSnapshot } from '../../shared/workspace';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;

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

  async clone(remote: string, parentDirectory: string): Promise<WorkspaceProjectSnapshot> {
    const normalizedRemote = remote.trim();
    if (!isSupportedRemote(normalizedRemote)) {
      throw new Error('Use an HTTPS, SSH, or GitHub-style Git remote.');
    }
    const folderName = repositoryName(normalizedRemote);
    const destination = path.join(parentDirectory, folderName);
    if (await exists(destination)) throw new Error(`A folder named ${folderName} already exists there.`);
    await this.run(['clone', '--', normalizedRemote, destination]);
    return this.inspect(destination);
  }

  async create(repositoryPath: string): Promise<WorkspaceProjectSnapshot> {
    await this.run(['-C', repositoryPath, 'init', '-b', 'main']);
    return this.inspect(repositoryPath);
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

function repositoryName(remote: string): string {
  const name = remote.replace(/[\\/]$/, '').split(/[/:]/).pop()?.replace(/\.git$/i, '') ?? '';
  if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error('Poppin could not determine the repository folder name.');
  return name;
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
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
