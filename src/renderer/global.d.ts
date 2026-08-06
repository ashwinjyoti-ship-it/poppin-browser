import type { PoppinBrowserApi } from '../shared/browser';

declare global {
  interface Window {
    poppinBrowser: PoppinBrowserApi;
  }
}

export {};

