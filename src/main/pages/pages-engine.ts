import type { BrowserWindow } from 'electron';

import {
  PAGES_CHANNELS,
  type PagesCommand,
  type PagesCommandResult,
  type PagesSnapshot,
} from '../../shared/pages';
import { PagesStore } from './pages-store';
import { exportNativePage } from './page-export';

export class PagesEngine {
  constructor(
    private readonly window: BrowserWindow,
    private readonly store: PagesStore,
    private readonly onChanged?: () => void,
  ) {}

  getSnapshot(): PagesSnapshot {
    return {
      pages: this.store.listPages(),
      tabs: this.store.listTabs(),
      activeTabId: this.store.getActiveTabId(),
      selectedPageIds: this.store.listSelectedPageIds(),
    };
  }

  getPage(pageId: string) {
    return this.store.getPage(pageId);
  }

  refresh(): void {
    this.emitSnapshot();
    this.onChanged?.();
  }

  async exportPage(pageId: string, format: 'pdf' | 'docx' | 'xlsx'): Promise<PagesCommandResult> {
    try {
      const document = this.store.getPage(pageId);
      if (!document) return { ok: false, message: 'Page not found.' };
      const filePath = await exportNativePage(this.window, document, format);
      return filePath ? { ok: true, message: `Exported to ${filePath}` } : { ok: true, message: 'Export cancelled.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Poppin could not export this item.' };
    }
  }

  execute(command: PagesCommand): PagesCommandResult {
    try {
      let id: string | undefined;
      switch (command.type) {
        case 'createPage':
          id = this.store.createPage(command).id;
          this.store.openPage(id);
          break;
        case 'openMemory':
          id = this.store.openMemory().id;
          break;
        case 'renamePage':
          id = this.store.renamePage(command.pageId, command.title).id;
          break;
        case 'movePage':
          id = this.store.movePage(command.pageId, command.parentId).id;
          break;
        case 'deletePage':
          this.store.deletePage(command.pageId);
          id = command.pageId;
          break;
        case 'openPage':
          id = this.store.openPage(command.pageId).id;
          break;
        case 'activateTab':
          this.store.activateTab(command.tabId);
          id = command.tabId;
          break;
        case 'deactivateTabs':
          this.store.deactivateTabs();
          break;
        case 'closeTab':
          this.store.closeTab(command.tabId);
          id = command.tabId;
          break;
        case 'reorderTab':
          this.store.reorderTab(command.tabId, command.beforeTabId);
          id = command.tabId;
          break;
        case 'setPageSelected':
          this.store.setPageSelected(command.pageId, command.selected);
          id = command.pageId;
          break;
        case 'addBlock':
          id = this.store.addBlock({
            pageId: command.pageId, type: command.blockType, content: command.content, position: command.position,
          }).id;
          break;
        case 'updateBlock':
          id = this.store.updateBlock(command.blockId, command.expectedVersion, command.content).id;
          break;
        case 'addComment':
          id = this.store.addComment(command).id;
          break;
        case 'resolveComment':
          id = this.store.resolveComment(command.commentId).id;
          break;
        case 'applyComment':
          id = this.store.applyComment(command.commentId, command.replacement).id;
          break;
        case 'addDatabaseProperty':
          id = this.store.addDatabaseProperty(command.databaseId, {
            name: command.name, type: command.propertyType, options: command.options, position: command.position,
          }).id;
          break;
        case 'addDatabaseRow':
          id = this.store.addDatabaseRow(command.databaseId, command.properties, { position: command.position }).id;
          break;
        case 'updateDatabaseRow':
          id = this.store.updateDatabaseRow(command.rowId, command.properties).id;
          break;
        case 'deleteDatabaseRow':
          this.store.deleteDatabaseRow(command.rowId);
          id = command.rowId;
          break;
        case 'addDatabaseView':
          id = this.store.addDatabaseView(command.databaseId, command).id;
          break;
        case 'saveViewState':
          id = this.store.saveViewState(command.pageId, command.state).pageId;
          break;
        case 'appendMemory':
          id = this.store.appendMemory(command.markdown).id;
          break;
      }
      this.emitSnapshot();
      this.onChanged?.();
      return { ok: true, ...(id ? { id } : {}) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Poppin could not update Pages.' };
    }
  }

  private emitSnapshot(): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(PAGES_CHANNELS.snapshot, this.getSnapshot());
    }
  }
}
