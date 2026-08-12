export const POPPIN_PAD_CHANNELS = {
  command: 'poppin-pad:command',
  getSnapshot: 'poppin-pad:get-snapshot',
  snapshot: 'poppin-pad:snapshot',
} as const;

export type PadTool = 'select' | 'pen' | 'arrow' | 'rect' | 'text' | 'sticky';
export type PadObjectKind = 'stroke' | 'arrow' | 'rect' | 'text' | 'sticky' | 'card';
export type PadCardSubtype = 'link' | 'image' | 'selection' | 'log' | 'code' | 'diagram' | 'generic';

export interface PadPoint {
  x: number;
  y: number;
}

export interface PadStrokePayload {
  points: PadPoint[];
  color: string;
  width: number;
}

export interface PadArrowPayload {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface PadRectPayload {
  stroke: string;
  fill: string;
  strokeWidth: number;
}

export interface PadTextPayload {
  text: string;
  fontSize: number;
  color: string;
}

export interface PadStickyPayload {
  text: string;
  color: string;
}

export interface PadCardPayload {
  title: string;
  subtype: PadCardSubtype;
  sourceUrl?: string;
  text?: string;
  html?: string;
  imagePath?: string;
  imageDataUrl?: string;
}

export type PadObjectPayload =
  | PadStrokePayload
  | PadArrowPayload
  | PadRectPayload
  | PadTextPayload
  | PadStickyPayload
  | PadCardPayload;

export interface PadObjectSnapshot {
  id: string;
  kind: PadObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  payload: PadObjectPayload;
  createdAt: string;
  updatedAt: string;
}

export interface PadRecordSnapshot {
  id: 'primary';
  title: string;
  collapsed: boolean;
  width: number;
  active: boolean;
  tool: PadTool;
  updatedAt: string;
}

export interface PadAttachmentSnapshot {
  objectId: string;
  kind: PadObjectKind;
  title: string;
  preview: string;
  payload: PadObjectPayload;
}

export interface PoppinPadSnapshot {
  pad: PadRecordSnapshot;
  objects: PadObjectSnapshot[];
  pendingAttachments: PadAttachmentSnapshot[];
}

export interface PadDropPayload {
  kind: 'text' | 'url' | 'html' | 'image' | 'browser-selection';
  text?: string;
  url?: string;
  html?: string;
  imageDataUrl?: string;
  imageName?: string;
  sourceUrl?: string;
  title?: string;
}

export interface PadBrowserIngestPayload {
  tabId: string;
  url: string;
  kind: 'selection' | 'link' | 'image';
  text?: string;
  linkUrl?: string;
  srcUrl?: string;
}

export type PoppinPadCommand =
  | { type: 'setCollapsed'; collapsed: boolean }
  | { type: 'setWidth'; width: number }
  | { type: 'setActive'; active: boolean }
  | { type: 'setTool'; tool: PadTool }
  | { type: 'upsertObject'; object: PadObjectSnapshot }
  | { type: 'deleteObject'; objectId: string }
  | { type: 'clearCanvas'; scope: 'all' | 'drawings' | 'cards' }
  | { type: 'ingestDrop'; payload: PadDropPayload; x: number; y: number }
  | { type: 'ingestBrowser'; payload: PadBrowserIngestPayload }
  | { type: 'exportToTandem'; title?: string }
  | { type: 'exportToPdf'; title?: string }
  | { type: 'focusShell' }
  | { type: 'queueAttachment'; objectId: string }
  | { type: 'removeAttachment'; objectId: string }
  | { type: 'clearAttachments' };

export interface PoppinPadCommandResult {
  ok: boolean;
  message?: string;
  pageId?: string;
}

export interface PoppinPadApi {
  getSnapshot: () => Promise<PoppinPadSnapshot>;
  command: (command: PoppinPadCommand) => Promise<PoppinPadCommandResult>;
  subscribe: (listener: (snapshot: PoppinPadSnapshot) => void) => () => void;
}

export const EMPTY_POPPIN_PAD_SNAPSHOT: PoppinPadSnapshot = {
  pad: {
    id: 'primary',
    title: 'Poppin Pad',
    collapsed: true,
    width: 320,
    active: false,
    tool: 'select',
    updatedAt: new Date(0).toISOString(),
  },
  objects: [],
  pendingAttachments: [],
};

export const PAD_ATTACHMENT_MIME = 'application/x-poppin-pad-attachment';
