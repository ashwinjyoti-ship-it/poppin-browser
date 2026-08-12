import type { PadObjectSnapshot, PadPoint, PoppinPadSnapshot } from '../../shared/poppin-pad';

export function exportPadToMarkdown(snapshot: PoppinPadSnapshot, title?: string): string {
  const heading = title ?? snapshot.pad.title ?? 'Poppin Pad';
  const cards = snapshot.objects.filter((object) => object.kind === 'card');
  const stickies = snapshot.objects.filter((object) => object.kind === 'sticky');
  const texts = snapshot.objects.filter((object) => object.kind === 'text');
  const drawings = snapshot.objects.filter((object) => object.kind === 'stroke' || object.kind === 'arrow' || object.kind === 'rect');

  const sections: string[] = [`# ${heading}`, ''];

  if (drawings.length > 0) {
    sections.push('## Canvas drawings', '');
    sections.push(`${drawings.length} shape(s) and stroke(s) on the pad.`, '');
    sections.push(drawingsToSvgHtml(drawings), '');
    for (const object of drawings) {
      sections.push(`- ${describeDrawing(object)}`);
    }
    sections.push('');
  }

  for (const object of texts) {
    const payload = object.payload as { text?: string };
    sections.push(`## Text`, '', payload.text?.trim() || '_Empty text_', '');
  }

  for (const object of stickies) {
    sections.push(formatSticky(object), '');
  }

  for (const object of cards) {
    sections.push(formatCard(object), '');
  }

  if (sections.length <= 2) {
    sections.push('_Empty Poppin Pad._', '');
  }

  return `${sections.join('\n').trim()}\n`;
}

function formatCard(object: PadObjectSnapshot): string {
  const payload = object.payload as { title?: string; text?: string; sourceUrl?: string; subtype?: string };
  const lines = [
    `## ${payload.title ?? 'Card'}`,
    payload.subtype ? `_Type: ${payload.subtype}_` : '',
    payload.sourceUrl ? `[Source](${payload.sourceUrl})` : '',
    payload.text ? `\n${payload.text}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function formatSticky(object: PadObjectSnapshot): string {
  const payload = object.payload as { text?: string };
  return `> **Sticky note**\n>\n> ${(payload.text ?? '').replace(/\n/g, '\n> ')}`;
}

function describeDrawing(object: PadObjectSnapshot): string {
  if (object.kind === 'stroke') {
    const payload = object.payload as { points: PadPoint[] };
    return `Freehand stroke (${payload.points.length} points)`;
  }
  if (object.kind === 'arrow') {
    const payload = object.payload as { x1: number; y1: number; x2: number; y2: number };
    return `Arrow from (${Math.round(payload.x1)}, ${Math.round(payload.y1)}) to (${Math.round(payload.x2)}, ${Math.round(payload.y2)})`;
  }
  return `Rectangle ${Math.round(object.width)}×${Math.round(object.height)} at (${Math.round(object.x)}, ${Math.round(object.y)})`;
}

function drawingsToSvgHtml(objects: PadObjectSnapshot[]): string {
  let maxX = 320;
  let maxY = 240;
  for (const object of objects) {
    if (object.kind === 'stroke') {
      const payload = object.payload as { points: PadPoint[] };
      for (const point of payload.points) {
        maxX = Math.max(maxX, point.x + 16);
        maxY = Math.max(maxY, point.y + 16);
      }
    } else if (object.kind === 'arrow') {
      const payload = object.payload as { x1: number; y1: number; x2: number; y2: number };
      maxX = Math.max(maxX, payload.x1, payload.x2);
      maxY = Math.max(maxY, payload.y1, payload.y2);
    } else {
      maxX = Math.max(maxX, object.x + object.width + 16);
      maxY = Math.max(maxY, object.y + object.height + 16);
    }
  }

  const body = objects.map((object) => {
    if (object.kind === 'stroke') {
      const payload = object.payload as { points: PadPoint[]; color: string; width: number };
      return `<path d="${escapeAttr(strokePath(payload.points))}" stroke="${escapeAttr(payload.color)}" stroke-width="${payload.width}" fill="none" stroke-linecap="round"/>`;
    }
    if (object.kind === 'arrow') {
      const payload = object.payload as { x1: number; y1: number; x2: number; y2: number; color: string; width: number };
      return `<line x1="${payload.x1}" y1="${payload.y1}" x2="${payload.x2}" y2="${payload.y2}" stroke="${escapeAttr(payload.color)}" stroke-width="${payload.width}" marker-end="url(#pad-arrow)"/>`;
    }
    const payload = object.payload as { stroke: string; fill: string; strokeWidth: number };
    return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" stroke="${escapeAttr(payload.stroke)}" fill="${escapeAttr(payload.fill)}" stroke-width="${payload.strokeWidth}" rx="8"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(maxX)}" height="${Math.ceil(maxY)}" viewBox="0 0 ${Math.ceil(maxX)} ${Math.ceil(maxY)}" style="max-width:100%;background:#fffdf9;border:1px solid #e2d8cc;border-radius:12px">
  <defs><marker id="pad-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#d8892b"/></marker></defs>
  ${body}
</svg>`;
}

function strokePath(points: PadPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  return `M ${first.x} ${first.y}${points.slice(1).map((point) => ` L ${point.x} ${point.y}`).join('')}`;
}

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
