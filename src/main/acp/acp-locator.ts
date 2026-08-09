import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { AcpLaunch } from './acp-connection';

/**
 * Resolves the ACP agent process for a harness.
 *
 * Codex ships its ACP adapter as `@agentclientprotocol/codex-acp` (a stdio ACP
 * server that drives the Codex app server underneath). Poppin never bundles or
 * auto-installs it: a missing adapter is reported to the user rather than
 * silently downloaded.
 */

const CODEX_ACP_BINARIES = [
  path.join(homedir(), '.local', 'bin', 'codex-acp'),
  path.join(homedir(), '.bun', 'bin', 'codex-acp'),
  '/opt/homebrew/bin/codex-acp',
  '/usr/local/bin/codex-acp',
] as const;

export async function locateCodexAcp(): Promise<AcpLaunch | null> {
  const configured = process.env.POPPIN_ACP_AGENT_COMMAND?.trim();
  if (configured) {
    return { executable: configured, args: parseArgs(process.env.POPPIN_ACP_AGENT_ARGS) };
  }
  for (const executable of CODEX_ACP_BINARIES) {
    if (await isExecutable(executable)) return { executable, args: [] };
  }
  return null;
}

export function parseArgs(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/u).filter(Boolean);
}

async function isExecutable(filePath: string): Promise<boolean> {
  return access(filePath, constants.X_OK).then(() => true, () => false);
}
