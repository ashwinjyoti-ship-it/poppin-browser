import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Fallback localhost preview when the repo does not advertise a port. */
export const DEFAULT_PREVIEW_URL = 'http://localhost:3000';

export interface ProjectRuntimeSettings {
  installCommand: string;
  devCommand: string;
  previewUrl: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const DEV_SCRIPTS = ['dev', 'start', 'preview', 'serve'] as const;
type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

/**
 * Infer install/dev/preview from lockfiles and package.json so connecting a
 * folder is enough to use Code. Missing files yield empty commands and the
 * default preview address rather than blocking the user.
 */
export async function detectProjectRuntime(repositoryPath: string): Promise<ProjectRuntimeSettings> {
  const pkg = await readPackageJson(repositoryPath);
  if (!pkg) {
    return { installCommand: '', devCommand: '', previewUrl: DEFAULT_PREVIEW_URL };
  }
  const manager = await detectPackageManager(repositoryPath, pkg);
  const scriptName = DEV_SCRIPTS.find((name) => Boolean(pkg.scripts?.[name]));
  const script = scriptName ? pkg.scripts?.[scriptName] : undefined;
  return {
    installCommand: `${manager} install`,
    devCommand: scriptName ? formatRunCommand(manager, scriptName) : '',
    previewUrl: inferPreviewUrl(pkg, script),
  };
}

/** Keep a user's saved values; fill blanks from detection. */
export function mergeProjectRuntime(
  previous: ProjectRuntimeSettings | null | undefined,
  detected: ProjectRuntimeSettings,
): ProjectRuntimeSettings {
  return {
    installCommand: previous?.installCommand?.trim() || detected.installCommand,
    devCommand: previous?.devCommand?.trim() || detected.devCommand,
    previewUrl: previous?.previewUrl?.trim() || detected.previewUrl || DEFAULT_PREVIEW_URL,
  };
}

/**
 * Blank is allowed (optional advanced setting). Non-empty values must be HTTP(S).
 * Returns null only when the user typed something Poppin cannot open as a preview.
 */
export function normalizeOptionalPreviewUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return '';
  if (/^(javascript|data|vbscript|file|ftp|ws|wss|blob):/i.test(value)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function readPackageJson(repositoryPath: string): Promise<PackageJson | null> {
  try {
    const raw = await readFile(path.join(repositoryPath, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as PackageJson : null;
  } catch {
    return null;
  }
}

async function detectPackageManager(root: string, pkg: PackageJson): Promise<PackageManager> {
  const field = pkg.packageManager?.split('@')[0];
  if (field === 'npm' || field === 'yarn' || field === 'pnpm' || field === 'bun') return field;
  if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) return 'bun';
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function formatRunCommand(manager: PackageManager, script: string): string {
  if (manager === 'npm' && script === 'start') return 'npm start';
  return `${manager} run ${script}`;
}

function inferPreviewUrl(pkg: PackageJson, script: string | undefined): string {
  const port = script ? portFromScript(script) : null;
  if (port) return `http://localhost:${port}`;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.vite || deps['@vitejs/plugin-react']) return 'http://localhost:5173';
  if (deps.astro) return 'http://localhost:4321';
  return DEFAULT_PREVIEW_URL;
}

function portFromScript(script: string): string | null {
  const match = script.match(/(?:--port(?:\s|=)|-p\s+|PORT=)(\d{2,5})/i);
  return match?.[1] ?? null;
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}
