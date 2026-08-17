import type { TaskGeneratedFileSnapshot } from './task';

const OPENABLE_EXTENSIONS = new Set([
  '.csv', '.doc', '.docx', '.gif', '.htm', '.html', '.jpeg', '.jpg', '.json',
  '.md', '.pdf', '.png', '.ppt', '.pptx', '.tsv', '.txt', '.webp', '.xls', '.xlsx',
]);

/**
 * Turns a Result markdown href into a relative output path, or null when the
 * href is a web/mail URL or a traversal attempt.
 */
export function normalizeOutputHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /^(https?:|mailto:|javascript:|data:)/iu.test(trimmed)) return null;
  let value = trimmed;
  if (/^file:/iu.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      return null;
    }
  } else {
    const cut = value.split('#')[0]?.split('?')[0] ?? '';
    try {
      value = decodeURIComponent(cut);
    } catch {
      return null;
    }
  }
  value = value.replace(/\\/g, '/');
  if (!value || value.includes('\0') || value.split('/').includes('..')) return null;
  return value.replace(/^\/+/u, '').replace(/^\.\//u, '');
}

export function matchGeneratedFile(
  href: string,
  files: readonly TaskGeneratedFileSnapshot[],
): TaskGeneratedFileSnapshot | null {
  const candidate = normalizeOutputHref(href);
  if (!candidate) return null;
  const exact = files.find((file) => file.relativePath === candidate || file.name === candidate);
  if (exact) return exact;
  const base = candidate.split('/').pop() ?? '';
  if (!base) return null;
  const matches = files.filter((file) => file.name === base);
  return matches.length === 1 ? matches[0]! : null;
}

export function isOpenableGeneratedFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return OPENABLE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}
