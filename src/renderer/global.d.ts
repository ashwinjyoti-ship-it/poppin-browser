import type { PoppinBrowserApi } from '../shared/browser';
import type { PoppinWorkspaceApi } from '../shared/workspace';
import type { PoppinTaskApi } from '../shared/task';
import type { PoppinBrowserAgentApi } from '../shared/browser-agent';
import type { PoppinPagesApi } from '../shared/pages';

declare global {
  interface Window {
    poppinBrowser: PoppinBrowserApi;
    poppinWorkspace: PoppinWorkspaceApi;
    poppinTask: PoppinTaskApi;
    poppinBrowserAgent: PoppinBrowserAgentApi;
    poppinPages: PoppinPagesApi;
  }
}

export {};
