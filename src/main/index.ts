import path from 'node:path';

import { app, BrowserWindow, ipcMain, Menu, screen, session } from 'electron';

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

registerInternalScheme();

let mainWindow: BrowserWindow | null = null;
let browserEngine: BrowserEngine | null = null;
let workspaceEngine: WorkspaceEngine | null = null;
let workspaceStore: WorkspaceStore | null = null;
let taskEngine: TaskEngine | null = null;
let taskStore: TaskStore | null = null;
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
  workspaceEngine = new WorkspaceEngine(mainWindow, workspaceStore, browserEngine, git);
  if (!taskStore) throw new Error('Task storage is not ready.');
  taskEngine = new TaskEngine(mainWindow, taskStore, workspaceStore, git);
  browserEngine.restore(
    persisted
      ? { tabs: persisted.tabs, activeTabId: persisted.activeTabId }
      : null,
  );
  for (const url of pendingExternalUrls.splice(0)) openExternalUrl(url);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (browserEngine?.handleShortcut(input)) event.preventDefault();
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
    taskEngine = null;
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
  Menu.setApplicationMenu(null);
  workspaceStore = new WorkspaceStore(path.join(app.getPath('userData'), 'poppin.sqlite'));
  taskStore = new TaskStore(path.join(app.getPath('userData'), 'poppin.sqlite'));
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
    return workspaceEngine?.getSnapshot() ?? { workspace: null, documents: [], tabContexts: [], project: null };
  });
  ipcMain.handle(WORKSPACE_CHANNELS.command, (event, command: WorkspaceCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted workspace command.');
    return workspaceEngine?.execute(command) ?? { ok: false, message: 'Workspace is not ready.' };
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
  browserEngine = null;
  taskEngine = null;
  void Promise.all([engine?.flush(), codex?.close()]).finally(() => app.quit());
});

app.on('quit', () => {
  workspaceStore?.close();
  workspaceStore = null;
  taskStore?.close();
  taskStore = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
