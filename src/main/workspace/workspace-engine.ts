import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';

import { dialog, type BrowserWindow } from 'electron';

import {
  WORKSPACE_CHANNELS,
  type WorkspaceCommand,
  type WorkspaceCommandResult,
  type WorkspaceSnapshot,
} from '../../shared/workspace';
import { WorkspaceStore } from './workspace-store';
import { BrowserEngine } from '../browser/browser-engine';

const MAX_DOCUMENT_BYTES = 60_000;
const TEXT_DOCUMENT_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.htm', '.js', '.json', '.jsx', '.md', '.mjs', '.scss', '.text', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

export class WorkspaceEngine {
  constructor(
    private readonly window: BrowserWindow,
    private readonly store: WorkspaceStore,
    private readonly browser: BrowserEngine,
  ) {}

  getSnapshot(): WorkspaceSnapshot {
    return {
      workspace: this.store.getWorkspace(),
      documents: this.store.listDocuments(),
      tabContexts: this.store.listTabContexts(),
    };
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
      case 'setTabSelected':
        if (command.selected) return this.captureTab(command.tabId);
        this.store.removeTabContext(command.tabId);
        break;
      case 'refreshTabContext':
        return this.captureTab(command.tabId);
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

  private emitSnapshot(): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(WORKSPACE_CHANNELS.snapshot, this.getSnapshot());
    }
  }
}

async function captureDocument(filePath: string, sizeBytes: number): Promise<{ text: string | null; truncated: boolean }> {
  if (!TEXT_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return { text: null, truncated: false };
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
