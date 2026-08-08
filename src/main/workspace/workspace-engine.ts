import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';

import { dialog, type BrowserWindow } from 'electron';
import ExcelJS from 'exceljs';

import {
  WORKSPACE_CHANNELS,
  type WorkspaceCommand,
  type WorkspaceCommandResult,
  type WorkspaceSnapshot,
} from '../../shared/workspace';
import { WorkspaceStore } from './workspace-store';
import { BrowserEngine } from '../browser/browser-engine';
import { GitEngine } from '../project/git-engine';
import { PagesStore } from '../pages/pages-store';
import { selectedPageContexts } from '../pages/page-context';

const MAX_DOCUMENT_BYTES = 60_000;
const TEXT_DOCUMENT_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.htm', '.js', '.json', '.jsx', '.md', '.mjs', '.scss', '.text', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const EXCEL_DOCUMENT_EXTENSIONS = new Set(['.xlsx']);
const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
const MAX_DATABASE_IMPORT_ROWS = 5_000;
const MAX_DATABASE_IMPORT_COLUMNS = 100;

export class WorkspaceEngine {
  constructor(
    private readonly window: BrowserWindow,
    private readonly store: WorkspaceStore,
    private readonly browser: BrowserEngine,
    private readonly git: GitEngine,
    private readonly pagesStore?: PagesStore,
    private readonly onPagesChanged?: () => void,
  ) {}

  getSnapshot(): WorkspaceSnapshot {
    return {
      workspace: this.store.getWorkspace(),
      documents: this.store.listDocuments(),
      tabContexts: this.store.listTabContexts(),
      project: this.store.getProject(),
      visualSelection: this.store.getVisualSelection(),
      pageContexts: this.pagesStore ? selectedPageContexts(this.pagesStore) : [],
    };
  }

  updateTabContextFromAgent(tabId: string, capturedText: string): boolean {
    const existing = this.store.listTabContexts().find((context) => context.tabId === tabId);
    if (!existing) return false;
    const normalized = capturedText.replace(/\r\n/g, '\n').trim();
    this.store.upsertTabContext({
      ...existing,
      capturedText: normalized.slice(0, MAX_DOCUMENT_BYTES),
      truncated: normalized.length > MAX_DOCUMENT_BYTES,
      capturedAt: new Date().toISOString(),
    });
    this.emitSnapshot();
    return true;
  }

  async execute(command: WorkspaceCommand): Promise<WorkspaceCommandResult> {
    if (command.type === 'createWorkspace' || command.type === 'renameWorkspace') {
      return this.changeWorkspaceName(command.type, command.name);
    }

    if (!this.store.getWorkspace()) return { ok: false, message: 'Create the workspace first.' };
    switch (command.type) {
      case 'chooseDocuments':
        return this.chooseDocuments();
      case 'removeDocument':
        this.store.removeDocument(command.documentId);
        break;
      case 'setDocumentSelected':
        return this.setDocumentSelected(command.documentId, command.selected);
      case 'openDocumentAsDatabase':
        return this.openDocumentAsDatabase(command.documentId);
      case 'setTabSelected':
        if (command.selected) return this.captureTab(command.tabId);
        this.store.removeTabContext(command.tabId);
        break;
      case 'refreshTabContext':
        return this.captureTab(command.tabId);
      case 'captureVisualSelection':
        return this.captureVisualSelection(command.tabId);
      case 'clearVisualSelection':
        this.store.clearVisualSelection();
        break;
      case 'connectExistingProject':
        return this.connectExistingProject();
      case 'cloneRepository':
        return this.cloneRepository(command.remote);
      case 'createNewProject':
        return this.createNewProject();
      case 'updateProjectSettings':
        return this.updateProjectSettings(command);
    }
    this.emitSnapshot();
    return { ok: true };
  }

  private changeWorkspaceName(type: 'createWorkspace' | 'renameWorkspace', rawName: string): WorkspaceCommandResult {
    const name = rawName.trim();
    if (!name) return { ok: false, message: 'Give this workspace a name.' };
    if (name.length > 80) return { ok: false, message: 'Use a name under 80 characters.' };
    if (type === 'createWorkspace') {
      if (this.store.getWorkspace()) return { ok: false, message: 'Poppin supports one workspace.' };
      this.store.createWorkspace(name);
    } else {
      if (!this.store.getWorkspace()) return { ok: false, message: 'Create the workspace first.' };
      this.store.renameWorkspace(name);
    }
    this.emitSnapshot();
    return { ok: true };
  }

  private async chooseDocuments(): Promise<WorkspaceCommandResult> {
    const result = await dialog.showOpenDialog(this.window, {
      title: 'Add documents to workspace',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return { ok: true };
    for (const filePath of result.filePaths) {
      const metadata = await stat(filePath).catch(() => null);
      if (!metadata?.isFile()) continue;
      this.store.upsertDocument({
        id: randomUUID(),
        name: path.basename(filePath),
        path: filePath,
        sizeBytes: metadata.size,
        capturedText: null,
        truncated: false,
      });
    }
    this.emitSnapshot();
    return { ok: true };
  }

  private async setDocumentSelected(documentId: string, selected: boolean): Promise<WorkspaceCommandResult> {
    const document = this.store.listDocuments().find((candidate) => candidate.id === documentId);
    if (!document) return { ok: false, message: 'That document is no longer available.' };
    if (!selected) {
      this.store.setDocumentContext(documentId, false, null, false);
      this.emitSnapshot();
      return { ok: true };
    }
    const capture = await captureDocument(document.path, document.sizeBytes);
    this.store.setDocumentContext(documentId, true, capture.text, capture.truncated);
    this.emitSnapshot();
    return { ok: true };
  }

  private async openDocumentAsDatabase(documentId: string): Promise<WorkspaceCommandResult> {
    if (!this.pagesStore) return { ok: false, message: 'Native Databases are not ready.' };
    const document = this.store.listDocuments().find((candidate) => candidate.id === documentId);
    if (!document) return { ok: false, message: 'Document not found.' };
    if (!EXCEL_DOCUMENT_EXTENSIONS.has(path.extname(document.path).toLowerCase())) return { ok: false, message: 'Only .xlsx workbooks can open as Databases.' };
    try {
      const matrix = await readWorkbookMatrix(document.path, document.sizeBytes);
      const title = path.basename(document.name, path.extname(document.name));
      this.pagesStore.runInTransaction((store) => {
        const database = store.createPage({ title: title || 'Imported workbook', kind: 'database' });
        const headers = uniqueHeaders(matrix[0] ?? []);
        const properties = headers.map((name) => store.addDatabaseProperty(database.id, { name, type: 'text' }));
        for (const values of matrix.slice(1, MAX_DATABASE_IMPORT_ROWS + 1)) {
          const row = Object.fromEntries(properties.map((property, index) => [property.id, values[index] ?? '']));
          store.addDatabaseRow(database.id, row);
        }
        store.addDatabaseView(database.id, { name: 'Table', viewType: 'table' });
        store.openPage(database.id);
      });
      this.onPagesChanged?.();
      return { ok: true, message: 'Workbook opened as an editable native Database.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Poppin could not import this workbook.' };
    }
  }

  private async captureTab(tabId: string): Promise<WorkspaceCommandResult> {
    const captured = await this.browser.captureTabContext(tabId);
    if (!captured) return { ok: false, message: 'Poppin could not capture that page.' };
    this.store.upsertTabContext({
      tabId,
      title: captured.title,
      url: captured.url,
      capturedText: captured.text,
      truncated: captured.truncated,
      capturedAt: new Date().toISOString(),
    });
    this.emitSnapshot();
    return { ok: true };
  }

  private async captureVisualSelection(tabId: string): Promise<WorkspaceCommandResult> {
    try {
      const selection = await this.browser.captureVisualSelection(tabId);
      if (!selection) return { ok: false, message: 'Visual selection was cancelled or timed out.' };
      this.store.saveVisualSelection(selection);
      this.emitSnapshot();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Poppin could not capture that element.' };
    }
  }

  private async connectExistingProject(): Promise<WorkspaceCommandResult> {
    const directory = await this.chooseDirectory('Connect existing local Git project');
    if (!directory) return { ok: true };
    return this.runGitOperation(() => this.git.inspect(directory));
  }

  private async cloneRepository(remote: string): Promise<WorkspaceCommandResult> {
    const parent = await this.chooseDirectory('Choose where to clone the repository');
    if (!parent) return { ok: true };
    return this.runGitOperation(() => this.git.clone(remote, parent));
  }

  private async createNewProject(): Promise<WorkspaceCommandResult> {
    const directory = await this.chooseDirectory('Choose or create an empty project folder', true);
    if (!directory) return { ok: true };
    return this.runGitOperation(() => this.git.create(directory));
  }

  private updateProjectSettings(command: Extract<WorkspaceCommand, { type: 'updateProjectSettings' }>): WorkspaceCommandResult {
    const project = this.store.getProject();
    if (!project) return { ok: false, message: 'Connect a project first.' };
    const previewUrl = normalizePreviewUrl(command.previewUrl);
    if (!previewUrl) return { ok: false, message: 'Use a valid HTTP preview URL.' };
    this.store.saveProject({
      ...project,
      installCommand: command.installCommand.trim(),
      devCommand: command.devCommand.trim(),
      previewUrl,
    });
    this.emitSnapshot();
    return { ok: true };
  }

  private async chooseDirectory(title: string, createDirectory = false): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.window, {
      title,
      properties: createDirectory ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  private async runGitOperation(operation: () => Promise<import('../../shared/workspace').WorkspaceProjectSnapshot>): Promise<WorkspaceCommandResult> {
    try {
      this.store.saveProject(await operation());
      this.emitSnapshot();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Git could not complete that operation.' };
    }
  }

  private emitSnapshot(): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(WORKSPACE_CHANNELS.snapshot, this.getSnapshot());
    }
  }

  refreshPageContexts(): void {
    this.emitSnapshot();
  }
}

function normalizePreviewUrl(input: string): string | null {
  try {
    const value = input.trim();
    const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

async function captureDocument(filePath: string, sizeBytes: number): Promise<{ text: string | null; truncated: boolean }> {
  const extension = path.extname(filePath).toLowerCase();
  if (EXCEL_DOCUMENT_EXTENSIONS.has(extension)) {
    const workbook = await readWorkbook(filePath, sizeBytes);
    const text = workbook.worksheets.map((sheet) => {
      const csv = worksheetMatrix(sheet).map((row) => row.map(csvCell).join(',')).join('\n');
      return `# Sheet: ${sheet.name}\n${csv}`;
    }).join('\n\n').trim();
    return { text: text.slice(0, MAX_DOCUMENT_BYTES), truncated: text.length > MAX_DOCUMENT_BYTES };
  }
  if (!TEXT_DOCUMENT_EXTENSIONS.has(extension)) return { text: null, truncated: false };
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(MAX_DOCUMENT_BYTES + 1, Math.max(1, sizeBytes)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8').replace(/\r\n/g, '\n').trim();
    return { text: text.slice(0, MAX_DOCUMENT_BYTES), truncated: sizeBytes > MAX_DOCUMENT_BYTES || text.length > MAX_DOCUMENT_BYTES };
  } finally {
    await handle.close();
  }
}

async function readWorkbook(filePath: string, sizeBytes: number): Promise<ExcelJS.Workbook> {
  if (sizeBytes > MAX_WORKBOOK_BYTES) throw new Error('Workbook is larger than the 20 MB local import limit.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

async function readWorkbookMatrix(filePath: string, sizeBytes: number): Promise<string[][]> {
  const workbook = await readWorkbook(filePath, sizeBytes);
  const first = workbook.worksheets[0];
  if (!first) throw new Error('Workbook has no readable worksheets.');
  return worksheetMatrix(first);
}

function worksheetMatrix(worksheet: ExcelJS.Worksheet): string[][] {
  const matrix: string[][] = [];
  const lastRow = Math.min(worksheet.rowCount, MAX_DATABASE_IMPORT_ROWS + 1);
  for (let rowIndex = 1; rowIndex <= lastRow; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const width = Math.min(row.cellCount, MAX_DATABASE_IMPORT_COLUMNS);
    const values = Array.from({ length: width }, (_, index) => excelCellText(row.getCell(index + 1)));
    if (values.some(Boolean)) matrix.push(values);
  }
  return matrix;
}

function excelCellText(cell: ExcelJS.Cell): string {
  if (typeof cell.value === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
  return cell.text;
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function uniqueHeaders(values: string[]): string[] {
  const used = new Map<string, number>();
  return (values.length ? values : ['Name']).slice(0, MAX_DATABASE_IMPORT_COLUMNS).map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}
