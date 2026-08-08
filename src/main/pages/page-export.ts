import { writeFile } from 'node:fs/promises';

import { BrowserWindow, dialog } from 'electron';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';

import type { PageDocumentSnapshot, PageJsonValue } from '../../shared/pages';

export async function exportNativePage(parent: BrowserWindow, document: PageDocumentSnapshot, format: 'pdf' | 'docx' | 'xlsx'): Promise<string | null> {
  if (document.page.kind === 'database' && format !== 'xlsx') throw new Error('Databases export as Excel workbooks.');
  if (document.page.kind === 'page' && format === 'xlsx') throw new Error('Pages export as PDF or Word documents.');
  const extension = format;
  const result = await dialog.showSaveDialog(parent, {
    title: `Export ${document.page.title}`,
    defaultPath: `${safeFilename(document.page.title)}.${extension}`,
    filters: [{ name: exportLabel(format), extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (format === 'xlsx') await exportDatabaseWorkbook(document, result.filePath);
  if (format === 'docx') await exportWord(document, result.filePath);
  if (format === 'pdf') await exportPdf(document, result.filePath);
  return result.filePath;
}

export async function exportDatabaseWorkbook(document: PageDocumentSnapshot, filePath: string): Promise<void> {
  const database = document.database!;
  const values = [
    database.properties.map((property) => property.name),
    ...database.rows.map((row) => database.properties.map((property) => cellValue(row.properties[property.id]))),
  ];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poppin Browser';
  workbook.addWorksheet('Database').addRows(values);
  await workbook.xlsx.writeFile(filePath);
}

async function exportWord(document: PageDocumentSnapshot, filePath: string): Promise<void> {
  const paragraphs = [
    new Paragraph({ children: [new TextRun({ text: document.page.title, bold: true, size: 36 })], spacing: { after: 320 } }),
    ...document.blocks.map((block) => new Paragraph({ children: [new TextRun(blockText(block.content))], spacing: { after: 180 } })),
  ];
  const output = new Document({ sections: [{ children: paragraphs }] });
  await writeFile(filePath, await Packer.toBuffer(output));
}

async function exportPdf(document: PageDocumentSnapshot, filePath: string): Promise<void> {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  try {
    const paragraphs = document.blocks.map((block) => `<p>${escapeHtml(blockText(block.content)).replaceAll('\n', '<br>')}</p>`).join('');
    const html = `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#25211d}h1{font-size:28px;border-bottom:2px solid #d88729;padding-bottom:12px}p{white-space:normal;overflow-wrap:anywhere}</style><h1>${escapeHtml(document.page.title)}</h1>${paragraphs || '<p></p>'}`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    await writeFile(filePath, pdf);
  } finally {
    window.destroy();
  }
}

function blockText(value: PageJsonValue): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string') return value.text;
  return '';
}

function cellValue(value: PageJsonValue | undefined): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  return JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function safeFilename(value: string): string {
  return (value.trim() || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100);
}

function exportLabel(format: 'pdf' | 'docx' | 'xlsx'): string {
  return format === 'pdf' ? 'PDF Document' : format === 'docx' ? 'Word Document' : 'Excel Workbook';
}
