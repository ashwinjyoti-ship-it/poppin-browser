import type { BrowserWindow } from 'electron';

import {
  PAGES_CHANNELS,
  type PagesCommand,
  type PagesCommandResult,
  type PagesSnapshot,
} from '../../shared/pages';
import { PagesStore } from './pages-store';

export class PagesEngine {
  constructor(
    private readonly window: BrowserWindow,
    private readonly store: PagesStore,
  ) {}

  getSnapshot(): PagesSnapshot {
    return { pages: this.store.listPages() };
  }

  getPage(pageId: string) {
    return this.store.getPage(pageId);
  }

  execute(command: PagesCommand): PagesCommandResult {
    try {
      let id: string | undefined;
      switch (command.type) {
        case 'createPage':
          id = this.store.createPage(command).id;
          break;
        case 'renamePage':
        case 'movePage':
        case 'deletePage':
          return { ok: false, message: 'Page organization commands are not available until the native tree lands.' };
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
        case 'addDatabaseProperty':
          id = this.store.addDatabaseProperty(command.databaseId, {
            name: command.name, type: command.propertyType, options: command.options, position: command.position,
          }).id;
          break;
        case 'addDatabaseRow':
          id = this.store.addDatabaseRow(command.databaseId, command.properties, { position: command.position }).id;
          break;
        case 'addDatabaseView':
          id = this.store.addDatabaseView(command.databaseId, command).id;
          break;
        case 'saveViewState':
          id = this.store.saveViewState(command.pageId, command.state).pageId;
          break;
      }
      this.emitSnapshot();
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
