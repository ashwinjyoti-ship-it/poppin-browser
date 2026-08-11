import type { BrowserCommandResult, BrowserSettings } from './browser';
import type {
  ContinuityCommand,
  ContinuityCommandResult,
  ContinuitySnapshot,
} from './continuity';
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
  continuity: ContinuitySnapshot;
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
  | { type: 'tandem'; command: TandemSettingsCommand }
  | { type: 'continuity'; command: ContinuityCommand };

export type SettingsOverlayCommandResult =
  | BrowserCommandResult
  | TandemCommandResult
  | ContinuityCommandResult;

export interface PoppinSettingsOverlayApi {
  getSnapshot: () => Promise<SettingsOverlaySnapshot>;
  command: (command: SettingsOverlayCommand) => Promise<SettingsOverlayCommandResult>;
  subscribe: (listener: (snapshot: SettingsOverlaySnapshot) => void) => () => void;
}
