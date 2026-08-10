import { contextBridge, ipcRenderer } from 'electron';

import {
  SETTINGS_OVERLAY_CHANNELS,
  type PoppinSettingsOverlayApi,
  type SettingsOverlayCommand,
  type SettingsOverlaySnapshot,
} from '../shared/settings-overlay';

const api: PoppinSettingsOverlayApi = {
  getSnapshot: () => ipcRenderer.invoke(SETTINGS_OVERLAY_CHANNELS.getSnapshot) as Promise<SettingsOverlaySnapshot>,
  command: (command: SettingsOverlayCommand) => ipcRenderer.invoke(SETTINGS_OVERLAY_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SettingsOverlaySnapshot) => listener(snapshot);
    ipcRenderer.on(SETTINGS_OVERLAY_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(SETTINGS_OVERLAY_CHANNELS.snapshot, handler);
  },
};

contextBridge.exposeInMainWorld('poppinSettings', api);
