import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { TaskGeneratedFileSnapshot } from '../../shared/task';

const MAX_OUTPUT_FILES = 50;

export function taskOutputDirectory(workDirectory: string, documentId: string): string {
  return path.join(workDirectory, documentId);
}

export function resolveTaskOutputFile(directory: string, relativePath: string): string | null {
  if (!relativePath.trim() || relativePath.includes('\0')) return null;
  const resolvedRoot = path.resolve(directory);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

export async function listTaskOutputFiles(directory: string): Promise<TaskGeneratedFileSnapshot[]> {
  const files: TaskGeneratedFileSnapshot[] = [];
  await collect(directory, directory, files);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files.slice(0, MAX_OUTPUT_FILES);
}

async function collect(root: string, current: string, files: TaskGeneratedFileSnapshot[]): Promise<void> {
  if (files.length >= MAX_OUTPUT_FILES) return;
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= MAX_OUTPUT_FILES) return;
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collect(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const info = await stat(absolute);
      const relativePath = path.relative(root, absolute).split(path.sep).join('/');
      files.push({
        name: entry.name,
        relativePath,
        sizeBytes: info.size,
        updatedAt: info.mtime.toISOString(),
      });
    } catch {
      // Skip files that disappear between readdir and stat.
    }
  }
}
