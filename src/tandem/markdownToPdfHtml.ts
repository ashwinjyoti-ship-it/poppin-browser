import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

/** Strip a leading markdown H1 when it matches the page title (avoids duplicate title in PDF). */
export function stripDuplicateTitle(markdown: string, title: string): string {
  const trimmed = markdown.trimStart();
  const match = trimmed.match(/^#\s+(.+?)(?:\n|$)/);
  if (!match) return markdown;
  // @ts-expect-error Tandem compiles without noUncheckedIndexedAccess; the match guarantees group 1.
  const heading = match[1].trim();
  const pageTitle = (title || 'Untitled').trim();
  if (heading.toLowerCase() !== pageTitle.toLowerCase()) return markdown;
  return trimmed.slice(match[0].length).trimStart();
}

export function markdownToPdfHtml(markdown: string, title: string): string {
  const body = stripDuplicateTitle(markdown, title);
  return marked.parse(body, { async: false }) as string;
}
