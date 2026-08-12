import {
  clipboard,
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';

interface PageContextActions {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenLink: (url: string, disposition: 'current' | 'new-tab') => void;
  onSearchSelection: (selection: string) => void;
  onAddSelectionToPad?: (selection: string) => void;
  onAddLinkToPad?: (url: string, label: string) => void;
  onAddImageToPad?: (srcUrl: string) => void;
}

export function showPageContextMenu(
  window: BrowserWindow,
  contents: WebContents,
  params: ContextMenuParams,
  actions: PageContextActions,
): void {
  const template: MenuItemConstructorOptions[] = [];
  const selection = params.selectionText.trim();

  if (params.linkURL) {
    template.push(
      { label: 'Open Link in New Tab', click: () => actions.onOpenLink(params.linkURL, 'new-tab') },
      { label: 'Open Link in Current Tab', click: () => actions.onOpenLink(params.linkURL, 'current') },
      { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
      ...(actions.onAddLinkToPad ? [{ label: 'Add link to Poppin Pad', click: () => actions.onAddLinkToPad?.(params.linkURL, selection || params.linkURL) }] : []),
      { type: 'separator' },
    );
  }

  if (params.mediaType === 'image' && params.srcURL && actions.onAddImageToPad) {
    template.push(
      { label: 'Add image to Poppin Pad', click: () => actions.onAddImageToPad?.(params.srcURL) },
      { type: 'separator' },
    );
  }

  if (params.isEditable) {
    template.push(...editItems(contents, params));
  } else if (selection) {
    template.push(
      { label: 'Copy', enabled: params.editFlags.canCopy, click: () => contents.copy() },
      {
        label: `Search for “${truncate(selection, 36)}”`,
        click: () => actions.onSearchSelection(selection),
      },
      ...(actions.onAddSelectionToPad ? [{ label: 'Add selection to Poppin Pad', click: () => actions.onAddSelectionToPad?.(selection) }] : []),
      { type: 'separator' },
      { label: 'Select All', enabled: params.editFlags.canSelectAll, click: () => contents.selectAll() },
    );
  } else {
    template.push(
      { label: 'Back', enabled: actions.canGoBack, click: actions.onBack },
      { label: 'Forward', enabled: actions.canGoForward, click: actions.onForward },
      { label: 'Reload', click: actions.onReload },
      { type: 'separator' },
      { label: 'Select All', enabled: params.editFlags.canSelectAll, click: () => contents.selectAll() },
    );
  }

  Menu.buildFromTemplate(trimSeparators(template)).popup({ window, frame: params.frame ?? undefined });
}

export function showEditContextMenu(
  window: BrowserWindow,
  contents: WebContents,
  params: ContextMenuParams,
): void {
  if (!params.isEditable && !params.selectionText.trim()) return;
  const template = params.isEditable
    ? editItems(contents, params)
    : [
        { label: 'Copy', enabled: params.editFlags.canCopy, click: () => contents.copy() },
        { type: 'separator' as const },
        { label: 'Select All', enabled: params.editFlags.canSelectAll, click: () => contents.selectAll() },
      ];
  Menu.buildFromTemplate(template).popup({ window, frame: params.frame ?? undefined });
}

function editItems(contents: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[] {
  const flags = params.editFlags;
  return [
    { label: 'Undo', enabled: flags.canUndo, click: () => contents.undo() },
    { label: 'Redo', enabled: flags.canRedo, click: () => contents.redo() },
    { type: 'separator' },
    { label: 'Cut', enabled: flags.canCut, click: () => contents.cut() },
    { label: 'Copy', enabled: flags.canCopy, click: () => contents.copy() },
    { label: 'Paste', enabled: flags.canPaste, click: () => contents.paste() },
    { label: 'Paste and Match Style', enabled: flags.canPaste, click: () => contents.pasteAndMatchStyle() },
    { label: 'Delete', enabled: flags.canDelete, click: () => contents.delete() },
    { type: 'separator' },
    { label: 'Select All', enabled: flags.canSelectAll, click: () => contents.selectAll() },
  ];
}

function trimSeparators(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  while (template[0]?.type === 'separator') template.shift();
  while (template.at(-1)?.type === 'separator') template.pop();
  return template.filter((item, index) => item.type !== 'separator' || template[index - 1]?.type !== 'separator');
}

function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ');
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1)}…`;
}
