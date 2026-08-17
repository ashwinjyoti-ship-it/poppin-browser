import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { defaultCodexSkillsDirectory } from '../../shared/work-approval-policy';
import { listTaskOutputFiles } from './task-output';

export function codexSkillsDirectory(homeDirectory = os.homedir()): string {
  return defaultCodexSkillsDirectory(homeDirectory);
}

export async function ensureCodexSkillsDirectory(homeDirectory = os.homedir()): Promise<string> {
  const directory = codexSkillsDirectory(homeDirectory);
  await mkdir(directory, { recursive: true });
  return directory;
}

export function skillSlugFromMarkdown(markdown: string, fallback: string): string {
  const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\bname:\s*["']?([^\n"']+)/u);
  if (frontmatter?.[1]?.trim()) return slug(frontmatter[1]);
  const heading = markdown.match(/^#\s+(.+)$/mu);
  if (heading?.[1]?.trim()) return slug(heading[1]);
  return slug(fallback) || 'poppin-skill';
}

export function skillSlugFromPath(filePath: string): string {
  const parent = path.basename(path.dirname(filePath));
  if (parent && parent !== '.' && parent !== 'skills') return slug(parent);
  return slug(path.basename(filePath, path.extname(filePath))) || 'poppin-skill';
}

/**
 * Copies SKILL.md files from the task output folder into ~/.codex/skills so
 * Codex can reuse them, and copies newly written Codex skills back into the
 * task folder so Reply can list them.
 */
export async function syncCodexSkills(taskOutputDirectory: string, createdAfter: string, homeDirectory = os.homedir()): Promise<void> {
  const skillsRoot = await ensureCodexSkillsDirectory(homeDirectory);
  const cutoff = Date.parse(createdAfter) || 0;
  const outputFiles = await listTaskOutputFiles(taskOutputDirectory);
  for (const file of outputFiles) {
    if (!isSkillMarkdown(file.name, file.relativePath)) continue;
    const source = path.join(taskOutputDirectory, ...file.relativePath.split('/'));
    const markdown = await readFile(source, 'utf8').catch(() => '');
    const slugName = skillSlugFromMarkdown(markdown, skillSlugFromPath(source));
    const destination = path.join(skillsRoot, slugName, 'SKILL.md');
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  let entries: string[] = [];
  try {
    entries = await readdir(skillsRoot);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const skillFile = path.join(skillsRoot, name, 'SKILL.md');
    try {
      const info = await stat(skillFile);
      if (info.mtime.getTime() < cutoff) continue;
      const dest = path.join(taskOutputDirectory, name, 'SKILL.md');
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(skillFile, dest);
    } catch {
      // Skip incomplete skill folders.
    }
  }
}

function isSkillMarkdown(name: string, relativePath: string): boolean {
  return name.toLowerCase() === 'skill.md' || relativePath.toLowerCase().endsWith('/skill.md');
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
}
