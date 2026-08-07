import { describe, expect, it } from 'vitest';

import { getChromeLayout } from '../src/renderer/ui/chrome-layout';

describe('responsive browser chrome', () => {
  it('uses the roomy layout only when both dimensions have space', () => {
    expect(getChromeLayout(1728, 1117)).toEqual({ density: 'roomy', height: 152 });
  });

  it('uses compact chrome for typical 13-inch laptop space', () => {
    expect(getChromeLayout(1470, 956)).toEqual({ density: 'compact', height: 124 });
    expect(getChromeLayout(1366, 1024)).toEqual({ density: 'compact', height: 124 });
  });

  it('uses dense chrome when either usable dimension is constrained', () => {
    expect(getChromeLayout(900, 900)).toEqual({ density: 'dense', height: 108 });
    expect(getChromeLayout(1600, 620)).toEqual({ density: 'dense', height: 108 });
  });
});
