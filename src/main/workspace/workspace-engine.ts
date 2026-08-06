import type { BrowserWindow } from 'electron';

import {
  WORKSPACE_CHANNELS,
  type WorkspaceCommand,
  type WorkspaceCommandResult,
  type WorkspaceSnapshot,
} from '../../shared/workspace';
import { WorkspaceStore } from './workspace-store';

export class WorkspaceEngine {
  constructor(
    private readonly window: BrowserWindow,
    private readonly store: WorkspaceStore,
  ) {}

  getSnapshot(): WorkspaceSnapshot {
    return { workspace: this.store.getWorkspace() };
  }

  execute(command: WorkspaceCommand): WorkspaceCommandResult {
    const name = command.name.trim();
    if (!name) return { ok: false, message: 'Give this workspace a name.' };
    if (name.length > 80) return { ok: false, message: 'Use a name under 80 characters.' };

    if (command.type === 'createWorkspace') {
      if (this.store.getWorkspace()) return { ok: false, message: 'Poppin supports one workspace.' };
      this.store.createWorkspace(name);
    } else {
      if (!this.store.getWorkspace()) return { ok: false, message: 'Create the workspace first.' };
      this.store.renameWorkspace(name);
    }
    this.emitSnapshot();
    return { ok: true };
  }

  private emitSnapshot(): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(WORKSPACE_CHANNELS.snapshot, this.getSnapshot());
    }
  }
}
