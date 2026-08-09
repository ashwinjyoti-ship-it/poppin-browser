// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { TandemClient } from '../src/main/tandem/tandem-client';
import { TandemCredentialStore, normalizeTandemBaseUrl } from '../src/main/tandem/tandem-credentials';
import { TandemEngine } from '../src/main/tandem/tandem-engine';
import { executeTandemCapability, TANDEM_CAPABILITY_TOOL } from '../src/main/tandem/tandem-capability';
import { tandemWorldUrl } from '../src/shared/tandem';

interface Call { method: string; url: string; body: unknown; apiKey: string | null }

function fakeFetch(routes: Record<string, unknown>, calls: Call[] = []) {
  const impl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
    calls.push({
      method: init?.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      body: init?.body ? JSON.parse(String(init.body)) as unknown : null,
      apiKey: new Headers(init?.headers).get('X-API-Key'),
    });
    const match = routes[key] ?? routes[`${init?.method ?? 'GET'} ${url.pathname}`];
    if (match === undefined) return new Response('not found', { status: 404 });
    if (typeof match === 'string') return new Response(match, { status: 200, headers: { 'content-type': 'text/plain' } });
    return new Response(JSON.stringify(match), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { impl, calls };
}

const BASE = 'https://tandem.example.com';

function client(routes: Record<string, unknown>, calls: Call[] = []) {
  const { impl } = fakeFetch(routes, calls);
  return new TandemClient(BASE, 'udm_secret', impl);
}

describe('Tandem base URL', () => {
  it('normalizes and rejects bad addresses', () => {
    expect(normalizeTandemBaseUrl('tandem.example.com')).toBe('https://tandem.example.com');
    expect(normalizeTandemBaseUrl('https://tandem.example.com/app/?x=1#y')).toBe('https://tandem.example.com/app');
    expect(() => normalizeTandemBaseUrl('  ')).toThrow(/Enter the Tandem address/);
    expect(() => normalizeTandemBaseUrl('ftp://tandem')).toThrow();
  });

  it('builds Tandem World URLs that carry the Poppin host token', () => {
    expect(tandemWorldUrl(BASE)).toBe('https://tandem.example.com/?host=poppin');
    expect(tandemWorldUrl(BASE, 'page-1')).toBe('https://tandem.example.com/page/page-1?host=poppin');
  });
});

describe('TandemCredentialStore', () => {
  it('seals the API key with OS-backed encryption and never stores it in the clear', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-tandem-credential-'));
    const encrypted: string[] = [];
    const store = new TandemCredentialStore(path.join(directory, 'poppin.sqlite'), {
      available: () => true,
      encrypt: (text) => { encrypted.push(text); return Buffer.from(`sealed:${text}`); },
      decrypt: (value) => value.toString('utf8').replace(/^sealed:/, ''),
    });
    store.save({ baseUrl: BASE, apiKey: 'udm_secret' });
    expect(encrypted).toEqual(['udm_secret']);
    expect(store.has()).toBe(true);
    expect(store.baseUrl()).toBe(BASE);
    expect(store.load()).toEqual({ baseUrl: BASE, apiKey: 'udm_secret' });
    store.clear();
    expect(store.load()).toBeNull();
    store.close();
  });

  it('refuses to store a key when OS-backed encryption is unavailable', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-tandem-nokeychain-'));
    const store = new TandemCredentialStore(path.join(directory, 'poppin.sqlite'), {
      available: () => false,
      encrypt: () => Buffer.from(''),
      decrypt: () => '',
    });
    expect(() => store.save({ baseUrl: BASE, apiKey: 'udm_secret' })).toThrow(/encryption is unavailable/);
    store.close();
  });
});

describe('TandemClient', () => {
  it('keeps a valid API-key connection when the optional browser account endpoint returns 401', async () => {
    const api = new TandemClient(BASE, 'udm_secret', async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/api/auth/me') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify({ endpoints: [] }), { status: 200 });
    });

    await expect(api.catalog()).resolves.toEqual({ endpoints: [] });
    await expect(api.me()).resolves.toEqual({ label: null, writable: true });
  });

  it('sends the API key as a header and reads Markdown for a page', async () => {
    const calls: Call[] = [];
    const api = client({
      'GET /api/pages/page-1': { page: { id: 'page-1', title: 'Notes', updated_at: '2026-08-01T10:00:00Z' } },
      'GET /api/pages/page-1/markdown': { markdown: '# Notes\n\nExisting line.' },
    }, calls);
    const content = await api.readMarkdown('page-1');
    expect(content).toMatchObject({ pageId: 'page-1', title: 'Notes', markdown: '# Notes\n\nExisting line.', truncated: false });
    expect(calls.every((call) => call.apiKey === 'udm_secret')).toBe(true);
  });

  it('appends without losing existing content', async () => {
    const calls: Call[] = [];
    const api = client({
      'GET /api/pages/page-1': { id: 'page-1', title: 'Notes' },
      'GET /api/pages/page-1/markdown': { markdown: '# Notes\n\nExisting line.' },
      'PUT /api/pages/page-1/markdown': {},
    }, calls);
    await api.appendMarkdown('page-1', 'https://example.com/video');
    const write = calls.find((call) => call.method === 'PUT');
    expect(write?.body).toEqual({ markdown: '# Notes\n\nExisting line.\n\nhttps://example.com/video\n' });
  });

  it('turns Tandem HTTP failures into actionable messages', async () => {
    const impl: typeof fetch = async () => new Response(JSON.stringify({ error: 'nope' }), { status: 401 });
    const api = new TandemClient(BASE, 'bad', impl);
    await expect(api.listWorkspaces()).rejects.toThrow(/rejected the API key/);
  });
});

describe('Tandem capability', () => {
  function capability(routes: Record<string, unknown>, calls: Call[] = [], writable = true) {
    const openInWorld = vi.fn();
    const context = {
      client: () => client(routes, calls),
      workspaceId: () => 'workspace-1',
      writable: () => writable,
      openInWorld,
    };
    return { context, openInWorld };
  }

  it('describes itself as an API capability, not UI automation', () => {
    expect(TANDEM_CAPABILITY_TOOL.name).toBe('tandem');
    expect(TANDEM_CAPABILITY_TOOL.description).toContain('instead of browsing or automating the Tandem user interface');
  });

  it('creates a page and writes its content in one action', async () => {
    const calls: Call[] = [];
    const { context } = capability({
      'POST /api/workspaces/workspace-1/pages': { page: { id: 'page-9', title: 'Research Y', type: 'page' } },
      'PUT /api/pages/page-9/markdown': {},
    }, calls);
    const result = await executeTandemCapability(context, { action: 'create_page', title: 'Research Y', markdown: '# Findings' });
    expect(result.ok).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /api/workspaces/workspace-1/pages',
      'PUT /api/pages/page-9/markdown',
    ]);
  });

  it('appends safely to an existing page', async () => {
    const calls: Call[] = [];
    const { context } = capability({
      'GET /api/pages/notes/': undefined,
      'GET /api/pages/notes': { id: 'notes', title: 'Notes' },
      'GET /api/pages/notes/markdown': { markdown: 'Line one.' },
      'PUT /api/pages/notes/markdown': {},
    }, calls);
    const result = await executeTandemCapability(context, JSON.stringify({ action: 'append', pageId: 'notes', markdown: 'Line two.' }));
    expect(result.ok).toBe(true);
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ markdown: 'Line one.\n\nLine two.\n' });
  });

  it('refuses writes when Poppin only has read access', async () => {
    const { context } = capability({}, [], false);
    const result = await executeTandemCapability(context, { action: 'append', pageId: 'notes', markdown: 'x' });
    expect(result).toEqual({ ok: false, text: 'Poppin has read-only Tandem access for this task.' });
  });

  it('opens a resulting page in Tandem World for the human', async () => {
    const { context, openInWorld } = capability({});
    const result = await executeTandemCapability(context, { action: 'open_in_world', pageId: 'page-9' });
    expect(result.ok).toBe(true);
    expect(openInWorld).toHaveBeenCalledWith('page-9');
  });
});

describe('TandemEngine', () => {
  async function setup() {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-tandem-engine-'));
    const credentials = new TandemCredentialStore(path.join(directory, 'poppin.sqlite'), {
      available: () => true,
      encrypt: (text) => Buffer.from(text),
      decrypt: (value) => value.toString('utf8'),
    });
    const calls: Call[] = [];
    const routes: Record<string, unknown> = {
      'GET /api/agent/catalog': { endpoints: [] },
      'GET /api/auth/me': { email: 'ashwinjyoti@gmail.com' },
      'GET /api/workspaces': [{ id: 'workspace-1', name: 'Personal' }],
      'GET /api/workspaces/workspace-1/pages': [
        { id: 'page-1', title: 'Notes', type: 'page', parent_id: null, updated_at: '2026-08-01T10:00:00Z' },
        { id: 'folder-1', title: 'Project A', type: 'folder', parent_id: null },
      ],
      'GET /api/recent': [{ id: 'page-1', title: 'Notes', type: 'page' }],
      'GET /api/pages/page-1': { id: 'page-1', title: 'Notes', updated_at: '2026-08-01T10:00:00Z' },
      'GET /api/pages/page-1/markdown': { markdown: 'Frozen body.' },
    };
    const openWorld = vi.fn();
    const onContextChanged = vi.fn();
    const send = vi.fn();
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } };
    const engine = new TandemEngine(window as unknown as Electron.BrowserWindow, credentials, {
      openWorld,
      onContextChanged,
      createClient: (baseUrl, apiKey) => new TandemClient(baseUrl, apiKey, fakeFetch(routes, calls).impl),
    });
    return { engine, credentials, openWorld, onContextChanged, routes, calls };
  }

  it('connects, lists the workspace, and reports availability to the capability router', async () => {
    const { engine, credentials } = await setup();
    expect(engine.getAvailability()).toEqual({ available: false, writable: false });
    expect(await engine.execute({ type: 'connect', baseUrl: BASE, apiKey: 'udm_secret' })).toEqual({ ok: true });
    const snapshot = engine.getSnapshot();
    expect(snapshot.connection).toMatchObject({ state: 'ready', accountLabel: 'ashwinjyoti@gmail.com', writable: true });
    expect(snapshot.workspaces).toEqual([{ id: 'workspace-1', name: 'Personal' }]);
    expect(snapshot.pages.map((page) => page.id)).toContain('page-1');
    expect(engine.getAvailability()).toEqual({ available: true, writable: true });
    credentials.close();
  });

  it('freezes a checked page into explicit context and refreshes only on request', async () => {
    const { engine, credentials, routes, onContextChanged } = await setup();
    await engine.execute({ type: 'connect', baseUrl: BASE, apiKey: 'udm_secret' });
    await engine.execute({ type: 'setPageSelected', pageId: 'page-1', selected: true });

    const [frozen] = engine.getSelectedContext();
    expect(frozen).toMatchObject({
      sourceType: 'tandem-page', workspaceId: 'workspace-1', pageId: 'page-1',
      title: 'Notes', updatedAt: '2026-08-01T10:00:00Z', capturedMarkdown: 'Frozen body.', stale: false,
    });
    expect(onContextChanged).toHaveBeenCalled();

    // A remote edit must not silently mutate the active task's context.
    routes['GET /api/pages/page-1/markdown'] = { markdown: 'Changed remotely.' };
    expect(engine.getSelectedContext()[0]?.capturedMarkdown).toBe('Frozen body.');

    await engine.execute({ type: 'refreshContext' });
    expect(engine.getSelectedContext()[0]?.capturedMarkdown).toBe('Changed remotely.');

    await engine.execute({ type: 'setPageSelected', pageId: 'page-1', selected: false });
    expect(engine.getSelectedContext()).toEqual([]);
    credentials.close();
  });

  it('opens Tandem World with the Poppin host token', async () => {
    const { engine, credentials, openWorld } = await setup();
    await engine.execute({ type: 'connect', baseUrl: BASE, apiKey: 'udm_secret' });
    await engine.execute({ type: 'openWorld' });
    expect(openWorld).toHaveBeenCalledWith('https://tandem.example.com/?host=poppin');
    engine.openWorldForPage('page-1');
    expect(openWorld).toHaveBeenLastCalledWith('https://tandem.example.com/page/page-1?host=poppin');
    credentials.close();
  });

  it('reports a connection failure instead of pretending Tandem is available', async () => {
    const { engine, credentials, routes } = await setup();
    delete routes['GET /api/agent/catalog'];
    const result = await engine.execute({ type: 'connect', baseUrl: BASE, apiKey: 'udm_secret' });
    expect(result.ok).toBe(false);
    expect(engine.getSnapshot().connection.state).toBe('error');
    expect(engine.getAvailability()).toEqual({ available: false, writable: false });
    credentials.close();
  });
});
