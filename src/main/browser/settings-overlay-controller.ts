import { BrowserWindow, type WebContents } from 'electron';

import {
  SETTINGS_OVERLAY_CHANNELS,
  type SettingsOverlaySnapshot,
} from '../../shared/settings-overlay';

const PANEL_WIDTH = 370;
const PANEL_RIGHT_MARGIN = 18;
const PANEL_TOP = 52;
const PANEL_BOTTOM_MARGIN = 18;

/**
 * Hosts trusted Settings UI above native page WebContentsViews without
 * changing their bounds. The child window is non-modal and contains only the
 * dedicated settings preload, so remote pages never gain Poppin privileges.
 */
export class SettingsOverlayController {
  private overlay: BrowserWindow | null = null;
  private openState = false;

  constructor(
    private readonly parent: BrowserWindow,
    private readonly entryUrl: string,
    private readonly preloadPath: string,
    private readonly readSnapshot: () => Omit<SettingsOverlaySnapshot, 'open'>,
  ) {
    this.parent.on('move', () => this.layout());
    this.parent.on('resize', () => this.layout());
    this.parent.on('enter-full-screen', () => this.layout());
    this.parent.on('leave-full-screen', () => this.layout());
  }

  getSnapshot(): SettingsOverlaySnapshot {
    return { open: this.openState, ...this.readSnapshot() };
  }

  isOverlaySender(sender: WebContents): boolean {
    return Boolean(this.overlay && !this.overlay.isDestroyed() && sender === this.overlay.webContents);
  }

  async open(): Promise<void> {
    if (this.parent.isDestroyed()) return;
    this.openState = true;
    this.emit();
    const overlay = this.ensureOverlay();
    this.layout();
    if (overlay.webContents.getURL() !== this.entryUrl) {
      await overlay.loadURL(this.entryUrl);
    }
    if (!this.openState || overlay.isDestroyed()) return;
    overlay.show();
    overlay.focus();
    this.emit();
  }

  close(restoreParentFocus = false): void {
    if (!this.openState && !this.overlay?.isVisible()) return;
    this.openState = false;
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.hide();
    this.emit();
    if (restoreParentFocus && !this.parent.isDestroyed()) this.parent.focus();
  }

  notify(): void {
    this.emit();
  }

  destroy(): void {
    this.openState = false;
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy();
    this.overlay = null;
  }

  private ensureOverlay(): BrowserWindow {
    if (this.overlay && !this.overlay.isDestroyed()) return this.overlay;
    const overlay = new BrowserWindow({
      parent: this.parent,
      modal: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlay.webContents.on('will-navigate', (event) => event.preventDefault());
    overlay.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        this.close(true);
      }
    });
    overlay.on('blur', () => this.close(false));
    overlay.on('closed', () => {
      this.overlay = null;
      if (this.openState) {
        this.openState = false;
        this.emit();
      }
    });
    this.overlay = overlay;
    return overlay;
  }

  private layout(): void {
    const overlay = this.overlay;
    if (!overlay || overlay.isDestroyed() || this.parent.isDestroyed()) return;
    const parent = this.parent.getContentBounds();
    const width = Math.min(PANEL_WIDTH, Math.max(280, parent.width - PANEL_RIGHT_MARGIN * 2));
    const height = Math.max(320, parent.height - PANEL_TOP - PANEL_BOTTOM_MARGIN);
    overlay.setBounds({
      x: parent.x + parent.width - width - PANEL_RIGHT_MARGIN,
      y: parent.y + PANEL_TOP,
      width,
      height,
    });
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    if (!this.parent.isDestroyed() && !this.parent.webContents.isDestroyed()) {
      this.parent.webContents.send(SETTINGS_OVERLAY_CHANNELS.snapshot, snapshot);
    }
    if (this.overlay && !this.overlay.isDestroyed() && !this.overlay.webContents.isDestroyed()) {
      this.overlay.webContents.send(SETTINGS_OVERLAY_CHANNELS.snapshot, snapshot);
    }
  }
}
