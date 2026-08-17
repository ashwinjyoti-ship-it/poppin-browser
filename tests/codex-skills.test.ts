// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { skillSlugFromMarkdown, syncCodexSkills } from '../src/main/task/codex-skills';

describe('codex skill sync', () => {
  it('derives a slug from frontmatter or heading', () => {
    expect(skillSlugFromMarkdown('---\nname: Inbox triage\n---\n', 'fallback')).toBe('inbox-triage');
    expect(skillSlugFromMarkdown('# Quote replies\n\nDraft a reply.', 'fallback')).toBe('quote-replies');
  });

  it('installs a task-output SKILL.md into the Codex skills folder', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'poppin-skill-sync-'));
    const taskDir = path.join(root, 'task');
    const home = path.join(root, 'home');
    await mkdir(taskDir, { recursive: true });
    await writeFile(path.join(taskDir, 'SKILL.md'), '---\nname: Inbox triage\n---\n\nTriage the inbox.\n');
    await syncCodexSkills(taskDir, new Date(Date.now() - 1_000).toISOString(), home);
    expect(await readFile(path.join(home, '.codex', 'skills', 'inbox-triage', 'SKILL.md'), 'utf8')).toContain('Triage the inbox.');
  });

  it('copies a newly written Codex skill back into the task folder for Reply', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'poppin-skill-copyback-'));
    const taskDir = path.join(root, 'task');
    const home = path.join(root, 'home');
    const skillDir = path.join(home, '.codex', 'skills', 'quote-replies');
    await mkdir(taskDir, { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Quote replies\n\nDraft a reply.\n');
    await syncCodexSkills(taskDir, new Date(Date.now() - 1_000).toISOString(), home);
    expect(await readFile(path.join(taskDir, 'quote-replies', 'SKILL.md'), 'utf8')).toContain('Draft a reply.');
  });
});
