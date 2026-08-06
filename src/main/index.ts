import { app, BrowserWindow, ipcMain, Menu, screen, session } from 'electron';

import {
  BROWSER_CHANNELS,
  type BrowserCommand,
  type WindowState,
} from '../shared/browser';
import { BrowserEngine } from './browser/browser-engine';
import { handleInternalPages, registerInternalScheme } from './browser/internal-pages';
import { BrowserStateStore } from './browser/state-store';
import { clampWindowState, DEFAULT_WINDOW_STATE } from './browser/window-state';

registerInternalScheme();

let mainWindow: BrowserWindow | null = null;
let browserEngine: BrowserEngine | null = null;

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
  browserEngine.restore(
    persisted
      ? { tabs: persisted.tabs, activeTabId: persisted.activeTabId }
      : null,
  );

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
    mainWindow = null;
    browserEngine = null;
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
}

function isTrustedShellSender(sender: Electron.WebContents): boolean {
  return Boolean(mainWindow && sender === mainWindow.webContents);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  handleInternalPages();
  ipcMain.handle(BROWSER_CHANNELS.getSnapshot, (event) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted browser snapshot request.');
    return browserEngine?.getSnapshot();
  });
  ipcMain.handle(BROWSER_CHANNELS.command, (event, command: BrowserCommand) => {
    if (!isTrustedShellSender(event.sender)) throw new Error('Untrusted browser command.');
    return browserEngine?.execute(command) ?? { ok: false, message: 'Browser is not ready.' };
  });

  const browsingSession = session.fromPartition('persist:poppin-browser');
  browsingSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browsingSession.setPermissionCheckHandler(() => false);

  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('before-quit', (event) => {
  if (!browserEngine) return;
  event.preventDefault();
  const engine = browserEngine;
  browserEngine = null;
  void engine.flush().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
