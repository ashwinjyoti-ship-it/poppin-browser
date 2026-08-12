import type { BrowserWindow } from 'electron';

import {
  POPPIN_PAD_CHANNELS,
  type PadAttachmentSnapshot,
  type PoppinPadCommand,
  type PoppinPadCommandResult,
  type PoppinPadSnapshot,
} from '../../shared/poppin-pad';
import { exportPadToMarkdown } from './pad-tandem-export';
import { PoppinPadStore } from './poppin-pad-store';

interface PoppinPadEngineOptions {
  exportToTandem?: (input: { title: string; markdown: string }) => Promise<{ pageId: string; opened: boolean }>;
}

export class PoppinPadEngine {
  constructor(
    private readonly window: BrowserWindow,
    private readonly store: PoppinPadStore,
    private readonly options: PoppinPadEngineOptions = {},
  ) {}

  getSnapshot(): PoppinPadSnapshot {
    return this.store.getSnapshot();
  }

  getAttachmentPayloads(): PadAttachmentSnapshot[] {
    return this.store.getPendingAttachments();
  }

  clearAttachments(): void {
    this.store.clearAttachments();
    this.emitSnapshot();
  }

  ingestBrowserSelection(payload: Parameters<PoppinPadStore['ingestBrowser']>[0]): PoppinPadCommandResult {
    try {
      this.store.ingestBrowser(payload);
      this.store.setCollapsed(false);
      this.emitSnapshot();
      return { ok: true, message: 'Added to Poppin Pad.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Poppin Pad could not capture that item.' };
    }
  }

  async execute(command: PoppinPadCommand): Promise<PoppinPadCommandResult> {
    try {
      switch (command.type) {
        case 'setCollapsed':
          this.store.setCollapsed(command.collapsed);
          break;
        case 'setWidth':
          this.store.setWidth(command.width);
          break;
        case 'setActive':
          this.store.setActive(command.active);
          break;
        case 'setTool':
          this.store.setTool(command.tool);
          break;
        case 'upsertObject':
          this.store.upsertObject(command.object);
          break;
        case 'deleteObject':
          this.store.deleteObject(command.objectId);
          break;
        case 'clearCanvas':
          this.store.clearCanvas(command.scope);
          break;
        case 'ingestDrop':
          this.store.ingestDrop(command.payload, command.x, command.y);
          this.store.setCollapsed(false);
          break;
        case 'ingestBrowser':
          this.store.ingestBrowser(command.payload);
          this.store.setCollapsed(false);
          break;
        case 'exportToTandem':
          return await this.exportToTandem(command.title);
        case 'queueAttachment':
          this.store.queueAttachment(command.objectId);
          break;
        case 'removeAttachment':
          this.store.removePendingAttachment(command.objectId);
          break;
        case 'clearAttachments':
          this.store.clearAttachments();
          break;
        default:
          return { ok: false, message: 'Unknown Poppin Pad command.' };
      }
      this.emitSnapshot();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Poppin Pad could not complete that action.' };
    }
  }

  private async exportToTandem(title?: string): Promise<PoppinPadCommandResult> {
    if (!this.options.exportToTandem) {
      return { ok: false, message: 'Tandem is not connected. Connect Tandem in Settings first.' };
    }
    const snapshot = this.store.getSnapshot();
    const exportTitle = title ?? `Poppin Pad — ${new Date().toLocaleString()}`;
    const markdown = exportPadToMarkdown(snapshot, exportTitle);
    const result = await this.options.exportToTandem({ title: exportTitle, markdown });
    return { ok: true, message: 'Exported to Tandem.', pageId: result.pageId };
  }

  private emitSnapshot(): void {
    if (this.window.isDestroyed()) return;
    this.window.webContents.send(POPPIN_PAD_CHANNELS.snapshot, this.getSnapshot());
  }
}
