import type { PadObjectSnapshot, PoppinPadSnapshot } from '../../shared/poppin-pad';

export function exportPadToMarkdown(snapshot: PoppinPadSnapshot, title?: string): string {
  const heading = title ?? snapshot.pad.title ?? 'Poppin Pad';
  const cards = snapshot.objects.filter((object) => object.kind === 'card');
  const stickies = snapshot.objects.filter((object) => object.kind === 'sticky');
  const drawings = snapshot.objects.filter((object) => object.kind !== 'card' && object.kind !== 'sticky');

  const cardSections = cards.map((object) => formatCard(object)).join('\n\n');
  const stickySections = stickies.map((object) => formatSticky(object)).join('\n\n');
  const drawingSummary = drawings.length
    ? `## Canvas drawings\n\n${drawings.length} shape(s) and stroke(s) on the pad.\n`
    : '';

  const payload = {
    version: 1,
    pad: snapshot.pad,
    objects: snapshot.objects,
    exportedAt: new Date().toISOString(),
  };

  return `# ${heading}

${drawingSummary}${cardSections ? `${cardSections}\n\n` : ''}${stickySections ? `${stickySections}\n\n` : ''}\`\`\`poppin-pad
${JSON.stringify(payload, null, 2)}
\`\`\`
`;
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
