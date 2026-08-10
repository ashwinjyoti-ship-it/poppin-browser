import { describe, expect, it } from 'vitest';

import { parseProjectSource, repositoryFolderName } from '../src/shared/project-source';

describe('project source parsing', () => {
  it('accepts HTTPS, SSH, and GitHub shorthand remotes', () => {
    expect(parseProjectSource('https://github.com/acme/app.git')).toEqual({
      kind: 'remote',
      remote: 'https://github.com/acme/app.git',
    });
    expect(parseProjectSource('git@github.com:acme/app.git')).toEqual({
      kind: 'remote',
      remote: 'git@github.com:acme/app.git',
    });
    expect(parseProjectSource('acme/app')).toEqual({
      kind: 'remote',
      remote: 'https://github.com/acme/app.git',
    });
  });

  it('treats absolute and home-relative paths as local folders', () => {
    expect(parseProjectSource('/Users/ash/code/app')).toEqual({
      kind: 'local',
      path: '/Users/ash/code/app',
    });
    expect(parseProjectSource('~/code/app')).toEqual({
      kind: 'local',
      path: '~/code/app',
    });
  });

  it('rejects empty or option-like values', () => {
    expect(parseProjectSource('   ')).toMatchObject({ kind: 'invalid' });
    expect(parseProjectSource('--upload-pack=bad')).toMatchObject({ kind: 'invalid' });
  });

  it('derives a safe clone folder name from the remote', () => {
    expect(repositoryFolderName('https://github.com/acme/app.git')).toBe('app');
    expect(repositoryFolderName('git@github.com:acme/app.git')).toBe('app');
  });
});
