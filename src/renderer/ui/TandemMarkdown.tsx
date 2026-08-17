import DOMPurify from 'dompurify';
import { type MouseEvent, useMemo } from 'react';

import { markdownToPdfHtml } from '../../tandem/markdownToPdfHtml';

export function TandemMarkdown({
  markdown,
  title,
  className = '',
  onFileLink,
}: {
  markdown: string;
  title: string;
  className?: string;
  onFileLink?: (href: string) => void;
}) {
  const html = useMemo(
    () => wrapScrollableTables(DOMPurify.sanitize(markdownToPdfHtml(markdown || 'No result was returned.', title))),
    [markdown, title],
  );

  const openLink = (event: MouseEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    const href = target?.getAttribute('href');
    if (!href) return;
    if (/^https?:\/\//iu.test(href)) {
      event.preventDefault();
      void window.poppinBrowser.command({ type: 'create', input: href });
      return;
    }
    event.preventDefault();
    onFileLink?.(href);
  };

  return <article className={`tandem-markdown ${className}`} onClick={openLink} dangerouslySetInnerHTML={{ __html: html }} />;
}

function wrapScrollableTables(html: string): string {
  return html
    .replaceAll('<table>', '<div class="tandem-table-scroll" role="region" aria-label="Scrollable table" tabindex="0"><table>')
    .replaceAll('</table>', '</table></div>');
}
