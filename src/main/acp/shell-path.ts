import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * GUI apps launched from Finder/Dock/Spotlight (or an equivalent desktop
 * launcher on Linux) inherit a minimal `PATH` — none of the additions a
 * login shell profile makes (nvm, Homebrew, cargo, a custom npm prefix,
 * etc). Poppin needs the same `PATH` the user's terminal would use to find
 * ACP agent binaries installed through those tools, both to locate them and
 * to spawn them with an environment where they can find their own
 * dependencies. This asks a real login shell what its `PATH` is, once, and
 * caches the answer for the life of the process.
 */
let cachedShellPathDirs: Promise<string[]> | null = null;

export function shellPathDirs(): Promise<string[]> {
  if (!cachedShellPathDirs) cachedShellPathDirs = resolveShellPathDirs();
  return cachedShellPathDirs;
}

const PATH_START = '__poppin_path_start__';
const PATH_END = '__poppin_path_end__';

function resolveShellPathDirs(): Promise<string[]> {
  if (process.platform === 'win32') return Promise.resolve([]);
  const shell = process.env.SHELL?.trim() || '/bin/zsh';
  return new Promise((resolve) => {
    // Login shells (`-l`) can print MOTD/nvm/etc banners on stdout before
    // running the command, so the PATH is wrapped in markers to pull it out
    // of whatever else the shell decided to print.
    execFile(shell, ['-ilc', `echo "${PATH_START}$PATH${PATH_END}"`], { timeout: 8_000 }, (error, stdout) => {
      if (error || !stdout) {
        resolve([]);
        return;
      }
      const match = new RegExp(`${PATH_START}(.*)${PATH_END}`, 's').exec(stdout);
      resolve((match?.[1] ?? '').trim().split(':').filter(Boolean));
    });
  });
}

/** Merges `PATH`-like directory lists, de-duplicated, preferring earlier entries. */
export function mergePathDirs(...lists: string[][]): string[] {
  return [...new Set(lists.flat().filter(Boolean))];
}

let cachedVersionManagerDirs: Promise<string[]> | null = null;

/**
 * Bin directories for the most common Node version managers, found by
 * reading the filesystem directly rather than relying on a shell profile
 * having sourced them. This covers installs the login-shell PATH probe
 * above can miss — e.g. nvm's init line living in a startup file the shell
 * invocation flags used here don't happen to source.
 */
export function versionManagerBinDirs(): Promise<string[]> {
  if (!cachedVersionManagerDirs) cachedVersionManagerDirs = resolveVersionManagerBinDirs();
  return cachedVersionManagerDirs;
}

async function resolveVersionManagerBinDirs(): Promise<string[]> {
  const home = homedir();
  const dirs = [path.join(home, '.volta', 'bin'), path.join(home, '.asdf', 'shims')];
  const nvmNodeDir = path.join(home, '.nvm', 'versions', 'node');
  try {
    const entries = await readdir(nvmNodeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) dirs.push(path.join(nvmNodeDir, entry.name, 'bin'));
    }
  } catch {
    // nvm not installed, or no versions under it yet — nothing to add.
  }
  return dirs;
}
