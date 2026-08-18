import { contextBridge, ipcRenderer } from 'electron';

import {
  DOWNLOAD_CHANNELS,
  type DownloadsCommand,
  type DownloadsSnapshot,
  type PoppinDownloadsApi,
} from '../shared/downloads';

const api: PoppinDownloadsApi = {
  getSnapshot: () => ipcRenderer.invoke(DOWNLOAD_CHANNELS.getSnapshot) as Promise<DownloadsSnapshot>,
  command: (command: DownloadsCommand) => ipcRenderer.invoke(DOWNLOAD_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DownloadsSnapshot) => listener(snapshot);
    ipcRenderer.on(DOWNLOAD_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(DOWNLOAD_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinDownloads', api);
