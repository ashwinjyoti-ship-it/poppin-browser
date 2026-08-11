import { describe, expect, it } from 'vitest';

import { parseCompareMatrix } from '../src/shared/compare-board';

describe('parseCompareMatrix', () => {
  it('returns null without a usable table', () => {
    expect(parseCompareMatrix('Just prose about two options.')).toBeNull();
    expect(parseCompareMatrix('')).toBeNull();
  });

  it('parses a GFM comparison table into options and attribute rows', () => {
    const markdown = `
## Shortlist

| Attribute | Air | XPS |
| --- | --- | --- |
| Price | $999 | $1,199 |
| Weight | 2.7 lb | 4.0 lb |
| Caveat | Ports limited | Heavier |

Done.
`;
    expect(parseCompareMatrix(markdown)).toEqual({
      options: ['Air', 'XPS'],
      rows: [
        { label: 'Price', cells: ['$999', '$1,199'] },
        { label: 'Weight', cells: ['2.7 lb', '4.0 lb'] },
        { label: 'Caveat', cells: ['Ports limited', 'Heavier'] },
      ],
    });
  });

  it('requires at least two option columns', () => {
    const markdown = `
| Attribute | Only |
| --- | --- |
| Price | $1 |
`;
    expect(parseCompareMatrix(markdown)).toBeNull();
  });
});
