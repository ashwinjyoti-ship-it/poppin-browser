import type { BrowserCommandResult, BrowserSettings } from './browser';
import type { TandemCommand, TandemCommandResult, TandemSnapshot } from './tandem';

export const SETTINGS_OVERLAY_CHANNELS = {
  command: 'settings-overlay:command',
  getSnapshot: 'settings-overlay:get-snapshot',
  snapshot: 'settings-overlay:snapshot',
} as const;

export interface SettingsOverlaySnapshot {
  open: boolean;
  browser: {
    settings: BrowserSettings;
    canReopenClosedTab: boolean;
  };
  tandem: TandemSnapshot;
}

export type TandemSettingsCommand = Extract<TandemCommand,
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'refreshConnection' }
>;

export type SettingsOverlayCommand =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'updateBrowserSettings'; settings: Partial<BrowserSettings> }
  | { type: 'reopenClosedTab' }
  | { type: 'tandem'; command: TandemSettingsCommand };

export type SettingsOverlayCommandResult = BrowserCommandResult | TandemCommandResult;

export interface PoppinSettingsOverlayApi {
  getSnapshot: () => Promise<SettingsOverlaySnapshot>;
  command: (command: SettingsOverlayCommand) => Promise<SettingsOverlayCommandResult>;
  subscribe: (listener: (snapshot: SettingsOverlaySnapshot) => void) => () => void;
}
