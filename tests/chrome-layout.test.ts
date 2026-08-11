import { describe, expect, it } from 'vitest';

import { getChromeLayout, getTitlebarLeftInset } from '../src/renderer/ui/chrome-layout';

describe('responsive browser chrome', () => {
  it('uses the roomy layout only when both dimensions have space', () => {
    expect(getChromeLayout(1728, 1117)).toEqual({ density: 'roomy', height: 103 });
  });

  it('uses compact chrome for typical 13-inch laptop space', () => {
    expect(getChromeLayout(1470, 956)).toEqual({ density: 'compact', height: 86 });
    expect(getChromeLayout(1366, 1024)).toEqual({ density: 'compact', height: 86 });
  });

  it('uses dense chrome when either usable dimension is constrained', () => {
    expect(getChromeLayout(900, 900)).toEqual({ density: 'dense', height: 76 });
    expect(getChromeLayout(1600, 620)).toEqual({ density: 'dense', height: 76 });
  });

  it('keeps only the traffic-light safe inset in a window', () => {
    expect(getTitlebarLeftInset('roomy', false)).toBe(82);
    expect(getTitlebarLeftInset('compact', false)).toBe(80);
    expect(getTitlebarLeftInset('dense', false)).toBe(76);
  });

  it('moves the logo near the top-left when fullscreen removes traffic lights', () => {
    expect(getTitlebarLeftInset('roomy', true)).toBe(16);
    expect(getTitlebarLeftInset('compact', true)).toBe(12);
    expect(getTitlebarLeftInset('dense', true)).toBe(12);
  });
});
