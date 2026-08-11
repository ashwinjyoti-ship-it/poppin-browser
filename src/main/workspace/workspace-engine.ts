import { randomUUID } from 'node:crypto';
import { access, open, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { dialog, type BrowserWindow } from 'electron';
import ExcelJS from 'exceljs';

import {
  WORKSPACE_CHANNELS,
  type BrowserSessionSnapshot,
  type ContextPackSnapshot,
  type RecipeSnapshot,
  type RecipeStepSnapshot,
  type WorkspaceCommand,
  type WorkspaceCommandResult,
  type WorkspaceSnapshot,
} from '../../shared/workspace';
import { recipeStartUrl, sanitizeRecipeSteps } from '../../shared/recipes';
import { parseProjectSource, repositoryFolderName } from '../../shared/project-source';
import { WorkspaceStore } from './workspace-store';
import { BrowserEngine } from '../browser/browser-engine';
import { GitEngine } from '../project/git-engine';
import { PagesStore } from '../pages/pages-store';
import { memoryBrief, selectedPageContexts } from '../pages/page-context';

const MAX_DOCUMENT_BYTES = 60_000;
const TEXT_DOCUMENT_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.htm', '.js', '.json', '.jsx', '.md', '.mjs', '.scss', '.text', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const EXCEL_DOCUMENT_EXTENSIONS = new Set(['.xlsx']);
import type { TandemContextSnapshot } from '../../shared/tandem';

const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
const MAX_DATABASE_IMPORT_ROWS = 5_000;
const MAX_DATABASE_IMPORT_COLUMNS = 100;

export interface WorkspaceEngineOptions {
  pagesStore?: PagesStore;
  onPagesChanged?: () => void;
  /** Frozen Tandem pages the user checked into explicit context. */
  getTandemContexts?: () => TandemContextSnapshot[];
  /** Setter for the Tandem context selection so applyContextPack can reselect. */
  setTandemPageSelected?: (pageId: string, selected: boolean) => Promise<{ ok: boolean; message?: string }>;
}

export class WorkspaceEngine {
  constructor(
    private readonly window: BrowserWindow,
    private readonly store: WorkspaceStore,
    private readonly browser: BrowserEngine,
    private readonly git: GitEngine,
    private readonly options: WorkspaceEngineOptions = {},
  ) {}

  private get pagesStore(): PagesStore | undefined {
    return this.options.pagesStore;
  }

  private get onPagesChanged(): (() => void) | undefined {
    return this.options.onPagesChanged;
  }

  private get getTandemContexts(): (() => TandemContextSnapshot[]) | undefined {
    return this.options.getTandemContexts;
  }

  getSnapshot(): WorkspaceSnapshot {
    const memorySelected = this.store.isMemorySelected();
    return {
      workspace: this.store.getWorkspace(),
      documents: this.store.listDocuments(),
      tabContexts: this.store.listTabContexts(),
      project: this.store.getProject(),
      visualSelection: this.store.getVisualSelection(),
      pageContexts: this.pagesStore ? selectedPageContexts(this.pagesStore) : [],
      tandemContexts: this.getTandemContexts?.() ?? [],
      contextPacks: this.store.listContextPacks(),
      memorySelected,
      // Always surface the brief when Memory exists so the checkbox can be
      // enabled before the user opts it in; the UI only shows the preview when selected.
      memoryBrief: this.pagesStore ? memoryBrief(this.pagesStore) : null,
      browserSessions: this.store.listBrowserSessions(),
      recipes: this.store.listRecipes(),
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
      case 'addProject':
        return this.addProject(command.source);
      case 'chooseProjectFolder':
        return this.chooseProjectFolder();
      case 'updateProjectSettings':
        return this.updateProjectSettings(command);
      case 'setMemorySelected':
        return this.setMemorySelected(command.selected);
      case 'saveContextPack':
        return this.saveContextPack(command.name);
      case 'applyContextPack':
        return await this.applyContextPack(command.packId);
      case 'renameContextPack':
        return this.renameContextPack(command.packId, command.name);
      case 'deleteContextPack':
        return this.deleteContextPack(command.packId);
      case 'saveBrowserSession':
        return this.saveBrowserSession(command.name);
      case 'openBrowserSession':
        return this.openBrowserSession(command.sessionId, command.mode);
      case 'renameBrowserSession':
        return this.renameBrowserSession(command.sessionId, command.name);
      case 'deleteBrowserSession':
        return this.deleteBrowserSession(command.sessionId);
      case 'saveRecipe':
        return this.saveRecipe(command.name, command.steps, command.startUrl);
      case 'renameRecipe':
        return this.renameRecipe(command.recipeId, command.name);
      case 'setRecipeEnabled':
        return this.setRecipeEnabled(command.recipeId, command.enabled);
      case 'deleteRecipe':
        return this.deleteRecipe(command.recipeId);
    }
    this.emitSnapshot();
    return { ok: true };
  }

  private setMemorySelected(selected: boolean): WorkspaceCommandResult {
    if (selected && !this.pagesStore) return { ok: false, message: 'Memory is not available in this environment.' };
    if (selected && !memoryBrief(this.pagesStore!)) {
      // The user must open Memory at least once so its OS-encrypted page exists
      // before it can be treated as inspectable context.
      return { ok: false, message: 'Open Memory once to initialize it before adding it to context.' };
    }
    this.store.setMemorySelected(selected);
    this.emitSnapshot();
    return { ok: true };
  }

  private saveContextPack(rawName: string): WorkspaceCommandResult {
    const name = rawName.trim();
    if (!name) return { ok: false, message: 'Give the context pack a name.' };
    if (name.length > 80) return { ok: false, message: 'Use a name under 80 characters.' };
    const tabRefs = this.store.listTabContexts().map((context) => ({
      url: context.url,
      title: context.title,
    }));
    const documentIds = this.store.listDocuments().filter((document) => document.selected).map((document) => document.id);
    const tandemPageIds = (this.getTandemContexts?.() ?? []).map((context) => context.pageId);
    const includeMemory = this.store.isMemorySelected();
    const pack: ContextPackSnapshot = {
      id: randomUUID(),
      name,
      tabRefs,
      documentIds,
      tandemPageIds,
      includeMemory,
      createdAt: new Date().toISOString(),
    };
    this.store.insertContextPack(pack);
    this.emitSnapshot();
    return { ok: true, message: `Saved context pack "${pack.name}".` };
  }

  private async applyContextPack(packId: string): Promise<WorkspaceCommandResult> {
    const pack = this.store.getContextPack(packId);
    if (!pack) return { ok: false, message: 'That context pack is no longer available.' };
    const browserSnapshot = this.browser.getSnapshot();
    const packUrls = new Set(pack.tabRefs.map((ref) => ref.url));
    const openTabsByUrl = new Map(browserSnapshot.tabs.filter((tab) => !tab.taskSpaceId && !tab.surface).map((tab) => [tab.url, tab.id]));
    let matchedTabs = 0;
    for (const [url, tabId] of openTabsByUrl) {
      if (packUrls.has(url)) {
        const result = await this.captureTab(tabId);
        if (result.ok) matchedTabs += 1;
      }
    }
    const currentDocuments = new Map(this.store.listDocuments().map((document) => [document.id, document]));
    let matchedDocuments = 0;
    for (const documentId of pack.documentIds) {
      if (!currentDocuments.has(documentId)) continue;
      const result = await this.setDocumentSelected(documentId, true);
      if (result.ok) matchedDocuments += 1;
    }
    let matchedTandem = 0;
    if (this.options.setTandemPageSelected) {
      for (const pageId of pack.tandemPageIds) {
        const result = await this.options.setTandemPageSelected(pageId, true);
        if (result.ok) matchedTandem += 1;
      }
    }
    let memoryEnabled = false;
    if (pack.includeMemory) {
      const memoryResult = this.setMemorySelected(true);
      memoryEnabled = memoryResult.ok;
    }
    this.emitSnapshot();
    const parts = [
      `${matchedTabs}/${pack.tabRefs.length} tab${pack.tabRefs.length === 1 ? '' : 's'}`,
      `${matchedDocuments}/${pack.documentIds.length} document${pack.documentIds.length === 1 ? '' : 's'}`,
      `${matchedTandem}/${pack.tandemPageIds.length} Tandem page${pack.tandemPageIds.length === 1 ? '' : 's'}`,
      ...(pack.includeMemory ? [memoryEnabled ? 'Memory on' : 'Memory unavailable'] : []),
    ];
    return { ok: true, message: `Applied "${pack.name}" (${parts.join(', ')}).` };
  }

  private renameContextPack(packId: string, rawName: string): WorkspaceCommandResult {
    const name = rawName.trim();
    if (!name) return { ok: false, message: 'Give the pack a name.' };
    if (name.length > 80) return { ok: false, message: 'Use a name under 80 characters.' };
    if (!this.store.renameContextPack(packId, name)) return { ok: false, message: 'That pack is no longer available.' };
    this.emitSnapshot();
    return { ok: true };
  }

  private deleteContextPack(packId: string): WorkspaceCommandResult {
    if (!this.store.deleteContextPack(packId)) return { ok: false, message: 'That pack is no longer available.' };
    this.emitSnapshot();
    return { ok: true };
  }

  private saveBrowserSession(rawName?: string): WorkspaceCommandResult {
    const tabs = this.browser.listSaveableTabs();
    if (tabs.length === 0) return { ok: false, message: 'Open at least one web tab before saving a session.' };
    const trimmed = rawName?.trim() ?? '';
    if (trimmed.length > 80) return { ok: false, message: 'Use a name under 80 characters.' };
    const existing = this.store.listBrowserSessions();
    const defaultName = `Session ${existing.length + 1}`;
    const session: BrowserSessionSnapshot = {
      id: randomUUID(),
      name: trimmed || defaultName,
      tabs: tabs.map((tab) => ({ url: tab.url, title: tab.title, pinned: tab.pinned })),
      createdAt: new Date().toISOString(),
    };
    this.store.insertBrowserSession(session);
    this.emitSnapshot();
    return { ok: true, message: `Saved session "${session.name}" (${session.tabs.length} tab${session.tabs.length === 1 ? '' : 's'}).` };
  }

  private openBrowserSession(sessionId: string, mode: 'replace' | 'merge'): WorkspaceCommandResult {
    const session = this.store.getBrowserSession(sessionId);
    if (!session) return { ok: false, message: 'That session is no longer available.' };
    const { openedCount } = this.browser.openSessionTabs(session.tabs, mode);
    this.emitSnapshot();
    return { ok: true, message: `Opened ${openedCount} tab${openedCount === 1 ? '' : 's'} from "${session.name}".` };
  }

  private renameBrowserSession(sessionId: string, rawName: string): WorkspaceCommandResult {
    const name = rawName.trim();
    if (!name) return { ok: false, message: 'Give the session a name.' };
    if (name.length > 80) return { ok: false, message: 'Use a name under 80 characters.' };
    if (!this.store.renameBrowserSession(sessionId, name)) return { ok: false, message: 'That session is no longer available.' };
    this.emitSnapshot();
    return { ok: true };
  }

  private deleteBrowserSession(sessionId: string): WorkspaceCommandResult {
    if (!this.store.deleteBrowserSession(sessionId)) return { ok: false, message: 'That session is no longer available.' };
    this.emitSnapshot();
    return { ok: true };
  }

  private saveRecipe(rawName: string, steps: RecipeStepSnapshot[], startUrl?: string | null): WorkspaceCommandResult {
    const name = rawName.trim();
    if (!name) return { ok: false, message: 'Give the recipe a name.' };
    if (name.length > 80) return { ok: false, message: 'Use a name under 80 characters.' };
    // Re-sanitize in main so credential-looking steps cannot bypass the renderer.
    const safeSteps = sanitizeRecipeSteps(steps.map((step) => ({
      action: step.action,
      target: step.target,
      detail: step.detail,
      outcome: 'completed',
    })));
    if (!safeSteps || safeSteps.length < 2) {
      return { ok: false, message: 'Need at least two safe completed steps to save a recipe.' };
    }
    const now = new Date().toISOString();
    const recipe: RecipeSnapshot = {
      id: randomUUID(),
      name,
      startUrl: startUrl ?? recipeStartUrl(safeSteps),
      steps: safeSteps,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertRecipe(recipe);
    this.emitSnapshot();
    return { ok: true, message: `Saved recipe "${recipe.name}".` };
  }

  private renameRecipe(recipeId: string, rawName: string): WorkspaceCommandResult {
    const name = rawName.trim();
    if (!name) return { ok: false, message: 'Give the recipe a name.' };
    if (name.length > 80) return { ok: false, message: 'Use a name under 80 characters.' };
    if (!this.store.renameRecipe(recipeId, name)) return { ok: false, message: 'That recipe is no longer available.' };
    this.emitSnapshot();
    return { ok: true };
  }

  private setRecipeEnabled(recipeId: string, enabled: boolean): WorkspaceCommandResult {
    if (!this.store.setRecipeEnabled(recipeId, enabled)) return { ok: false, message: 'That recipe is no longer available.' };
    this.emitSnapshot();
    return { ok: true };
  }

  private deleteRecipe(recipeId: string): WorkspaceCommandResult {
    if (!this.store.deleteRecipe(recipeId)) return { ok: false, message: 'That recipe is no longer available.' };
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

  private async addProject(rawSource: string): Promise<WorkspaceCommandResult> {
    const parsed = parseProjectSource(rawSource);
    if (parsed.kind === 'invalid') return { ok: false, message: parsed.message };
    if (parsed.kind === 'remote') return this.cloneRemoteProject(parsed.remote);
    return this.runGitOperation(() => this.git.openLocal(expandLocalPath(parsed.path)));
  }

  private async chooseProjectFolder(): Promise<WorkspaceCommandResult> {
    const directory = await this.chooseDirectory('Choose a local Git project or an empty folder', true);
    if (!directory) return { ok: true };
    return this.runGitOperation(() => this.git.openLocal(directory));
  }

  private async cloneRemoteProject(remote: string): Promise<WorkspaceCommandResult> {
    while (true) {
      const parent = await this.chooseDirectory('Choose where to clone the repository', true);
      if (!parent) return { ok: true };

      let destination: string;
      try {
        destination = this.git.suggestedCloneDestination(parent, remote);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Poppin could not determine the repository folder name.' };
      }

      const folderName = repositoryFolderName(remote);
      if (await pathExists(destination)) {
        const choice = await dialog.showMessageBox(this.window, {
          type: 'warning',
          title: 'Folder already exists',
          message: `A folder named ${folderName} already exists in that location.`,
          detail: `${destination}\n\nConnect the existing checkout, choose another parent folder, or cancel.`,
          buttons: ['Connect existing', 'Choose another location', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
        });
        if (choice.response === 0) return this.runGitOperation(() => this.git.openLocal(destination));
        if (choice.response === 1) continue;
        return { ok: true };
      }

      const confirm = await dialog.showMessageBox(this.window, {
        type: 'question',
        title: 'Clone repository',
        message: `Clone into ${destination}?`,
        detail: `Remote: ${remote}\nDestination: ${destination}`,
        buttons: ['Clone', 'Choose another location', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });
      if (confirm.response === 0) return this.runGitOperation(() => this.git.clone(remote, destination));
      if (confirm.response === 1) continue;
      return { ok: true };
    }
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

  /** Re-emit after another engine updates the connected project checkout. */
  refreshProject(): void {
    this.emitSnapshot();
  }

  /** Called when Tandem context selection or freshness changes. */
  refreshTandemContexts(): void {
    this.emitSnapshot();
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

function expandLocalPath(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
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
