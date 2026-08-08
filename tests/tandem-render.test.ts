import { describe, expect, it } from 'vitest';

import { markdownToPdfHtml } from '../src/tandem/markdownToPdfHtml';

describe('Tandem Markdown rendering', () => {
  it('formats research tables, emphasis, lists, and source links as document HTML', () => {
    const html = markdownToPdfHtml('# Guitar research\n\n**Best value**\n\n| Guitar | Price |\n| --- | --- |\n| Model A | ₹9,999 |\n\n- [Buy it](https://shop.example/guitar)', 'Guitar research');
    expect(html).not.toContain('<h1>Guitar research</h1>');
    expect(html).toContain('<strong>Best value</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('<a href="https://shop.example/guitar">Buy it</a>');
  });
});
