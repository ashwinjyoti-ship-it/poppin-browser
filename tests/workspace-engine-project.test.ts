// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { GitEngine } from '../src/main/project/git-engine';
import { WorkspaceEngine } from '../src/main/workspace/workspace-engine';
import { WorkspaceStore } from '../src/main/workspace/workspace-store';

const execFileAsync = promisify(execFile);

function mockWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } };
}

async function createEngine(prefix: string) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const store = new WorkspaceStore(path.join(directory, 'poppin.sqlite'));
  store.createWorkspace('Fixture');
  const engine = new WorkspaceEngine(mockWindow() as unknown as Electron.BrowserWindow, store, {} as never, {} as never);
  return { directory, store, engine };
}

describe('workspace engine project settings', () => {
  it('saves optional run settings and infers a preview when the field is blank', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-engine-project-repo-'));
    await writeFile(path.join(repositoryPath, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { dev: 'vite' },
      devDependencies: { vite: '6.0.0' },
    }));
    const { directory, store, engine } = await createEngine('poppin-engine-project-');
    store.saveProject({
      repositoryPath,
      remote: 'https://github.com/example/app.git',
      branch: 'main',
      installCommand: '',
      devCommand: '',
      previewUrl: 'http://localhost:3000',
    });

    const saved = await engine.execute({
      type: 'updateProjectSettings',
      installCommand: '',
      devCommand: '',
      previewUrl: '',
    });
    expect(saved).toEqual({ ok: true });
    expect(store.getProject()).toMatchObject({
      repositoryPath,
      installCommand: '',
      devCommand: '',
      previewUrl: 'http://localhost:5173',
    });

    const custom = await engine.execute({
      type: 'updateProjectSettings',
      installCommand: 'npm ci',
      devCommand: 'npm run dev',
      previewUrl: 'http://127.0.0.1:4000',
    });
    expect(custom).toEqual({ ok: true });
    expect(store.getProject()).toMatchObject({
      installCommand: 'npm ci',
      devCommand: 'npm run dev',
      previewUrl: 'http://127.0.0.1:4000',
    });

    store.close();
    const restored = new WorkspaceStore(path.join(directory, 'poppin.sqlite'));
    expect(restored.getProject()).toMatchObject({
      installCommand: 'npm ci',
      devCommand: 'npm run dev',
      previewUrl: 'http://127.0.0.1:4000',
    });
    restored.close();
  });

  it('rejects only invalid preview addresses, not blank ones', async () => {
    const { store, engine } = await createEngine('poppin-engine-preview-');
    store.saveProject({
      repositoryPath: '/tmp/project',
      remote: null,
      branch: 'main',
      installCommand: '',
      devCommand: '',
      previewUrl: 'http://localhost:3000',
    });

    expect(await engine.execute({
      type: 'updateProjectSettings',
      installCommand: 'npm install',
      devCommand: 'npm run dev',
      previewUrl: 'ftp://localhost',
    })).toEqual({ ok: false, message: 'Use a valid HTTP preview address, or leave it blank.' });
    expect(store.getProject()?.previewUrl).toBe('http://localhost:3000');
    store.close();
  });

  it('hydrates blank commands from package.json so Code can proceed without a settings form', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-engine-hydrate-repo-'));
    await writeFile(path.join(repositoryPath, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { dev: 'next dev' },
    }));
    await writeFile(path.join(repositoryPath, 'yarn.lock'), '');
    const { store, engine } = await createEngine('poppin-engine-hydrate-');
    store.saveProject({
      repositoryPath,
      remote: null,
      branch: 'main',
      installCommand: '',
      devCommand: '',
      previewUrl: 'http://localhost:3000',
    });

    await engine.hydrateProjectRuntime();
    expect(store.getProject()).toMatchObject({
      installCommand: 'yarn install',
      devCommand: 'yarn run dev',
      previewUrl: 'http://localhost:3000',
    });
    store.close();
  });

  it('connects a local Git folder and stores inferred runtime settings', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-engine-open-repo-'));
    await execFileAsync('git', ['init', '-b', 'main', repositoryPath]);
    await writeFile(path.join(repositoryPath, 'README.md'), '# Fixture\n');
    await writeFile(path.join(repositoryPath, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { start: 'node server.js' },
    }));
    await execFileAsync('git', ['-C', repositoryPath, 'add', 'README.md', 'package.json']);
    await execFileAsync('git', ['-C', repositoryPath, '-c', 'user.name=Poppin Tests', '-c', 'user.email=tests@poppin.local', 'commit', '-m', 'initial']);

    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-engine-open-'));
    const store = new WorkspaceStore(path.join(directory, 'poppin.sqlite'));
    store.createWorkspace('Fixture');
    const git = new GitEngine();
    const engine = new WorkspaceEngine(mockWindow() as unknown as Electron.BrowserWindow, store, {} as never, git);

    expect(await engine.execute({ type: 'addProject', source: repositoryPath })).toEqual({ ok: true });
    expect(store.getProject()).toMatchObject({
      repositoryPath: expect.stringContaining(path.basename(repositoryPath)),
      installCommand: 'npm install',
      devCommand: 'npm start',
      previewUrl: 'http://localhost:3000',
    });
    store.close();
  });
});
