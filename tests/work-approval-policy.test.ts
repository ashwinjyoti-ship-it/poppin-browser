// @vitest-environment node

import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultCodexSkillsDirectory,
  isDestructiveWorkCommand,
  isSafeWorkCommand,
  isSafeWorkFileGrant,
  shouldAutoAcceptWorkApproval,
  workWritableRoots,
} from '../src/shared/work-approval-policy';

const home = '/Users/tester';
const taskDir = '/tmp/poppin-task/document-1';
const roots = workWritableRoots(taskDir, home);
const skills = defaultCodexSkillsDirectory(home);

describe('work approval policy', () => {
  it('allows skill and task-output file grants, not the home folder', () => {
    expect(isSafeWorkFileGrant(path.join(skills, 'inbox-triage'), roots)).toBe(true);
    expect(isSafeWorkFileGrant(taskDir, roots)).toBe(true);
    expect(isSafeWorkFileGrant(home, roots)).toBe(false);
    expect(isSafeWorkFileGrant('/etc', roots)).toBe(false);
    expect(isSafeWorkFileGrant(`acpKind:edit\n${JSON.stringify({ path: path.join(skills, 'inbox-triage', 'SKILL.md') }, null, 2)}`, roots)).toBe(true);
    expect(isSafeWorkFileGrant(`acpKind:delete\n${path.join(taskDir, 'SKILL.md')}`, roots)).toBe(false);
  });

  it('allows mkdir and python in the task directory, and mkdir of a Codex skill', () => {
    expect(isSafeWorkCommand('python3 build_sheet.py', taskDir, roots)).toBe(true);
    expect(isSafeWorkCommand('/usr/bin/python3 build_sheet.py', taskDir, roots)).toBe(true);
    expect(isSafeWorkCommand(`mkdir -p ${path.join(skills, 'inbox-triage')}`, taskDir, roots)).toBe(true);
    expect(isDestructiveWorkCommand('rm -rf /')).toBe(true);
    expect(isSafeWorkCommand('rm -rf /', taskDir, roots)).toBe(false);
    expect(isSafeWorkCommand('curl https://example.com', taskDir, roots)).toBe(false);
    expect(isSafeWorkCommand('npx --yes cowsay hi', taskDir, roots)).toBe(false);
    expect(isSafeWorkCommand('git push origin main', taskDir, roots)).toBe(false);
    expect(isSafeWorkCommand('cp /etc/passwd out.txt', taskDir, roots)).toBe(false);
  });

  it('auto-accepts Work file and command approvals that stay in writable roots', () => {
    expect(shouldAutoAcceptWorkApproval('files', path.join(skills, 'inbox-triage'), roots)).toBe(true);
    expect(shouldAutoAcceptWorkApproval('command', `mkdir -p ${path.join(skills, 'inbox-triage')}\n${taskDir}`, roots)).toBe(true);
    expect(shouldAutoAcceptWorkApproval('command', JSON.stringify({ command: 'python3 write_xlsx.py', cwd: taskDir }), roots)).toBe(true);
    expect(shouldAutoAcceptWorkApproval('permissions', JSON.stringify({ network: { enabled: false }, fileSystem: { write: [skills] } }), roots)).toBe(true);
    expect(shouldAutoAcceptWorkApproval('permissions', JSON.stringify({ network: { enabled: true } }), roots)).toBe(false);
    expect(shouldAutoAcceptWorkApproval('command', `rm -rf ${os.homedir()}\n${taskDir}`, roots)).toBe(false);
    expect(shouldAutoAcceptWorkApproval('files', home, roots)).toBe(false);
  });
});
