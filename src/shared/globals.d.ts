declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const SETTINGS_OVERLAY_WEBPACK_ENTRY: string;
declare const SETTINGS_OVERLAY_PRELOAD_WEBPACK_ENTRY: string;
declare const DOWNLOADS_OVERLAY_WEBPACK_ENTRY: string;
declare const DOWNLOADS_OVERLAY_PRELOAD_WEBPACK_ENTRY: string;

declare module '*.png' {
  const source: string;
  export default source;
}
