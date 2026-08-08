import html2canvas from 'html2canvas';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import type { DatabaseProperty, DatabaseRow, Page } from '../types';
import { getPropValue, getRowTitle } from './databaseFilters';
import { getChildren, pageIcon } from './pageTree';

marked.setOptions({ gfm: true, breaks: false });

const PDF_STYLES = `
  .pdf-export { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1D3325; line-height: 1.6; font-size: 14px; overflow-wrap: break-word; word-wrap: break-word; }
  .pdf-title { font-size: 28px; font-weight: 700; margin: 0 0 24px; color: #1D3325; border-bottom: 2px solid #004228; padding-bottom: 12px; }
  .pdf-body h1 { font-size: 24px; font-weight: 700; margin: 20px 0 10px; color: #1D3325; }
  .pdf-body h2 { font-size: 20px; font-weight: 600; margin: 16px 0 8px; color: #1D3325; }
  .pdf-body h3 { font-size: 17px; font-weight: 600; margin: 14px 0 6px; color: #1D3325; }
  .pdf-body p { margin: 8px 0; color: #1D3325; }
  .pdf-body ul, .pdf-body ol { padding-left: 24px; margin: 8px 0; color: #1D3325; }
  .pdf-body li { margin: 4px 0; color: #1D3325; }
  .pdf-body blockquote { border-left: 3px solid #97B79E; padding: 8px 16px; margin: 12px 0; background: #F4F1ED; border-radius: 0 8px 8px 0; color: #1D3325; }
  .pdf-body pre { background: #17281D; color: #e2e8f0; padding: 12px 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
  .pdf-body code { background: #F4F1ED; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: ui-monospace, monospace; color: #1D3325; }
  .pdf-body pre code { background: none; padding: 0; color: inherit; }
  .pdf-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; display: block; }
  .pdf-body table { border-collapse: collapse; width: 100%; margin: 12px 0; table-layout: fixed; }
  .pdf-body th, .pdf-body td { border: 1px solid #DCDED6; padding: 8px 10px; text-align: left; vertical-align: top; word-break: break-word; color: #1D3325; }
  .pdf-body th { background: #F4F1ED; font-weight: 600; }
  .pdf-body a { color: #004228; text-decoration: underline; }
  .pdf-body hr { border: none; border-top: 1px solid #DCDED6; margin: 16px 0; }
  .pdf-body ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  .pdf-body ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
  .pdf-body strong { font-weight: 600; color: #1D3325; }
  .pdf-body em { font-style: italic; color: #1D3325; }
`;

const PDF_PAGE_WIDTH_PX = 794; // ~A4 width at 96dpi (capture width)
const PDF_PADDING_X_PX = 56; // left/right margin baked into the capture
const PDF_CAPTURE_SCALE = 2;
const PDF_MARGIN_PT = 40; // top/bottom page margin in points (A4 is 595.28 x 841.89 pt)

export function folderToMarkdown(title: string, pages: Page[], folderId: string): string {
  const children = getChildren(pages, folderId);
  const lines = [`# ${title}`, '', '## Contents', ''];
  if (children.length === 0) {
    lines.push('_This folder is empty._');
  } else {
    for (const child of children) {
      lines.push(`- ${pageIcon(child)} **${child.title}** (${child.type})`);
    }
  }
  return lines.join('\n');
}

function formatPropertyValue(row: DatabaseRow, prop: DatabaseProperty): string {
  const raw = getPropValue(row, prop.id);
  if (raw == null || raw === '') return '';
  if (prop.type === 'checkbox') return raw ? 'Yes' : 'No';
  if (Array.isArray(raw)) return raw.join(', ');
  return String(raw);
}

export function databaseToMarkdown(
  title: string,
  properties: DatabaseProperty[],
  rows: DatabaseRow[],
  nameProp?: DatabaseProperty,
): string {
  const lines = [`# ${title}`, '', `_${rows.length} row(s)_`, ''];
  if (rows.length === 0) {
    lines.push('_No rows yet._');
    return lines.join('\n');
  }

  const cols = properties.filter((p) => p.type !== 'rollup');
  const header = ['Title', ...cols.filter((p) => !nameProp || p.id !== nameProp.id).map((p) => p.name)];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);

  for (const row of rows) {
    const cells = [
      getRowTitle(row, nameProp),
      ...cols
        .filter((p) => !nameProp || p.id !== nameProp.id)
        .map((p) => formatPropertyValue(row, p).replace(/\|/g, '\\|').replace(/\n/g, ' ')),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}

/** Strip a leading markdown H1 when it matches the page title (avoids duplicate title in PDF). */
export function stripDuplicateTitle(markdown: string, title: string): string {
  const trimmed = markdown.trimStart();
  const match = trimmed.match(/^#\s+(.+?)(?:\n|$)/);
  if (!match) return markdown;
  const heading = match[1].trim();
  const pageTitle = (title || 'Untitled').trim();
  if (heading.toLowerCase() !== pageTitle.toLowerCase()) return markdown;
  return trimmed.slice(match[0].length).trimStart();
}

export function stripDuplicateTitleFromHtml(html: string, title: string): string {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  const first = div.firstElementChild;
  if (first?.tagName === 'H1') {
    const heading = (first.textContent ?? '').trim();
    const pageTitle = (title || 'Untitled').trim();
    if (heading.toLowerCase() === pageTitle.toLowerCase()) {
      first.remove();
    }
  }
  return div.innerHTML.trim() || '<p></p>';
}

export function markdownToPdfHtml(markdown: string, title: string): string {
  const body = stripDuplicateTitle(markdown, title);
  return marked.parse(body, { async: false }) as string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );
}

function buildPdfExportContainer(title: string, bodyHtml: string): HTMLDivElement {
  const container = document.createElement('div');
  container.setAttribute('data-pdf-export-root', 'true');
  // Must stay fully opaque and on-screen for html2canvas. Keep behind the UI so
  // the user never sees a flash; do not use opacity:0 or visibility:hidden.
  //
  // Only horizontal padding here — vertical page margins are applied by the PDF
  // placement so each page gets a clean top/bottom margin without baking a
  // wrong-sized gap into the capture.
  container.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    `width: ${PDF_PAGE_WIDTH_PX}px`,
    `padding: 0 ${PDF_PADDING_X_PX}px`,
    'background: #ffffff',
    'box-sizing: border-box',
    'color: #1D3325',
    'z-index: -1',
    'pointer-events: none',
    'overflow: visible',
  ].join(';');

  container.innerHTML = `
    <style>${PDF_STYLES}</style>
    <article class="pdf-export">
      <h1 class="pdf-title">${escapeHtml(title || 'Untitled')}</h1>
      <div class="pdf-body">${bodyHtml || '<p></p>'}</div>
    </article>
  `;

  return container;
}

export interface PdfBlockBox {
  top: number;
  bottom: number;
  heading: boolean;
}

export interface PdfPageSlice {
  startPx: number;
  endPx: number;
}

/**
 * Measure every top-level block (title + body children) and return its vertical
 * extent in canvas pixels, relative to the container's top edge.
 */
function measureBlockBoxes(container: HTMLElement, ratio: number): PdfBlockBox[] {
  const article = container.querySelector('.pdf-export');
  const body = container.querySelector('.pdf-body');
  if (!article || !body) return [];

  const containerTop = container.getBoundingClientRect().top;
  const els: HTMLElement[] = [];

  const titleEl = article.querySelector(':scope > .pdf-title');
  if (titleEl instanceof HTMLElement) els.push(titleEl);
  for (const child of Array.from(body.children)) {
    if (child instanceof HTMLElement) els.push(child);
  }

  return els.map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      top: (rect.top - containerTop) * ratio,
      bottom: (rect.bottom - containerTop) * ratio,
      heading: /^H[1-6]$/.test(el.tagName) || el.classList.contains('pdf-title'),
    };
  });
}

/**
 * Decide where each PDF page starts and ends (in canvas pixels) so that no block
 * is ever split across a page boundary. Breaks land in the gaps between blocks.
 * A block taller than a full page is sliced via `sliceOversized` (whitespace
 * aware) so we still make progress.
 */
export function planPdfPages(
  boxes: PdfBlockBox[],
  totalPx: number,
  usableHeightPx: number,
  sliceOversized?: (startPx: number, limitPx: number, blockBottomPx: number) => number,
): PdfPageSlice[] {
  const slices: PdfPageSlice[] = [];

  if (boxes.length === 0) {
    let start = 0;
    while (start < totalPx) {
      const end = Math.min(start + usableHeightPx, totalPx);
      slices.push({ startPx: start, endPx: end });
      start = end;
    }
    return slices;
  }

  let i = 0;
  let guard = 0;

  while (i < boxes.length && guard++ < 100000) {
    const pageStartPx = Math.max(0, boxes[i].top);
    const limit = pageStartPx + usableHeightPx;

    // Find the last block that fits fully on this page.
    let lastFit = -1;
    for (let j = i; j < boxes.length; j++) {
      if (boxes[j].bottom <= limit + 0.5) {
        lastFit = j;
      } else {
        break;
      }
    }

    if (lastFit < i) {
      // Block i alone is taller than a page — slice within it.
      const block = boxes[i];
      let endPx = limit;
      if (sliceOversized) {
        endPx = sliceOversized(pageStartPx, limit, block.bottom);
      }
      if (endPx <= pageStartPx) endPx = limit;
      if (endPx >= block.bottom) {
        endPx = block.bottom;
        i += 1;
      }
      slices.push({ startPx: pageStartPx, endPx });
      continue;
    }

    // Avoid leaving a heading stranded at the bottom of a page (orphan):
    // push trailing heading(s) to the next page so they stay with their content.
    while (lastFit > i && boxes[lastFit].heading) {
      lastFit -= 1;
    }

    slices.push({ startPx: pageStartPx, endPx: boxes[lastFit].bottom });
    i = lastFit + 1;
  }

  return slices;
}

/** Return true when every sampled pixel in a canvas row is near-white. */
function isCanvasRowBlank(ctx: CanvasRenderingContext2D, y: number, width: number): boolean {
  const row = ctx.getImageData(0, y, width, 1).data;
  for (let x = 0; x < width; x += 4) {
    const i = x * 4;
    if (row[i] < 248 || row[i + 1] < 248 || row[i + 2] < 248) {
      return false;
    }
  }
  return true;
}

/**
 * Find an absolute canvas Y to break at, scanning upward from the ideal break
 * for a band of blank rows so an oversized block is sliced between text lines.
 */
function findWhitespaceBreakY(
  ctx: CanvasRenderingContext2D,
  idealBreakY: number,
  minBreakY: number,
  width: number,
): number {
  const start = Math.min(Math.floor(idealBreakY), ctx.canvas.height - 1);
  const floor = Math.max(0, Math.floor(minBreakY));
  let blankRun = 0;

  for (let y = start; y >= floor; y--) {
    if (isCanvasRowBlank(ctx, y, width)) {
      blankRun += 1;
      if (blankRun >= 3) {
        return y + blankRun - 1;
      }
    } else {
      blankRun = 0;
    }
  }

  return idealBreakY;
}

function sliceCanvasPage(source: HTMLCanvasElement, srcY: number, height: number): HTMLCanvasElement {
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = source.width;
  pageCanvas.height = height;
  const ctx = pageCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create PDF page canvas');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
  ctx.drawImage(source, 0, srcY, source.width, height, 0, 0, source.width, height);
  return pageCanvas;
}

/**
 * Render styled HTML content to a downloadable PDF file.
 *
 * The whole document is captured into a single html2canvas bitmap, then split
 * into pages at the real gaps between top-level blocks (measured from the same
 * DOM/canvas, so there is no re-render drift). Paragraphs, headings, list items,
 * and tables are therefore never sliced across a page boundary. Each page gets a
 * consistent top/bottom margin applied at placement time.
 */
export async function downloadHtmlAsPdf(title: string, bodyHtml: string, filename: string): Promise<void> {
  const container = buildPdfExportContainer(title, bodyHtml);
  document.body.appendChild(container);

  try {
    await waitForImages(container);

    const canvas = await html2canvas(container, {
      scale: PDF_CAPTURE_SCALE,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: -window.scrollY,
      width: PDF_PAGE_WIDTH_PX,
      windowWidth: PDF_PAGE_WIDTH_PX,
    });

    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx || canvas.height === 0) {
      throw new Error('PDF export produced empty content');
    }

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageWidthPt = pdf.internal.pageSize.getWidth();
    const pageHeightPt = pdf.internal.pageSize.getHeight();

    // Image is scaled to the full page width, so 1 canvas px maps to a fixed
    // number of points. Page content area excludes the top/bottom margins.
    const ratio = canvas.width / PDF_PAGE_WIDTH_PX; // canvas px per CSS px
    const pxPerPt = canvas.width / pageWidthPt; // canvas px per point
    const usableHeightPx = (pageHeightPt - PDF_MARGIN_PT * 2) * pxPerPt;

    const boxes = measureBlockBoxes(container, ratio);
    const slices = planPdfPages(boxes, canvas.height, usableHeightPx, (startPx, limitPx) =>
      findWhitespaceBreakY(ctx, limitPx, startPx + usableHeightPx * 0.5, canvas.width),
    );

    slices.forEach((slice, index) => {
      if (index > 0) {
        pdf.addPage();
      }
      const sliceHeightPx = Math.max(1, Math.round(slice.endPx - slice.startPx));
      const pageCanvas = sliceCanvasPage(canvas, Math.round(slice.startPx), sliceHeightPx);
      const imgHeightPt = sliceHeightPx / pxPerPt;
      pdf.addImage(
        pageCanvas.toDataURL('image/jpeg', 0.95),
        'JPEG',
        0,
        PDF_MARGIN_PT,
        pageWidthPt,
        imgHeightPt,
      );
    });

    pdf.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}
