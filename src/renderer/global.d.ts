import type { PoppinBrowserApi } from '../shared/browser';
import type { PoppinWorkspaceApi } from '../shared/workspace';
import type { PoppinTaskApi } from '../shared/task';
import type { PoppinBrowserAgentApi } from '../shared/browser-agent';
import type { PoppinPagesApi } from '../shared/pages';
import type { PoppinTandemApi } from '../shared/tandem';
import type { PoppinSettingsOverlayApi } from '../shared/settings-overlay';
import type { PoppinDownloadsApi } from '../shared/downloads';
import type { PoppinPadApi } from '../shared/poppin-pad';

declare global {
  interface Window {
    poppinBrowser: PoppinBrowserApi;
    poppinWorkspace: PoppinWorkspaceApi;
    poppinTask: PoppinTaskApi;
    poppinBrowserAgent: PoppinBrowserAgentApi;
    poppinPages: PoppinPagesApi;
    poppinTandem: PoppinTandemApi;
    poppinSettings: PoppinSettingsOverlayApi;
    poppinDownloads: PoppinDownloadsApi;
    poppinPad: PoppinPadApi;
  }
}

export {};
