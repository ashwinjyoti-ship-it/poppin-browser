// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { exportDatabaseWorkbook } from '../src/main/pages/page-export';
import type { PageDocumentSnapshot } from '../src/shared/pages';

describe('native Page export', () => {
  it('writes an Excel workbook with Database headers and values', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'poppin-export-'));
    const filePath = path.join(directory, 'inventory.xlsx');
    const document: PageDocumentSnapshot = {
      page: { id: 'db-1', title: 'Inventory', parentId: null, kind: 'database', createdAt: '', updatedAt: '' },
      blocks: [], comments: [], viewState: null,
      database: {
        properties: [
          { id: 'name', databaseId: 'db-1', name: 'Product', type: 'text', options: [], position: 0 },
          { id: 'price', databaseId: 'db-1', name: 'Price', type: 'number', options: [], position: 1 },
        ],
        rows: [{ id: 'row-1', databaseId: 'db-1', properties: { name: 'Acoustic guitar', price: 9999 }, position: 0, createdAt: '', updatedAt: '' }],
        views: [],
      },
    };

    await exportDatabaseWorkbook(document, filePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0]!;
    expect(worksheet.getRow(1).values).toEqual([undefined, 'Product', 'Price']);
    expect(worksheet.getRow(2).values).toEqual([undefined, 'Acoustic guitar', 9999]);
  });
});
