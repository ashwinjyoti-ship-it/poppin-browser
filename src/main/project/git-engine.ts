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

  private async run(args: string[], allowFailure = false): Promise<string> {
    try {
      const result = await execFileAsync('git', args, {
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS,
      });
      return result.stdout.trim();
    } catch (error) {
      if (allowFailure) return '';
      const stderr = isExecError(error) ? error.stderr.trim() : '';
      throw new Error(stderr || 'Git could not complete that operation.');
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
