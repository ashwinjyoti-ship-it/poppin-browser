// @vitest-environment node

import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

import { PagesStore } from '../src/main/pages/pages-store';
import { WorkspaceEngine } from '../src/main/workspace/workspace-engine';
import { WorkspaceStore } from '../src/main/workspace/workspace-store';

describe('Excel documents', () => {
  it('captures workbook text and opens the same file as an editable native Database', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-excel-'));
    const filePath = path.join(directory, 'inventory.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Stock').addRows([
      ['Product', 'Price', 'Available'],
      ['Acoustic guitar', 9999, true],
      ['Capo', 799, false],
    ]);
    await workbook.xlsx.writeFile(filePath);
    const file = await stat(filePath);
    const databasePath = path.join(directory, 'poppin.sqlite');
    const workspace = new WorkspaceStore(databasePath);
    const pages = new PagesStore(databasePath);
    workspace.createWorkspace('Fixture');
    workspace.upsertDocument({ id: 'excel-one', name: 'inventory.xlsx', path: filePath, sizeBytes: file.size, capturedText: null, truncated: false });
    const refreshed = vi.fn();
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } };
    const engine = new WorkspaceEngine(window as unknown as Electron.BrowserWindow, workspace, {} as never, {} as never, { pagesStore: pages, onPagesChanged: refreshed });

    expect(await engine.execute({ type: 'setDocumentSelected', documentId: 'excel-one', selected: true })).toMatchObject({ ok: true });
    expect(workspace.listDocuments()[0]?.capturedText).toContain('Acoustic guitar');
    expect(await engine.execute({ type: 'openDocumentAsDatabase', documentId: 'excel-one' })).toMatchObject({ ok: true });
    expect(pages.listPages()).toEqual([expect.objectContaining({ title: 'inventory', kind: 'database' })]);
    const imported = pages.getPage(pages.listPages()[0]!.id)!;
    expect(imported.database).toMatchObject({
      properties: [{ name: 'Product' }, { name: 'Price' }, { name: 'Available' }],
      rows: [expect.objectContaining({ properties: expect.objectContaining({}) }), expect.objectContaining({ properties: expect.objectContaining({}) })],
    });
    const values = imported.database!.rows.map((row) => Object.values(row.properties));
    expect(values).toContainEqual(['Acoustic guitar', '9999', 'TRUE']);
    expect(refreshed).toHaveBeenCalledOnce();
    workspace.close();
    pages.close();
  });
});
