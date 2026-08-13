import path from 'node:path';

import { mkdir, writeFile } from 'node:fs/promises';

import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, session } from 'electron';

import {
  BROWSER_CHANNELS,
  DEFAULT_BROWSER_SETTINGS,
  type BrowserCommand,
  type WindowState,
} from '../shared/browser';
import { BrowserEngine } from './browser/browser-engine';
import { handleInternalPages, registerInternalScheme } from './browser/internal-pages';
import { BrowserStateStore } from './browser/state-store';
import { isAllowedBrowsingPermission } from './browser/permissions';
import { clampWindowState, DEFAULT_WINDOW_STATE } from './browser/window-state';
import { WORKSPACE_CHANNELS, type WorkspaceCommand } from '../shared/workspace';
import { WorkspaceEngine } from './workspace/workspace-engine';
import { WorkspaceStore } from './workspace/workspace-store';
import { GitEngine } from './project/git-engine';
import { TASK_CHANNELS, type TaskCommand } from '../shared/task';
import { TaskEngine } from './task/task-engine';
import { TaskStore } from './task/task-store';
import { BrowserAgentEngine } from './browser/browser-agent-engine';
import { BrowserAgentStateStore } from './browser/browser-agent-state-store';
import { BROWSER_AGENT_CHANNELS, type BrowserAgentCommand } from '../shared/browser-agent';
import { PreviewEngine } from './project/preview-engine';
import { showEditContextMenu } from './browser/context-menu';
import { PagesStore } from './pages/pages-store';
import { PagesEngine } from './pages/pages-engine';
import { PAGES_CHANNELS, type PagesCommand } from '../shared/pages';
import { querySelectedDatabase, selectedPageContexts } from './pages/page-context';
import { EMPTY_TANDEM_SNAPSHOT, TANDEM_CHANNELS, type TandemCommand } from '../shared/tandem';
import { TandemEngine } from './tandem/tandem-engine';
import { TandemCredentialStore } from './tandem/tandem-credentials';
import { executeTandemCapability } from './tandem/tandem-capability';
import { SettingsOverlayController } from './browser/settings-overlay-controller';
import { ContinuityEngine } from './continuity/continuity-engine';
import { ProfileStore } from './continuity/profile-store';
import {
  SETTINGS_OVERLAY_CHANNELS,
  type SettingsOverlayCommand,
} from '../shared/settings-overlay';
import {
  DOWNLOAD_CHANNELS,
  EMPTY_DOWNLOADS_SNAPSHOT,
  type DownloadsCommand,
} from '../shared/downloads';
import { DownloadManager } from './browser/downloads';
import { POPPIN_PAD_CHANNELS, EMPTY_POPPIN_PAD_SNAPSHOT, type PoppinPadCommand } from '../shared/poppin-pad';
import { PoppinPadStore } from './poppin-pad/poppin-pad-store';
import { PoppinPadEngine } from './poppin-pad/poppin-pad-engine';

registerInternalScheme();

// Require a real user gesture before sites can autoplay media. The page-level
// autoplay guard still pauses late-attaching players (YouTube); this blocks the
// common Chromium autoplay path up front.
app.commandLine.appendSwitch('autoplay-policy', 'user-gesture-required');

let mainWindow: BrowserWindow | null = null;
let browserEngine: BrowserEngine | null = null;
let downloadManager: DownloadManager | null = null;
let workspaceEngine: WorkspaceEngine | null = null;
let workspaceStore: WorkspaceStore | null = null;
let taskEngine: TaskEngine | null = null;
let taskStore: TaskStore | null = null;
let pagesStore: PagesStore | null = null;
let pagesEngine: PagesEngine | null = null;
let browserAgentEngine: BrowserAgentEngine | null = null;
let previewEngine: PreviewEngine | null = null;
let tandemEngine: TandemEngine | null = null;
let tandemCredentials: TandemCredentialStore | null = null;
let poppinPadStore: PoppinPadStore | null = null;
let poppinPadEngine: PoppinPadEngine | null = null;
let settingsOverlay: SettingsOverlayController | null = null;
let profileStore: ProfileStore | null = null;
let continuityEngine: ContinuityEngine | null = null;
let dataRootPath: string | null = null;
let continuitySnapshotCache: Awaited<ReturnType<ContinuityEngine['getSnapshot']>> | null = null;
const pendingExternalUrls: string[] = [];

function openExternalUrl(url: string): void {
  if (browserEngine) {
    browserEngine.openExternalUrl(url);
  } else {
    pendingExternalUrls.push(url);
  }
}

async function createWindow(): Promise<void> {
  const stateStore = new BrowserStateStore(dataRootPath ?? app.getPath('userData'));
  const persisted = await stateStore.load();
  const windowState = clampWindowState(
    persisted?.window ?? DEFAULT_WINDOW_STATE,
    screen.getAllDisplays().map((display) => display.workArea),
  );

  mainWindow = new BrowserWindow({
    ...windowState,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#f7f1e7',
    show: false,
    title: 'Poppin Browser',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 22, y: 24 },
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const browserSession = session.fromPartition('persist:poppin-browser', { cache: true });
  handleInternalPages(browserSession);
  const getWindowState = (): WindowState => {
    if (!mainWindow) return windowState;
    const normalBounds = mainWindow.getNormalBounds();
    return {
      ...normalBounds,
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
  };

  downloadManager = new DownloadManager(browserSession, () => mainWindow, (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(DOWNLOAD_CHANNELS.snapshot, snapshot);
    }
  });
  downloadManager.register();
  browserEngine = new BrowserEngine(mainWindow, browserSession, stateStore, getWindowState);
  if (!workspaceStore) throw new Error('Workspace storage is not ready.');
  const git = new GitEngine();
  previewEngine = new PreviewEngine();
  if (!tandemCredentials) throw new Error('Tandem credential storage is not ready.');
  tandemEngine = new TandemEngine(mainWindow, tandemCredentials, {
    openWorld: (url) => browserEngine?.openTandemWorld(url),
    closeWorld: () => browserEngine?.closeTandemWorld(),
    onContextChanged: () => workspaceEngine?.refreshTandemContexts(),
  });
  settingsOverlay = new SettingsOverlayController(
    mainWindow,
    SETTINGS_OVERLAY_WEBPACK_ENTRY,
    SETTINGS_OVERLAY_PRELOAD_WEBPACK_ENTRY,
    () => {
      const browser = browserEngine?.getSnapshot();
      return {
        browser: {
          settings: browser?.settings ?? { ...DEFAULT_BROWSER_SETTINGS },
          canReopenClosedTab: browser?.canReopenClosedTab ?? false,
        },
        tandem: tandemEngine?.getSnapshot() ?? EMPTY_TANDEM_SNAPSHOT,
        continuity: continuitySnapshotCache ?? {
          activeProfile: null,
          profiles: [],
          continuityReady: false,
        },
      };
    },
  );
  workspaceEngine = new WorkspaceEngine(
    mainWindow, workspaceStore, browserEngine, git,
    {
      ...(pagesStore ? { pagesStore } : {}),
      onPagesChanged: () => pagesEngine?.refresh(),
      getTandemContexts: () => tandemEngine?.getSelectedContext() ?? [],
      // applyContextPack reselects Tandem pages through the existing engine
      // rather than duplicating credential-bearing HTTP calls.
      setTandemPageSelected: async (pageId, selected) => {
        const result = await tandemEngine?.execute({ type: 'setPageSelected', pageId, selected });
        return result ?? { ok: false, message: 'Tandem is not connected.' };
      },
    },
  );
  browserEngine.setSaveSessionHandler(() => {
    void workspaceEngine?.execute({ type: 'saveBrowserSession' });
  });
  if (!pagesStore) throw new Error('Pages storage is not ready.');
  pagesEngine = new PagesEngine(mainWindow, pagesStore, () => workspaceEngine?.refreshPageContexts());
  if (!poppinPadStore) throw new Error('Poppin Pad storage is not ready.');
  poppinPadEngine = new PoppinPadEngine(mainWindow, poppinPadStore, {
    exportToTandem: async ({ title, markdown }) => {
      const provider = tandemEngine?.getProvider();
      if (!provider) throw new Error('Tandem is not connected. Connect Tandem in Settings first.');
      const workspaceId = tandemEngine?.getActiveWorkspaceId();
      if (!workspaceId) throw new Error('Pick an active Tandem workspace before exporting.');
      const page = await provider.createPage(workspaceId, title, null, 'canvas');
      await provider.writeMarkdown(page.id, markdown);
      tandemEngine?.openWorldForPage(page.id);
      return { pageId: page.id, opened: true };
    },
  });
  browserEngine.setPadIngestHandler((payload) => {
    poppinPadEngine?.ingestBrowserSelection(payload);
  });
  browserAgentEngine = new BrowserAgentEngine(mainWindow, browserEngine, (tabId, content) => {
    workspaceEngine?.updateTabContextFromAgent(tabId, content);
  }, new BrowserAgentStateStore(dataRootPath ?? app.getPath('userData')));
  if (!taskStore) throw new Error('Task storage is not ready.');
  const workDirectory = path.join(dataRootPath ?? app.getPath('userData'), 'task-output');
  await mkdir(workDirectory, { recursive: true });
  taskEngine = new TaskEngine(mainWindow, taskStore, workspaceStore, git, {
    workDirectory,
    onTaskEnded: (outcome) => {
      if (outcome === 'completed') browserAgentEngine?.complete();
      else void browserAgentEngine?.execute({ type: 'stop' });
    },
    onOpenPreview: async (project) => {
      await previewEngine?.start(project.repositoryPath, project.devCommand);
      browserEngine?.openExternalUrl(project.previewUrl);
    },
    onOpenExternal: (url) => {
      pagesStore?.deactivateTabs();
      pagesEngine?.refresh();
      browserEngine?.openExternalUrl(url);
    },
    onProjectUpdated: () => {
      workspaceEngine?.refreshProject();
    },
    onExportResult: async (task, format) => {
      if (!mainWindow) return null;
      const extension = format === 'markdown' ? 'md' : 'txt';
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save a new Poppin output artifact',
        defaultPath: `poppin-${task.kind}-result.${extension}`,
        filters: [{ name: format === 'markdown' ? 'Markdown' : 'Text', extensions: [extension] }],
      });
      if (result.canceled || !result.filePath) return null;
      const turns = task.turns?.length ? task.turns : [{ prompt: task.prompt, result: task.result }];
      const contents = turns.map((turn, index) => format === 'markdown'
        ? `## Turn ${index + 1}\n\n**Request**\n\n${turn.prompt}\n\n**Reply**\n\n${turn.result}`
        : `TURN ${index + 1}\nREQUEST\n${turn.prompt}\n\nREPLY\n${turn.result}`).join('\n\n---\n\n');
      await writeFile(result.filePath, `${contents}\n`, 'utf8');
      return result.filePath;
    },
    getBrowserAgentSnapshot: () => browserAgentEngine?.getSnapshot() ?? {
      state: 'idle', taskId: null, taskSpace: null, watching: false, allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null, log: [],
    },
    executeBrowserAgentCommand: async (command) => browserAgentEngine?.execute(command) ?? {
      ok: false, message: 'Controlled browser use is not ready.',
    },
    getPageContexts: () => pagesStore ? selectedPageContexts(pagesStore) : [],
    getTandemContexts: () => tandemEngine?.getSelectedContext() ?? [],
    getTandemAvailability: () => tandemEngine?.getAvailability() ?? { available: false, writable: false },
    // Agents reach Tandem through its REST API, never by automating Tandem World.
    executeTandemCapability: async (args) => executeTandemCapability({
      provider: () => tandemEngine?.getProvider() ?? null,
      workspaceId: () => tandemEngine?.getActiveWorkspaceId() ?? null,
      writable: () => tandemEngine?.getAvailability().writable ?? false,
      openInWorld: (pageId) => tandemEngine?.openWorldForPage(pageId),
    }, args),
    // The page the user is looking at. Lets the capability router tell
    // "act on this open page" apart from "go and research something".
    getActiveBrowsableTabId: () => {
      const snapshot = browserEngine?.getSnapshot();
      if (!snapshot) return null;
      const tab = snapshot.tabs.find((candidate) => candidate.id === snapshot.activeTabId);
      if (!tab || tab.taskSpaceId || !/^https?:\/\//i.test(tab.url)) return null;
      return tab.id;
    },
    getBrowsableTabs: () => (browserEngine?.getSnapshot().tabs ?? []).map((tab) => ({
      id: tab.id,
      url: tab.url,
      taskSpaceId: tab.taskSpaceId,
    })),
    querySelectedDatabase: (databaseId, limit) => {
      if (!pagesStore) throw new Error('Pages storage is not ready.');
      return querySelectedDatabase(pagesStore, databaseId, limit);
    },
    applyPageComment: (commentId, replacement) => {
      if (!pagesStore) throw new Error('Pages storage is not ready.');
      const allowed = pagesStore.listSelectedPageIds().some((pageId) => pagesStore?.getPage(pageId)?.comments.some((comment) => comment.id === commentId && comment.status === 'open'));
      if (!allowed) throw new Error('Select the Page containing this open instruction before applying it.');
      const comment = pagesStore.applyComment(commentId, replacement);
      pagesEngine?.refresh();
      return `Applied the anchored replacement and resolved comment ${comment.id}.`;
    },
    // Save-to-Memory appends the task result onto Poppin's OS-encrypted
    // Memory page — the same protected page that /openMemory ensures exists.
    saveResultToMemory: ({ title, markdown }) => {
      if (!pagesStore) throw new Error('Pages storage is not ready.');
      const tab = pagesStore.openMemory();
      const heading = `## ${title}\n\n_Saved ${new Date().toISOString()}_\n\n`;
      pagesStore.addBlock({ pageId: tab.pageId, type: 'paragraph', content: { text: `${heading}${markdown}` } });
      pagesEngine?.refresh();
      return { pageId: tab.pageId };
    },
    // Add-to-Tandem uses the connected Tandem provider so agents and this
    // action share one API path; humans only see Tandem World for review.
    addResultToTandem: async ({ mode, pageId, title, markdown }) => {
      const provider = tandemEngine?.getProvider();
      if (!provider) throw new Error('Tandem is not connected. Connect Tandem in Settings first.');
      const workspaceId = tandemEngine?.getActiveWorkspaceId();
      if (mode === 'append') {
        if (!pageId) throw new Error('Choose a Tandem page to append to.');
        await provider.appendMarkdown(pageId, `\n\n## ${title}\n\n${markdown}\n`);
        tandemEngine?.openWorldForPage(pageId);
        return { pageId, opened: true };
      }
      if (!workspaceId) throw new Error('Pick an active Tandem workspace before adding a page.');
      const page = await provider.createPage(workspaceId, title, null, 'page');
      await provider.writeMarkdown(page.id, `# ${title}\n\n${markdown}\n`);
      tandemEngine?.openWorldForPage(page.id);
      return { pageId: page.id, opened: true };
    },
    getPadAttachments: () => poppinPadEngine?.getAttachmentPayloads() ?? [],
    clearPadAttachments: () => poppinPadEngine?.clearAttachments(),
  });
  browserEngine.restore(persisted);
  void tandemEngine.initialize();
  await browserAgentEngine.restore();
  for (const url of pendingExternalUrls.splice(0)) openExternalUrl(url);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (browserEngine?.handleShortcut(input)) event.preventDefault();
  });
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (mainWindow) showEditContextMenu(mainWindow, mainWindow.webContents, params);
  });
  mainWindow.on('move', () => browserEngine?.scheduleSave());
  mainWindow.on('resize', () => browserEngine?.scheduleSave());
  mainWindow.on('maximize', () => browserEngine?.scheduleSave());
  mainWindow.on('unmaximize', () => browserEngine?.scheduleSave());
  mainWindow.on('enter-full-screen', () => browserEngine?.scheduleSave());
  mainWindow.on('leave-full-screen', () => browserEngine?.scheduleSave());
  mainWindow.on('closed', () => {
    const closingTaskEngine = taskEngine;
    settingsOverlay?.destroy();
    settingsOverlay = null;
    mainWindow = null;
    browserEngine = null;
    downloadManager = null;
    workspaceEngine = null;
    pagesEngine = null;
    taskEngine = null;
    browserAgentEngine = null;
    poppinPadEngine = null;
    void previewEngine?.stop();
    previewEngine = null;
    tandemEngine = null;
    void closingTaskEngine?.close();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
    if (windowState.isMaximized) mainWindow.maximize();
    if (windowState.isFullScreen) mainWindow.setFullScreen(true);
  });

  await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  void taskEngine?.initialize();
}

function isTrustedShellSender(sender: Electron.WebContents): boolean {
  return Boolean(mainWindow && sender === mainWindow.webContents);
}

function isTrustedSettingsSender(sender: Electron.WebContents): boolean {
  return isTrustedShellSender(sender) || Boolean(settingsOverlay?.isOverlaySender(sender));
}

app.whenReady().then(async () => {
  // Registers Poppin as an http/https handler candidate so it can be picked
  // from OS default-browser pickers (macOS Desktop & Dock settings, Windows
  // Default Apps, etc). Guarded to packaged builds so a dev run of Electron
  // itself never claims the system's default browser.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' },
        { role: 'delete' }, { role: 'selectAll' },
      ],
    },
    { role: 'windowMenu' },
  ]));
  profileStore = new ProfileStore(app.getPath('userData'));
  const profileRegistry = await profileStore.load();
  dataRootPath = profileStore.resolveDataRoot(profileRegistry);
  await mkdir(dataRootPath, { recursive: true });
  continuityEngine = new ContinuityEngine(
    profileStore,
    () => browserEngine,
    () => workspaceStore,
    () => workspaceEngine,
    () => tandemEngine,
    () => dataRootPath ?? app.getPath('userData'),
    () => mainWindow,
  );
  continuitySnapshotCache = await continuityEngine.getSnapshot();

  const sqlitePath = path.join(dataRootPath, 'poppin.sqlite');
  workspaceStore = new WorkspaceStore(sqlitePath);
  taskStore = new TaskStore(sqlitePath);
  tandemCredentials = new TandemCredentialStore(sqlitePath, {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (value) => safeStorage.decryptString(value),
  });
  pagesStore = new PagesStore(sqlitePath, {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (value) => safeStorage.decryptString(value),
  });
  poppinPadStore = new PoppinPadStore(sqlitePath);
  ipcMain.handle(BROWSER_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted browser snapshot request.');
    return browserEngine?.getSnapshot();
  });
  ipcMain.handle(BROWSER_CHANNELS.command, (event, command: BrowserCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted browser command.');
    return browserEngine?.execute(command) ?? { ok: false, message: 'Browser is not ready.' };
  });
  ipcMain.handle(DOWNLOAD_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted downloads snapshot request.');
    return downloadManager?.getSnapshot() ?? EMPTY_DOWNLOADS_SNAPSHOT;
  });
  ipcMain.handle(DOWNLOAD_CHANNELS.command, (event, command: DownloadsCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted downloads command.');
    return downloadManager?.execute(command) ?? { ok: false, message: 'Downloads are not ready.' };
  });
  ipcMain.handle(WORKSPACE_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted workspace snapshot request.');
    return workspaceEngine?.getSnapshot() ?? {
      workspace: null,
      documents: [],
      tabContexts: [],
      project: null,
      visualSelection: null,
      contextPacks: [],
      memorySelected: false,
      memoryBrief: null,
      browserSessions: [],
      recipes: [],
      mailInboxUrl: null,
      mailSkills: [],
    };
  });
  ipcMain.handle(WORKSPACE_CHANNELS.command, (event, command: WorkspaceCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted workspace command.');
    return workspaceEngine?.execute(command) ?? { ok: false, message: 'Workspace is not ready.' };
  });
  ipcMain.handle(PAGES_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted Pages snapshot request.');
    return pagesEngine?.getSnapshot() ?? { pages: [], tabs: [], activeTabId: null, selectedPageIds: [] };
  });
  ipcMain.handle(PAGES_CHANNELS.getPage, (event, pageId: string) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted Page request.');
    return pagesEngine?.getPage(pageId) ?? null;
  });
  ipcMain.handle(PAGES_CHANNELS.exportPage, (event, pageId: string, format: 'pdf' | 'docx' | 'xlsx') => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted Page export request.');
    return pagesEngine?.exportPage(pageId, format) ?? { ok: false, message: 'Pages are not ready.' };
  });
  ipcMain.handle(PAGES_CHANNELS.command, (event, command: PagesCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted Pages command.');
    return pagesEngine?.execute(command) ?? { ok: false, message: 'Pages are not ready.' };
  });
  ipcMain.handle(TANDEM_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted Tandem snapshot request.');
    return tandemEngine?.getSnapshot() ?? EMPTY_TANDEM_SNAPSHOT;
  });
  ipcMain.handle(TANDEM_CHANNELS.command, (event, command: TandemCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted Tandem command.');
    return tandemEngine?.execute(command) ?? { ok: false, message: 'Tandem is not ready.' };
  });
  ipcMain.handle(SETTINGS_OVERLAY_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedSettingsSender(event.sender)) throw new Error('Untrusted settings snapshot request.');
    if (!settingsOverlay) throw new Error('Poppin Settings is not ready.');
    return settingsOverlay.getSnapshot();
  });
  ipcMain.handle(SETTINGS_OVERLAY_CHANNELS.command, async (event, command: SettingsOverlayCommand) => {
    const fromShell = isTrustedShellSender(event.sender);
    const fromOverlay = Boolean(settingsOverlay?.isOverlaySender(event.sender));
    if (!fromShell && !fromOverlay) throw new Error('Untrusted settings command.');
    if (!settingsOverlay) return { ok: false, message: 'Poppin Settings is not ready.' };

    if (command.type === 'open') {
      if (!fromShell) return { ok: false, message: 'Only the Poppin shell can open Settings.' };
      await settingsOverlay.open();
      return { ok: true };
    }
    if (command.type === 'close') {
      settingsOverlay.close(fromOverlay);
      return { ok: true };
    }
    if (!fromOverlay) return { ok: false, message: 'Settings changes must come from the Settings panel.' };

    let result;
    if (command.type === 'updateBrowserSettings') {
      result = await (browserEngine?.execute({ type: 'updateSettings', settings: command.settings }) ?? Promise.resolve({ ok: false, message: 'Browser settings are not ready.' }));
    } else if (command.type === 'reopenClosedTab') {
      result = await (browserEngine?.execute({ type: 'reopenClosedTab' }) ?? Promise.resolve({ ok: false, message: 'Browser settings are not ready.' }));
    } else if (command.type === 'tandem') {
      result = await (tandemEngine?.execute(command.command) ?? Promise.resolve({ ok: false, message: 'Tandem is not ready.' }));
    } else if (command.type === 'continuity') {
      result = await (continuityEngine?.execute(command.command) ?? Promise.resolve({ ok: false, message: 'Continuity is not ready.' }));
      if (continuityEngine) continuitySnapshotCache = await continuityEngine.getSnapshot();
    } else {
      result = { ok: false, message: 'Unknown settings command.' };
    }
    settingsOverlay.notify();
    return result;
  });
  ipcMain.handle(TASK_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted task snapshot request.');
    return taskEngine?.getSnapshot() ?? {
      connection: { state: 'checking', message: 'Codex is starting…', accountLabel: null, models: [] },
      task: null,
    };
  });
  ipcMain.handle(TASK_CHANNELS.command, (event, command: TaskCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted task command.');
    return taskEngine?.execute(command) ?? { ok: false, message: 'Codex is not ready.' };
  });
  ipcMain.handle(BROWSER_AGENT_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted browser-agent snapshot request.');
    return browserAgentEngine?.getSnapshot() ?? {
      state: 'idle', taskId: null, taskSpace: null, watching: false, allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null, log: [],
    };
  });
  ipcMain.handle(BROWSER_AGENT_CHANNELS.command, async (event, command: BrowserAgentCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted browser-agent command.');
    const result = await (browserAgentEngine?.execute(command) ?? Promise.resolve({ ok: false, message: 'Controlled browser use is not ready.' }));
    taskEngine?.resolveBrowserToolApproval(command, ['takeOver', 'pause', 'stop'].includes(command.type) && result.ok
      ? { ok: false, message: 'Browser control changed before the pending action could run.' }
      : result);
    return result;
  });
  ipcMain.handle(POPPIN_PAD_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted Poppin Pad snapshot request.');
    return poppinPadEngine?.getSnapshot() ?? EMPTY_POPPIN_PAD_SNAPSHOT;
  });
  ipcMain.handle(POPPIN_PAD_CHANNELS.command, async (event, command: PoppinPadCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted Poppin Pad command.');
    return poppinPadEngine?.execute(command) ?? { ok: false, message: 'Poppin Pad is not ready.' };
  });

  const browsingSession = session.fromPartition('persist:poppin-browser');
  browsingSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isAllowedBrowsingPermission(permission));
  });
  browsingSession.setPermissionCheckHandler((_contents, permission) => isAllowedBrowsingPermission(permission));

  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  openExternalUrl(url);
});

app.on('before-quit', (event) => {
  if (!browserEngine && !taskEngine) return;
  event.preventDefault();
  const engine = browserEngine;
  const codex = taskEngine;
  const preview = previewEngine;
  browserEngine = null;
  taskEngine = null;
  previewEngine = null;
  void Promise.all([engine?.flush(), browserAgentEngine?.flush(), codex?.close(), preview?.stop()]).finally(() => app.quit());
});

app.on('quit', () => {
  workspaceStore?.close();
  workspaceStore = null;
  taskStore?.close();
  taskStore = null;
  pagesStore?.close();
  pagesStore = null;
  tandemCredentials?.close();
  tandemCredentials = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
