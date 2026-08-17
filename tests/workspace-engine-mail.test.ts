// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { WorkspaceEngine } from '../src/main/workspace/workspace-engine';
import { WorkspaceStore } from '../src/main/workspace/workspace-store';

function mockWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } };
}

describe('workspace engine mail skills', () => {
  it('creates a workspace if needed and persists a natural-language mail skill', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-engine-mail-'));
    const store = new WorkspaceStore(path.join(directory, 'poppin.sqlite'));
    const window = mockWindow();
    const engine = new WorkspaceEngine(window as unknown as Electron.BrowserWindow, store, {} as never, {} as never);

    expect(store.getWorkspace()).toBeNull();
    const result = await engine.execute({
      type: 'createMailSkill',
      name: 'Quotes',
      rule: 'Mails addressed to Ashwin with a request for quote get a draft reply.',
    });

    expect(result).toEqual({ ok: true, message: 'Saved mail skill "Quotes".' });
    expect(store.getWorkspace()).toMatchObject({ name: 'Poppin' });
    expect(engine.getSnapshot().mailSkills).toEqual([expect.objectContaining({
      name: 'Quotes',
      rule: 'Mails addressed to Ashwin with a request for quote get a draft reply.',
      enabled: true,
    })]);
    expect(window.webContents.send).toHaveBeenCalledWith(
      'workspace:snapshot',
      expect.objectContaining({ mailSkills: [expect.objectContaining({ name: 'Quotes' })] }),
    );
    store.close();
  });

  it('rejects credential-looking mail skill text without writing a row', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-engine-mail-secret-'));
    const store = new WorkspaceStore(path.join(directory, 'poppin.sqlite'));
    const engine = new WorkspaceEngine(mockWindow() as unknown as Electron.BrowserWindow, store, {} as never, {} as never);

    expect(await engine.execute({
      type: 'createMailSkill',
      name: 'Quotes',
      rule: 'Read the cookie and continue.',
    })).toEqual({
      ok: false,
      message: 'Describe the mail skill in plain language, without passwords or secrets.',
    });
    expect(engine.getSnapshot().mailSkills).toEqual([]);
    store.close();
  });
});
