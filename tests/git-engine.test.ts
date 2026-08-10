// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { GitEngine } from '../src/main/project/git-engine';

const execFileAsync = promisify(execFile);

describe('git engine', () => {
  it('creates and inspects a local Git project with a usable HEAD baseline', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-project-'));
    const engine = new GitEngine();
    const project = await engine.create(repositoryPath);

    expect(project).toMatchObject({ repositoryPath: await realpath(repositoryPath), branch: 'main', remote: null });
    await expect(engine.getHead(repositoryPath)).resolves.toMatch(/^[0-9a-f]{40}$/);
    await execFileAsync('git', ['-C', repositoryPath, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
    await expect(engine.inspect(repositoryPath)).resolves.toMatchObject({
      remote: 'https://github.com/example/project.git',
    });
  });

  it('opens an empty folder by initializing a baseline project', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-open-local-'));
    const engine = new GitEngine();
    const project = await engine.openLocal(repositoryPath);
    expect(project.branch).toBe('main');
    await expect(engine.getHead(repositoryPath)).resolves.toMatch(/^[0-9a-f]{40}$/);
  });

  it('repairs an empty Git repository so Code tasks can take HEAD', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-empty-git-'));
    await execFileAsync('git', ['init', '-b', 'main', repositoryPath]);
    const engine = new GitEngine();
    await expect(engine.hasHead(repositoryPath)).resolves.toBe(false);
    await engine.ensureUsableBaseline(repositoryPath);
    await expect(engine.getHead(repositoryPath)).resolves.toMatch(/^[0-9a-f]{40}$/);
  });

  it('rejects remote values that could be interpreted as Git options', async () => {
    const destination = path.join(await mkdtemp(path.join(tmpdir(), 'poppin-clone-')), 'repo');
    await expect(new GitEngine().clone('--upload-pack=bad', destination)).rejects.toThrow(/HTTPS, SSH/);
  });

  it('captures a clean baseline and reports later changes', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-git-baseline-'));
    await execFileAsync('git', ['init', '-b', 'main', repositoryPath]);
    await writeFile(path.join(repositoryPath, 'README.md'), '# Before\n');
    await execFileAsync('git', ['-C', repositoryPath, 'add', 'README.md']);
    await execFileAsync('git', ['-C', repositoryPath, '-c', 'user.name=Poppin Tests', '-c', 'user.email=tests@poppin.local', 'commit', '-m', 'initial']);

    const engine = new GitEngine();
    const baseline = await engine.getHead(repositoryPath);
    expect(baseline).toMatch(/^[0-9a-f]{40}$/);
    expect(await engine.getWorkingTreeChanges(repositoryPath)).toEqual([]);

    await writeFile(path.join(repositoryPath, 'README.md'), '# After\n');
    await writeFile(path.join(repositoryPath, 'new.txt'), 'new\n');
    expect(await engine.getWorkingTreeChanges(repositoryPath)).toHaveLength(2);
    const diff = await engine.getDiff(repositoryPath, baseline);
    expect(diff).toContain('-# Before');
    expect(diff).toContain('+# After');
    expect(diff).toContain('diff --git a/new.txt b/new.txt');
    expect(diff).toContain('+new');
  });
});
