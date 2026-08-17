// @vitest-environment node

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listTaskOutputFiles, resolveTaskOutputFile, taskOutputDirectory } from '../src/main/task/task-output';
import { isOpenableGeneratedFile, matchGeneratedFile } from '../src/shared/task-output';
import type { TaskGeneratedFileSnapshot } from '../src/shared/task';

function file(name: string, relativePath = name): TaskGeneratedFileSnapshot {
  return { name, relativePath, sizeBytes: 12, updatedAt: '2026-08-17T00:00:00.000Z' };
}

describe('matchGeneratedFile', () => {
  const files = [file('report.xlsx'), file('notes.csv', 'exports/notes.csv')];

  it('matches a relative markdown href to the generated workbook', () => {
    expect(matchGeneratedFile('report.xlsx', files)?.name).toBe('report.xlsx');
    expect(matchGeneratedFile('./report.xlsx', files)?.name).toBe('report.xlsx');
  });

  it('matches a file:// URL by basename when the path is unique', () => {
    expect(matchGeneratedFile('file:///Users/ashwin/task-output/abc/report.xlsx', files)?.name).toBe('report.xlsx');
  });

  it('matches a nested relative path', () => {
    expect(matchGeneratedFile('exports/notes.csv', files)?.relativePath).toBe('exports/notes.csv');
  });

  it('ignores http(s) download placeholders', () => {
    expect(matchGeneratedFile('https://example.com/download-excel-here', files)).toBeNull();
    expect(matchGeneratedFile('mailto:you@example.com', files)).toBeNull();
  });

  it('rejects path traversal', () => {
    expect(matchGeneratedFile('../secret.xlsx', files)).toBeNull();
    expect(matchGeneratedFile('file:///etc/passwd', files)).toBeNull();
  });
});

describe('isOpenableGeneratedFile', () => {
  it('allows document-like files and blocks scripts', () => {
    expect(isOpenableGeneratedFile('report.xlsx')).toBe(true);
    expect(isOpenableGeneratedFile('notes.csv')).toBe(true);
    expect(isOpenableGeneratedFile('run.sh')).toBe(false);
    expect(isOpenableGeneratedFile('payload.js')).toBe(false);
  });
});

describe('task output directory listing', () => {
  it('lists files written for one task and ignores hidden entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'poppin-task-output-'));
    const directory = taskOutputDirectory(root, 'document-1');
    await mkdir(path.join(directory, 'exports'), { recursive: true });
    await writeFile(path.join(directory, 'report.xlsx'), 'workbook');
    await writeFile(path.join(directory, 'exports', 'notes.csv'), 'a,b\n');
    await writeFile(path.join(directory, '.DS_Store'), 'hidden');
    const listed = await listTaskOutputFiles(directory);
    expect(listed.map((item) => item.relativePath).sort()).toEqual(['exports/notes.csv', 'report.xlsx']);
    expect(listed.find((item) => item.name === 'report.xlsx')?.sizeBytes).toBeGreaterThan(0);
  });

  it('resolves only paths inside the task directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'poppin-task-output-'));
    const directory = taskOutputDirectory(root, 'document-1');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'report.xlsx'), 'workbook');
    expect(resolveTaskOutputFile(directory, 'report.xlsx')).toBe(path.join(directory, 'report.xlsx'));
    expect(resolveTaskOutputFile(directory, '../report.xlsx')).toBeNull();
    expect(resolveTaskOutputFile(directory, '/tmp/evil.xlsx')).toBeNull();
  });
});
