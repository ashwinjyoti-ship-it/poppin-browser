import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, dialog, type BrowserWindow } from 'electron';

import type {
  ContinuityCommand,
  ContinuityCommandResult,
  ContinuitySnapshot,
} from '../../shared/continuity';
import { CONTINUITY_FILE_EXTENSION } from '../../shared/continuity';
import type { BrowserEngine } from '../browser/browser-engine';
import { BrowserStateStore } from '../browser/state-store';
import { DEFAULT_WINDOW_STATE } from '../browser/window-state';
import type { WorkspaceStore } from '../workspace/workspace-store';
import type { WorkspaceEngine } from '../workspace/workspace-engine';
import type { TandemEngine } from '../tandem/tandem-engine';
import {
  buildContinuityPayload,
  continuityToPersistedBrowserState,
  continuityWorkspaceApplyPlan,
  parseContinuityPayload,
} from './payload';
import { ProfileStore } from './profile-store';
import { openContinuityPayload, sealContinuityPayload } from './seal';

export class ContinuityEngine {
  constructor(
    private readonly profileStore: ProfileStore,
    private readonly getBrowserEngine: () => BrowserEngine | null,
    private readonly getWorkspaceStore: () => WorkspaceStore | null,
    private readonly getWorkspaceEngine: () => WorkspaceEngine | null,
    private readonly getTandemEngine: () => TandemEngine | null,
    private readonly getDataRoot: () => string,
    private readonly getParentWindow: () => BrowserWindow | null,
  ) {}

  async getSnapshot(): Promise<ContinuitySnapshot> {
    return this.profileStore.getSnapshot(await this.profileStore.load());
  }

  async execute(command: ContinuityCommand): Promise<ContinuityCommandResult> {
    try {
      switch (command.type) {
        case 'createProfile':
          return await this.createProfile(command.name);
        case 'renameProfile':
          return await this.renameProfile(command.profileId, command.name);
        case 'switchProfile':
          return await this.switchProfile(command.profileId);
        case 'exportContinuity':
          return await this.exportContinuity(command.passphrase);
        case 'importContinuity':
          return await this.importContinuity(command.passphrase);
        default:
          return { ok: false, message: 'Unknown continuity command.' };
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Continuity action failed.' };
    }
  }

  private async createProfile(name: string): Promise<ContinuityCommandResult> {
    const sourceRoot = this.getDataRoot();
    const { profile } = await this.profileStore.createProfile(name);
    await copyStateTree(sourceRoot, this.profileStore.profileDataRoot(profile.id));
    scheduleRelaunch();
    return {
      ok: true,
      message: `Profile “${profile.name}” is ready. Poppin is restarting to use it.`,
      relaunching: true,
    };
  }

  private async renameProfile(profileId: string, name: string): Promise<ContinuityCommandResult> {
    const registry = await this.profileStore.renameProfile(profileId, name);
    const profile = registry.profiles.find((entry) => entry.id === profileId);
    return { ok: true, message: profile ? `Renamed profile to “${profile.name}”.` : 'Profile renamed.' };
  }

  private async switchProfile(profileId: string): Promise<ContinuityCommandResult> {
    const registry = await this.profileStore.switchProfile(profileId);
    const profile = registry.profiles.find((entry) => entry.id === profileId);
    scheduleRelaunch();
    return {
      ok: true,
      message: profile ? `Switching to “${profile.name}”…` : 'Switching profile…',
      relaunching: true,
    };
  }

  private async exportContinuity(passphrase: string): Promise<ContinuityCommandResult> {
    const registry = await this.profileStore.load();
    const snapshot = this.profileStore.getSnapshot(registry);
    if (!snapshot.activeProfile) {
      return { ok: false, message: 'Create a Poppin profile before exporting continuity.' };
    }
    const browser = this.getBrowserEngine()?.getSnapshot();
    const workspaceStore = this.getWorkspaceStore();
    const workspaceEngine = this.getWorkspaceEngine();
    if (!browser || !workspaceStore || !workspaceEngine) {
      return { ok: false, message: 'Poppin is not ready to export continuity yet.' };
    }

    const workspace = workspaceEngine.getSnapshot();
    const payload = buildContinuityPayload({
      profile: snapshot.activeProfile,
      browser,
      workspaceName: workspace.workspace?.name ?? null,
      contextPacks: workspaceStore.listContextPacks(),
      browserSessions: workspaceStore.listBrowserSessions(),
      recipes: workspaceStore.listRecipes(),
      tabContexts: workspaceStore.listTabContexts(),
      tandemPages: this.getTandemEngine()?.getSelectedContext() ?? [],
      memorySelected: workspaceStore.isMemorySelected(),
      mailInboxUrl: workspace.mailInboxUrl ?? null,
      mailSkills: workspace.mailSkills ?? [],
    });

    const sealed = sealContinuityPayload(JSON.stringify(payload), passphrase);
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showSaveDialog(parent, saveDialogOptions(snapshot.activeProfile.name))
      : await dialog.showSaveDialog(saveDialogOptions(snapshot.activeProfile.name));
    if (result.canceled || !result.filePath) return { ok: false, message: 'Export cancelled.' };

    await writeFile(result.filePath, sealed);
    return {
      ok: true,
      message: 'Continuity package saved. Website logins stay on this Mac and are not included.',
    };
  }

  private async importContinuity(passphrase: string): Promise<ContinuityCommandResult> {
    const registry = await this.profileStore.load();
    const snapshot = this.profileStore.getSnapshot(registry);
    if (!snapshot.activeProfile) {
      return { ok: false, message: 'Create a Poppin profile before importing continuity.' };
    }

    const parent = this.getParentWindow();
    const open = parent
      ? await dialog.showOpenDialog(parent, openDialogOptions())
      : await dialog.showOpenDialog(openDialogOptions());
    if (open.canceled || !open.filePaths[0]) return { ok: false, message: 'Import cancelled.' };

    const confirm = parent
      ? await dialog.showMessageBox(parent, confirmImportOptions())
      : await dialog.showMessageBox(confirmImportOptions());
    if (confirm.response !== 1) return { ok: false, message: 'Import cancelled.' };

    const sealed = await readFile(open.filePaths[0]);
    const payload = parseContinuityPayload(openContinuityPayload(sealed, passphrase));

    const dataRoot = this.getDataRoot();
    const stateStore = new BrowserStateStore(dataRoot);
    const current = await stateStore.load();
    const window = current?.window ?? DEFAULT_WINDOW_STATE;
    await stateStore.save(continuityToPersistedBrowserState(payload, window));

    const workspaceStore = this.getWorkspaceStore();
    if (!workspaceStore) return { ok: false, message: 'Workspace is not ready.' };
    workspaceStore.replaceContinuityData(continuityWorkspaceApplyPlan(payload));

    scheduleRelaunch();
    return {
      ok: true,
      message: 'Continuity imported. Poppin is restarting. Website logins were not imported.',
      relaunching: true,
    };
  }
}

function saveDialogOptions(profileName: string) {
  const slug = profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
  return {
    title: 'Export Poppin continuity',
    defaultPath: `poppin-${slug}.${CONTINUITY_FILE_EXTENSION}`,
    filters: [{ name: 'Poppin continuity', extensions: [CONTINUITY_FILE_EXTENSION] }],
  };
}

function openDialogOptions() {
  return {
    title: 'Import Poppin continuity',
    properties: ['openFile' as const],
    filters: [{ name: 'Poppin continuity', extensions: [CONTINUITY_FILE_EXTENSION] }],
  };
}

function confirmImportOptions() {
  return {
    type: 'warning' as const,
    buttons: ['Cancel', 'Import'],
    defaultId: 1,
    cancelId: 0,
    title: 'Import continuity?',
    message: 'Replace tabs, workspace selections, recipes, and browser settings on this profile?',
    detail: 'Your work and settings follow. Website logins stay on each Mac. Agent Tabs and the active task are not imported.',
  };
}

async function copyStateTree(fromRoot: string, toRoot: string): Promise<void> {
  if (path.resolve(fromRoot) === path.resolve(toRoot)) return;
  for (const name of ['browser-state.json', 'poppin.sqlite', 'poppin.sqlite-wal', 'poppin.sqlite-shm']) {
    await copyIfExists(path.join(fromRoot, name), path.join(toRoot, name));
  }
}

async function copyIfExists(from: string, to: string): Promise<void> {
  try {
    await access(from);
    await copyFile(from, to);
  } catch {
    // Source missing — fine for a fresh install.
  }
}

function scheduleRelaunch(): void {
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 250);
}
