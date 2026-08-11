import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { AgentHarnessId } from '../../shared/agent';
import type { AcpLaunch } from './acp-connection';

/**
 * Resolves the ACP agent process for a harness.
 *
 * Poppin never bundles or auto-installs ACP adapters: a missing binary is
 * reported to the user rather than silently downloaded.
 */

const CODEX_ACP_BINARIES = [
  path.join(homedir(), '.local', 'bin', 'codex-acp'),
  path.join(homedir(), '.bun', 'bin', 'codex-acp'),
  '/opt/homebrew/bin/codex-acp',
  '/usr/local/bin/codex-acp',
] as const;

const CLAUDE_ACP_BINARIES = [
  path.join(homedir(), '.local', 'bin', 'claude-agent-acp'),
  path.join(homedir(), '.bun', 'bin', 'claude-agent-acp'),
  '/opt/homebrew/bin/claude-agent-acp',
  '/usr/local/bin/claude-agent-acp',
] as const;

const CURSOR_AGENT_BINARIES = [
  path.join(homedir(), '.local', 'bin', 'agent'),
  path.join(homedir(), '.cursor', 'bin', 'agent'),
  '/opt/homebrew/bin/agent',
  '/usr/local/bin/agent',
] as const;

export async function locateCodexAcp(): Promise<AcpLaunch | null> {
  return locateConfiguredOrBinary('POPPIN_ACP_AGENT_COMMAND', 'POPPIN_ACP_AGENT_ARGS', CODEX_ACP_BINARIES);
}

export async function locateClaudeAcp(): Promise<AcpLaunch | null> {
  return locateConfiguredOrBinary('POPPIN_CLAUDE_ACP_COMMAND', 'POPPIN_CLAUDE_ACP_ARGS', CLAUDE_ACP_BINARIES, {
    fallbackEnvCommand: 'POPPIN_ACP_AGENT_COMMAND',
    fallbackEnvArgs: 'POPPIN_ACP_AGENT_ARGS',
  });
}

/**
 * Cursor Agent speaks ACP via `agent acp` (Cursor CLI).
 * Override with POPPIN_CURSOR_ACP_COMMAND / POPPIN_CURSOR_ACP_ARGS.
 */
export async function locateCursorAcp(): Promise<AcpLaunch | null> {
  const configured = process.env.POPPIN_CURSOR_ACP_COMMAND?.trim();
  if (configured) {
    return { executable: configured, args: parseArgs(process.env.POPPIN_CURSOR_ACP_ARGS) };
  }
  for (const executable of CURSOR_AGENT_BINARIES) {
    if (await isExecutable(executable)) return { executable, args: ['acp'] };
  }
  return null;
}

export async function locateAcpHarness(id: AgentHarnessId): Promise<AcpLaunch | null> {
  if (id === 'claude-code') return locateClaudeAcp();
  if (id === 'cursor-acp') return locateCursorAcp();
  if (id === 'codex-acp') return locateCodexAcp();
  return null;
}

export function parseArgs(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/u).filter(Boolean);
}

async function locateConfiguredOrBinary(
  envCommand: string,
  envArgs: string,
  binaries: readonly string[],
  fallback?: { fallbackEnvCommand: string; fallbackEnvArgs: string },
): Promise<AcpLaunch | null> {
  const configured = process.env[envCommand]?.trim();
  if (configured) {
    return { executable: configured, args: parseArgs(process.env[envArgs]) };
  }
  if (fallback) {
    const shared = process.env[fallback.fallbackEnvCommand]?.trim();
    if (shared) {
      return { executable: shared, args: parseArgs(process.env[fallback.fallbackEnvArgs]) };
    }
  }
  for (const executable of binaries) {
    if (await isExecutable(executable)) return { executable, args: [] };
  }
  return null;
}

async function isExecutable(filePath: string): Promise<boolean> {
  return access(filePath, constants.X_OK).then(() => true, () => false);
}
