/**
 * Classifies free-form "Add project" input as a Git remote or a local folder.
 * Keep this pure so the renderer and main process share one contract.
 */

export type ProjectSource =
  | { kind: 'remote'; remote: string }
  | { kind: 'local'; path: string };

export type ParsedProjectSource = ProjectSource | { kind: 'invalid'; message: string };

const REMOTE_PREFIX = /^(https?:\/\/|ssh:\/\/|git@)/i;
const GITHUB_SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;

export function parseProjectSource(raw: string): ParsedProjectSource {
  const value = raw.trim();
  if (!value) return { kind: 'invalid', message: 'Enter a local folder path or a Git repository URL.' };

  if (REMOTE_PREFIX.test(value)) {
    if (/\s/.test(value)) {
      return { kind: 'invalid', message: 'Use an HTTPS, SSH, or GitHub-style Git remote without spaces.' };
    }
    return { kind: 'remote', remote: value };
  }

  // owner/repo shorthand → GitHub HTTPS, but never treat absolute/relative paths as remotes.
  if (
    GITHUB_SHORTHAND.test(value)
    && !value.startsWith('.')
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
  ) {
    return { kind: 'remote', remote: `https://github.com/${value.replace(/\.git$/i, '')}.git` };
  }

  if (value.startsWith('-')) {
    return { kind: 'invalid', message: 'Use an HTTPS, SSH, or GitHub-style Git remote, or a local folder path.' };
  }

  return { kind: 'local', path: value };
}

export function isGitRemote(value: string): boolean {
  return parseProjectSource(value).kind === 'remote';
}

export function repositoryFolderName(remote: string): string {
  const name = remote.replace(/[\\/]$/, '').split(/[/:]/).pop()?.replace(/\.git$/i, '') ?? '';
  if (!/^[a-z0-9._-]+$/i.test(name)) {
    throw new Error('Poppin could not determine the repository folder name from that URL.');
  }
  return name;
}
