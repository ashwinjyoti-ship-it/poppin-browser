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

  it('inspects a Node project and infers npm install plus the dev script', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-project-runtime-'));
    const engine = new GitEngine();
    await engine.create(repositoryPath);
    await writeFile(path.join(repositoryPath, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { dev: 'vite', test: 'vitest' },
      devDependencies: { vite: '6.0.0' },
    }));
    await expect(engine.inspect(repositoryPath)).resolves.toMatchObject({
      installCommand: 'npm install',
      devCommand: 'npm run dev',
      previewUrl: 'http://localhost:5173',
    });
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

  it('updates the local base branch with a fast-forward and refuses a dirty tree', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-git-update-'));
    const repositoryPath = path.join(directory, 'repo');
    await execFileAsync('git', ['init', '-b', 'main', repositoryPath]);
    await writeFile(path.join(repositoryPath, 'README.md'), '# Before\n');
    await execFileAsync('git', ['-C', repositoryPath, 'add', 'README.md']);
    await execFileAsync('git', ['-C', repositoryPath, '-c', 'user.name=Poppin Tests', '-c', 'user.email=tests@poppin.local', 'commit', '-m', 'initial']);
    await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.name', 'Poppin Tests']);
    await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.email', 'tests@poppin.local']);
    await execFileAsync('git', ['-C', repositoryPath, 'switch', '-c', 'feature']);
    await writeFile(path.join(repositoryPath, 'README.md'), '# After\n');
    await execFileAsync('git', ['-C', repositoryPath, 'add', 'README.md']);
    await execFileAsync('git', ['-C', repositoryPath, 'commit', '-m', 'feature']);

    const bare = path.join(directory, 'origin.git');
    await execFileAsync('git', ['clone', '--bare', repositoryPath, bare]);
    await execFileAsync('git', ['-C', bare, 'branch', '-f', 'main', 'feature']);
    await execFileAsync('git', ['-C', repositoryPath, 'remote', 'add', 'origin', bare]);

    const engine = new GitEngine();
    await writeFile(path.join(repositoryPath, 'dirty.txt'), 'nope\n');
    await expect(engine.updateLocalBase(repositoryPath, 'main')).rejects.toThrow(/Commit or stash/);
    await execFileAsync('git', ['-C', repositoryPath, 'clean', '-fd']);

    const project = await engine.updateLocalBase(repositoryPath, 'main');
    expect(project.branch).toBe('main');
    expect((await execFileAsync('git', ['-C', repositoryPath, 'branch', '--show-current'])).stdout.trim()).toBe('main');
    expect((await execFileAsync('git', ['-C', repositoryPath, 'show', 'HEAD:README.md'])).stdout).toContain('# After');
  });
});
