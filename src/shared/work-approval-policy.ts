import path from 'node:path';

export type WorkApprovalKind = 'command' | 'files' | 'permissions';

/**
 * Work-task approvals that stay inside Poppin's writable roots and are not
 * destructive can be allowed without a user prompt. Code tasks, network,
 * git, and destructive shell stay gated.
 */

const DESTRUCTIVE_COMMAND = /\b(?:sudo|doas|su|rm(?:dir)?|unlink|shred|dd|mkfs|diskutil|launchctl|chmod|chown|chflags|kill|pkill|killall|shutdown|reboot|git\s+(?:push|reset|rebase|clean|checkout|commit|stash)|npm\s+publish|osascript)\b/i;
const NETWORK_COMMAND = /\b(?:curl|wget|httpie|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp|pip3?\s+install|npm\s+install|yarn\s+add|pnpm\s+add|npx|bun\s+add|cargo\s+install|brew)\b/i;
const DESTRUCTIVE_FILE_KIND = /\bacpKind:(delete|move)\b/i;
const SYSTEM_PATH = /^(?:\/(?:usr|bin|sbin|opt\/homebrew|opt\/local|System|Library\/Developer|nix)(?:\/|$))/;
const PATH_KEYS = new Set([
  'path', 'filePath', 'filepath', 'grantRoot', 'cwd', 'destination', 'target',
  'targetPath', 'dir', 'directory', 'root', 'location', 'files', 'write', 'roots',
  'locations',
]);

export function pathIsInside(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function defaultCodexSkillsDirectory(homeDirectory: string): string {
  return path.join(homeDirectory, '.codex', 'skills');
}

export function workWritableRoots(taskOutputDirectory: string, homeDirectory: string): string[] {
  return [path.resolve(taskOutputDirectory), path.resolve(defaultCodexSkillsDirectory(homeDirectory))];
}

export function isDestructiveWorkCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND.test(command) || NETWORK_COMMAND.test(command);
}

export function isSafeWorkFileGrant(detail: string, allowedRoots: readonly string[]): boolean {
  if (DESTRUCTIVE_FILE_KIND.test(detail)) return false;
  const targets = fileGrantTargets(detail);
  if (targets.length === 0) return false;
  return targets.every((candidate) => allowedRoots.some((root) => pathIsInside(root, candidate)));
}

export function isSafeWorkCommand(command: string, cwd: string | null, allowedRoots: readonly string[]): boolean {
  const text = command.trim();
  if (!text || isDestructiveWorkCommand(text)) return false;
  const userPaths = commandUserPaths(text);
  if (userPaths.some((candidate) => !allowedRoots.some((root) => pathIsInside(root, candidate)))) {
    return false;
  }
  if (cwd && allowedRoots.some((root) => pathIsInside(root, cwd))) return true;
  return userPaths.length > 0 && userPaths.every((candidate) => allowedRoots.some((root) => pathIsInside(root, candidate)));
}

export function isSafeWorkPermission(detail: string, allowedRoots: readonly string[]): boolean {
  try {
    const parsed = JSON.parse(stripAcpKind(detail)) as Record<string, unknown>;
    if (networkEnabled(parsed.network)) return false;
    const fileSystem = parsed.fileSystem ?? parsed.filesystem;
    if (fileSystem == null) return true;
    if (typeof fileSystem !== 'object') return false;
    const paths = collectPermissionPaths(fileSystem);
    if (paths.length === 0) return true;
    return paths.every((candidate) => allowedRoots.some((root) => pathIsInside(root, candidate)));
  } catch {
    return allowedRoots.some((root) => pathIsInside(root, detail));
  }
}

export function shouldAutoAcceptWorkApproval(
  kind: WorkApprovalKind,
  detail: string,
  allowedRoots: readonly string[],
): boolean {
  if (kind === 'files') return isSafeWorkFileGrant(detail, allowedRoots);
  if (kind === 'command') {
    const parsed = parseCommandApproval(detail);
    return isSafeWorkCommand(parsed.command, parsed.cwd, allowedRoots);
  }
  if (kind === 'permissions') return isSafeWorkPermission(detail, allowedRoots);
  return false;
}

function parseCommandApproval(detail: string): { command: string; cwd: string | null } {
  const stripped = stripAcpKind(detail).trim();
  const asJson = tryParseObject(stripped);
  if (typeof asJson?.command === 'string') {
    return { command: asJson.command, cwd: typeof asJson.cwd === 'string' ? asJson.cwd : null };
  }
  const lines = stripped.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { command: '', cwd: null };
  if (lines.length === 1) return { command: lines[0]!, cwd: null };
  return { command: lines[0]!, cwd: lines[1]! };
}

function fileGrantTargets(detail: string): string[] {
  const stripped = stripAcpKind(detail).trim();
  const fromJson = tryParseObject(stripped);
  const collected = fromJson ? collectPathValues(fromJson) : [];
  const fromText = absolutePathsInText(stripped).filter((candidate) => !isSystemPath(candidate));
  const unique = uniquePaths([...collected, ...fromText]);
  if (unique.length > 0) return unique;
  const first = stripped.split('\n')[0]?.trim() ?? '';
  return first.startsWith('/') ? [path.resolve(first)] : [];
}

function commandUserPaths(command: string): string[] {
  return absolutePathsInText(command).filter((candidate) => !isSystemPath(candidate));
}

function stripAcpKind(detail: string): string {
  return detail.replace(/^\s*acpKind:\w+\s*/i, '').trim();
}

function tryParseObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function collectPathValues(value: unknown): string[] {
  const paths: string[] = [];
  collectPathValuesInto(value, paths, true);
  return uniquePaths(paths.filter((candidate) => !isSystemPath(candidate)));
}

function collectPathValuesInto(value: unknown, into: string[], root: boolean): void {
  if (typeof value === 'string') {
    if (looksLikeFsPath(value)) into.push(value.replace(/^file:\/\//, ''));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathValuesInto(item, into, false);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (root === false || PATH_KEYS.has(key) || /path|dir|root|file/i.test(key)) {
      collectPathValuesInto(child, into, false);
    }
  }
}

function looksLikeFsPath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(value);
}

function absolutePathsInText(text: string): string[] {
  const matches = [...text.matchAll(/(?:^|[\s"'=`])(\/(?:[\w.@%+-]+\/)*[\w.@%+-]+)/g)];
  return uniquePaths(matches.map((match) => match[1]!));
}

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const resolved = path.resolve(value);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

function isSystemPath(candidate: string): boolean {
  return SYSTEM_PATH.test(path.resolve(candidate));
}

function networkEnabled(network: unknown): boolean {
  if (network === true) return true;
  if (!network || typeof network !== 'object') return false;
  return (network as { enabled?: unknown }).enabled === true;
}

function collectPermissionPaths(fileSystem: object): string[] {
  const values = Object.values(fileSystem as Record<string, unknown>);
  const paths: string[] = [];
  for (const value of values) {
    if (typeof value === 'string') paths.push(value);
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string') paths.push(item);
    }
  }
  return paths;
}
