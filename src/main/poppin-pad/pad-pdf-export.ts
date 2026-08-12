import { writeFile } from 'node:fs/promises';

import { BrowserWindow, dialog } from 'electron';
import { marked } from 'marked';

import type { PoppinPadSnapshot } from '../../shared/poppin-pad';
import { exportPadToMarkdown } from './pad-tandem-export';

marked.setOptions({ gfm: true, breaks: false });

export async function exportPadToPdf(parent: BrowserWindow, snapshot: PoppinPadSnapshot, title?: string): Promise<string | null> {
  const exportTitle = title ?? snapshot.pad.title ?? 'Poppin Pad';
  const result = await dialog.showSaveDialog(parent, {
    title: 'Export Poppin Pad PDF',
    defaultPath: `${safeFilename(exportTitle)}.pdf`,
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;

  const markdown = exportPadToMarkdown(snapshot, exportTitle);
  const bodyHtml = marked.parse(markdown, { async: false }) as string;
  const html = `<!doctype html><meta charset="utf-8"><style>
@page{size:A4;margin:16mm}
body{font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#25211d;background:#fff}
h1{font-size:24px;border-bottom:2px solid #d88729;padding-bottom:10px}
h2{font-size:16px;margin-top:1.4em}
blockquote{margin:0;padding:10px 12px;background:#fff4bf;border-radius:10px;border-left:3px solid #d8892b}
svg{display:block;margin:12px 0;max-width:100%;height:auto}
ul{padding-left:1.2em}
</style>${bodyHtml}`;

  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    await writeFile(result.filePath, pdf);
    return result.filePath;
  } finally {
    window.destroy();
  }
}

function safeFilename(value: string): string {
  return (value.trim() || 'Poppin-Pad').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100);
}
