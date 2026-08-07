import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

export interface CodexLaunch {
  executable: string;
  args: string[];
}

const CODEX_CANDIDATES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex',
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
] as const;

export async function locateCodex(): Promise<CodexLaunch | null> {
  const configured = process.env.POPPIN_CODEX_PATH?.trim();
  const candidates = configured ? [configured, ...CODEX_CANDIDATES] : [...CODEX_CANDIDATES];
  for (const executable of candidates) {
    if (await isExecutable(executable)) return { executable, args: ['app-server', '--stdio'] };
  }
  return null;
}

async function isExecutable(filePath: string): Promise<boolean> {
  return access(filePath, constants.X_OK).then(() => true, () => false);
}
