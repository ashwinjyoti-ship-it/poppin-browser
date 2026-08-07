import { describe, expect, it } from 'vitest';

import { isAllowedBrowsingPermission } from '../src/main/browser/permissions';

describe('browsing permissions', () => {
  it('allows only fullscreen for ordinary browser pages', () => {
    expect(isAllowedBrowsingPermission('fullscreen')).toBe(true);
    expect(isAllowedBrowsingPermission('media')).toBe(false);
    expect(isAllowedBrowsingPermission('camera')).toBe(false);
    expect(isAllowedBrowsingPermission('clipboard-read')).toBe(false);
  });
});
