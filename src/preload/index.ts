import { contextBridge, ipcRenderer } from 'electron';

import {
  BROWSER_CHANNELS,
  type BrowserCommand,
  type BrowserSnapshot,
  type PoppinBrowserApi,
} from '../shared/browser';
import {
  WORKSPACE_CHANNELS,
  type PoppinWorkspaceApi,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from '../shared/workspace';
import {
  TASK_CHANNELS,
  type PoppinTaskApi,
  type TaskCommand,
  type TaskSnapshot,
} from '../shared/task';
import {
  BROWSER_AGENT_CHANNELS,
  type BrowserAgentCommand,
  type BrowserAgentSnapshot,
  type PoppinBrowserAgentApi,
} from '../shared/browser-agent';
import {
  PAGES_CHANNELS,
  type PageDocumentSnapshot,
  type PagesCommand,
  type PagesSnapshot,
  type PoppinPagesApi,
} from '../shared/pages';

import {
  TANDEM_CHANNELS,
  type PoppinTandemApi,
  type TandemCommand,
  type TandemSnapshot,
} from '../shared/tandem';
import {
  SETTINGS_OVERLAY_CHANNELS,
  type PoppinSettingsOverlayApi,
  type SettingsOverlayCommand,
  type SettingsOverlaySnapshot,
} from '../shared/settings-overlay';
import {
  DOWNLOAD_CHANNELS,
  type DownloadsCommand,
  type DownloadsSnapshot,
  type PoppinDownloadsApi,
} from '../shared/downloads';

const api: PoppinBrowserApi = {
  getSnapshot: () => ipcRenderer.invoke(BROWSER_CHANNELS.getSnapshot) as Promise<BrowserSnapshot>,
  command: (command: BrowserCommand) => ipcRenderer.invoke(BROWSER_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: BrowserSnapshot) => listener(snapshot);
    ipcRenderer.on(BROWSER_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(BROWSER_CHANNELS.snapshot, handler);
  },
  onFocusAddress: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(BROWSER_CHANNELS.focusAddress, handler);
    return () => ipcRenderer.removeListener(BROWSER_CHANNELS.focusAddress, handler);
  },
};

contextBridge.exposeInMainWorld('poppinBrowser', api);

const workspaceApi: PoppinWorkspaceApi = {
  getSnapshot: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.getSnapshot) as Promise<WorkspaceSnapshot>,
  command: (command: WorkspaceCommand) => ipcRenderer.invoke(WORKSPACE_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: WorkspaceSnapshot) => listener(snapshot);
    ipcRenderer.on(WORKSPACE_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(WORKSPACE_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinWorkspace', workspaceApi);

const pagesApi: PoppinPagesApi = {
  getSnapshot: () => ipcRenderer.invoke(PAGES_CHANNELS.getSnapshot) as Promise<PagesSnapshot>,
  getPage: (pageId) => ipcRenderer.invoke(PAGES_CHANNELS.getPage, pageId) as Promise<PageDocumentSnapshot | null>,
  command: (command: PagesCommand) => ipcRenderer.invoke(PAGES_CHANNELS.command, command),
  exportPage: (pageId, format) => ipcRenderer.invoke(PAGES_CHANNELS.exportPage, pageId, format),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: PagesSnapshot) => listener(snapshot);
    ipcRenderer.on(PAGES_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(PAGES_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinPages', pagesApi);

const taskApi: PoppinTaskApi = {
  getSnapshot: () => ipcRenderer.invoke(TASK_CHANNELS.getSnapshot) as Promise<TaskSnapshot>,
  command: (command: TaskCommand) => ipcRenderer.invoke(TASK_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: TaskSnapshot) => listener(snapshot);
    ipcRenderer.on(TASK_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(TASK_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinTask', taskApi);

const browserAgentApi: PoppinBrowserAgentApi = {
  getSnapshot: () => ipcRenderer.invoke(BROWSER_AGENT_CHANNELS.getSnapshot) as Promise<BrowserAgentSnapshot>,
  command: (command: BrowserAgentCommand) => ipcRenderer.invoke(BROWSER_AGENT_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: BrowserAgentSnapshot) => listener(snapshot);
    ipcRenderer.on(BROWSER_AGENT_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(BROWSER_AGENT_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinBrowserAgent', browserAgentApi);

const tandemApi: PoppinTandemApi = {
  getSnapshot: () => ipcRenderer.invoke(TANDEM_CHANNELS.getSnapshot) as Promise<TandemSnapshot>,
  command: (command: TandemCommand) => ipcRenderer.invoke(TANDEM_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: TandemSnapshot) => listener(snapshot);
    ipcRenderer.on(TANDEM_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(TANDEM_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinTandem', tandemApi);

const settingsOverlayApi: PoppinSettingsOverlayApi = {
  getSnapshot: () => ipcRenderer.invoke(SETTINGS_OVERLAY_CHANNELS.getSnapshot) as Promise<SettingsOverlaySnapshot>,
  command: (command: SettingsOverlayCommand) => ipcRenderer.invoke(SETTINGS_OVERLAY_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SettingsOverlaySnapshot) => listener(snapshot);
    ipcRenderer.on(SETTINGS_OVERLAY_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(SETTINGS_OVERLAY_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinSettings', settingsOverlayApi);

const downloadsApi: PoppinDownloadsApi = {
  getSnapshot: () => ipcRenderer.invoke(DOWNLOAD_CHANNELS.getSnapshot) as Promise<DownloadsSnapshot>,
  command: (command: DownloadsCommand) => ipcRenderer.invoke(DOWNLOAD_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DownloadsSnapshot) => listener(snapshot);
    ipcRenderer.on(DOWNLOAD_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(DOWNLOAD_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinDownloads', downloadsApi);
