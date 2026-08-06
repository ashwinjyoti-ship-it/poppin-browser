import { contextBridge, ipcRenderer } from 'electron';

import {
  BROWSER_CHANNELS,
  type BrowserCommand,
  type BrowserSnapshot,
  type PoppinBrowserApi,
} from '../shared/browser';

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

