import type { PoppinBrowserApi } from '../shared/browser';
import type { PoppinWorkspaceApi } from '../shared/workspace';

declare global {
  interface Window {
    poppinBrowser: PoppinBrowserApi;
    poppinWorkspace: PoppinWorkspaceApi;
  }
}

export {};
