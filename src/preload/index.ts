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
