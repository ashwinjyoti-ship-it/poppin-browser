// @vitest-environment node

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREVIEW_URL,
  detectProjectRuntime,
  mergeProjectRuntime,
  normalizeOptionalPreviewUrl,
} from '../src/main/project/project-runtime';

describe('project runtime detection', () => {
  it('detects npm install and the first start script from package.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'poppin-runtime-npm-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { dev: 'vite --port 4173', start: 'node server.js' },
      devDependencies: { vite: '6.0.0' },
    }));
    await writeFile(path.join(root, 'package-lock.json'), '{}');

    await expect(detectProjectRuntime(root)).resolves.toEqual({
      installCommand: 'npm install',
      devCommand: 'npm run dev',
      previewUrl: 'http://localhost:4173',
    });
  });

  it('prefers pnpm when a pnpm lockfile is present', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'poppin-runtime-pnpm-'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'app',
      scripts: { start: 'next start' },
      dependencies: { next: '15.0.0' },
    }));
    await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

    await expect(detectProjectRuntime(root)).resolves.toEqual({
      installCommand: 'pnpm install',
      devCommand: 'pnpm run start',
      previewUrl: DEFAULT_PREVIEW_URL,
    });
  });

  it('returns empty commands when the folder has no package.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'poppin-runtime-empty-'));
    await expect(detectProjectRuntime(root)).resolves.toEqual({
      installCommand: '',
      devCommand: '',
      previewUrl: DEFAULT_PREVIEW_URL,
    });
  });

  it('keeps saved values and fills only blanks', () => {
    expect(mergeProjectRuntime(
      { installCommand: 'make install', devCommand: '', previewUrl: '' },
      { installCommand: 'npm install', devCommand: 'npm run dev', previewUrl: DEFAULT_PREVIEW_URL },
    )).toEqual({
      installCommand: 'make install',
      devCommand: 'npm run dev',
      previewUrl: DEFAULT_PREVIEW_URL,
    });
  });

  it('treats a blank preview as optional and rejects non-HTTP values', () => {
    expect(normalizeOptionalPreviewUrl('')).toBe('');
    expect(normalizeOptionalPreviewUrl('  ')).toBe('');
    expect(normalizeOptionalPreviewUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeOptionalPreviewUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeOptionalPreviewUrl('ftp://localhost:21')).toBeNull();
    expect(normalizeOptionalPreviewUrl('not a url')).toBeNull();
  });
});
