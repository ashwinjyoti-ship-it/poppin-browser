// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isLocalhostUrl } from '../src/main/browser/browser-engine';
import { WorkspaceStore } from '../src/main/workspace/workspace-store';
import type { VisualSelectionSnapshot } from '../src/shared/workspace';

describe('localhost visual selection', () => {
  it('accepts only HTTP localhost preview origins', () => {
    expect(isLocalhostUrl('http://localhost:3000/settings')).toBe(true);
    expect(isLocalhostUrl('https://127.0.0.1:5173/')).toBe(true);
    expect(isLocalhostUrl('http://[::1]:8080/')).toBe(true);
    expect(isLocalhostUrl('https://example.com/')).toBe(false);
    expect(isLocalhostUrl('file:///tmp/index.html')).toBe(false);
  });

  it('persists one explicit inspectable selection package', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-selection-'));
    const store = new WorkspaceStore(path.join(directory, 'poppin.sqlite'));
    const selection: VisualSelectionSnapshot = {
      tabId: 'tab-1', url: 'http://localhost:3000/', selector: '#save', html: '<button id="save">Save</button>',
      css: { display: 'flex', color: 'rgb(0, 0, 0)' }, domContext: '<main><button id="save">Save</button></main>',
      boundingBox: { x: 10, y: 20, width: 90, height: 32 }, screenshotDataUrl: 'data:image/png;base64,fixture',
      capturedAt: '2026-08-07T00:00:00.000Z',
    };
    store.saveVisualSelection(selection);
    expect(store.getVisualSelection()).toEqual(selection);
    store.clearVisualSelection();
    expect(store.getVisualSelection()).toBeNull();
    store.close();
  });
});
