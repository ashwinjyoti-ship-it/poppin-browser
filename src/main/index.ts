import path from 'node:path';

import { mkdir, writeFile } from 'node:fs/promises';

import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, session } from 'electron';

import {
  BROWSER_CHANNELS,
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

registerInternalScheme();

let mainWindow: BrowserWindow | null = null;
let browserEngine: BrowserEngine | null = null;
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
const pendingExternalUrls: string[] = [];

function openExternalUrl(url: string): void {
  if (browserEngine) {
    browserEngine.openExternalUrl(url);
  } else {
    pendingExternalUrls.push(url);
  }
}

async function createWindow(): Promise<void> {
  const stateStore = new BrowserStateStore(app.getPath('userData'));
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
  workspaceEngine = new WorkspaceEngine(
    mainWindow, workspaceStore, browserEngine, git, pagesStore ?? undefined,
    () => pagesEngine?.refresh(),
    () => tandemEngine?.getSelectedContext() ?? [],
  );
  if (!pagesStore) throw new Error('Pages storage is not ready.');
  pagesEngine = new PagesEngine(mainWindow, pagesStore, () => workspaceEngine?.refreshPageContexts());
  browserAgentEngine = new BrowserAgentEngine(mainWindow, browserEngine, (tabId, content) => {
    workspaceEngine?.updateTabContextFromAgent(tabId, content);
  }, new BrowserAgentStateStore(app.getPath('userData')));
  if (!taskStore) throw new Error('Task storage is not ready.');
  const workDirectory = path.join(app.getPath('userData'), 'task-output');
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
    mainWindow = null;
    browserEngine = null;
    workspaceEngine = null;
    pagesEngine = null;
    taskEngine = null;
    browserAgentEngine = null;
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

app.whenReady().then(async () => {
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
  workspaceStore = new WorkspaceStore(path.join(app.getPath('userData'), 'poppin.sqlite'));
  taskStore = new TaskStore(path.join(app.getPath('userData'), 'poppin.sqlite'));
  tandemCredentials = new TandemCredentialStore(path.join(app.getPath('userData'), 'poppin.sqlite'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (value) => safeStorage.decryptString(value),
  });
  pagesStore = new PagesStore(path.join(app.getPath('userData'), 'poppin.sqlite'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (value) => safeStorage.decryptString(value),
  });
  ipcMain.handle(BROWSER_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted browser snapshot request.');
    return browserEngine?.getSnapshot();
  });
  ipcMain.handle(BROWSER_CHANNELS.command, (event, command: BrowserCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted browser command.');
    return browserEngine?.execute(command) ?? { ok: false, message: 'Browser is not ready.' };
  });
  ipcMain.handle(WORKSPACE_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted workspace snapshot request.');
    return workspaceEngine?.getSnapshot() ?? { workspace: null, documents: [], tabContexts: [], project: null, visualSelection: null };
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
