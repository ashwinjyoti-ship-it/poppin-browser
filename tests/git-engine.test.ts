// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { GitEngine } from '../src/main/project/git-engine';

const execFileAsync = promisify(execFile);

describe('git engine', () => {
  it('creates and inspects a local Git project without a shell', async () => {
    const repositoryPath = await mkdtemp(path.join(tmpdir(), 'poppin-project-'));
    const engine = new GitEngine();
    const project = await engine.create(repositoryPath);

    expect(project).toMatchObject({ repositoryPath: await realpath(repositoryPath), branch: 'main', remote: null });
    await execFileAsync('git', ['-C', repositoryPath, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
    await expect(engine.inspect(repositoryPath)).resolves.toMatchObject({
      remote: 'https://github.com/example/project.git',
    });
  });

  it('rejects remote values that could be interpreted as Git options', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'poppin-clone-'));
    await expect(new GitEngine().clone('--upload-pack=bad', parent)).rejects.toThrow(/HTTPS, SSH/);
  });
});
