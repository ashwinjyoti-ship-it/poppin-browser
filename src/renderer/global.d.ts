import type { PoppinBrowserApi } from '../shared/browser';
import type { PoppinWorkspaceApi } from '../shared/workspace';
import type { PoppinTaskApi } from '../shared/task';
import type { PoppinBrowserAgentApi } from '../shared/browser-agent';

declare global {
  interface Window {
    poppinBrowser: PoppinBrowserApi;
    poppinWorkspace: PoppinWorkspaceApi;
    poppinTask: PoppinTaskApi;
    poppinBrowserAgent: PoppinBrowserAgentApi;
  }
}

export {};
