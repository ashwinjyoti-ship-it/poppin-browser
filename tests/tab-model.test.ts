import { describe, expect, it } from 'vitest';

import { closeTabModel, createRestorableTab } from '../src/main/browser/tab-model';
import { NEW_TAB_URL } from '../src/main/browser/url-input';

describe('tab model', () => {
  it('creates a restorable normalized tab', () => {
    expect(createRestorableTab('example.com', 'one')).toEqual({
      id: 'one',
      url: 'https://example.com/',
    });
  });

  it('selects the neighboring tab when closing the active tab', () => {
    const tabs = [
      { id: 'one', url: 'https://one.test/' },
      { id: 'two', url: 'https://two.test/' },
      { id: 'three', url: 'https://three.test/' },
    ];
    expect(closeTabModel(tabs, 'two', 'two')).toEqual({
      tabs: [tabs[0], tabs[2]],
      activeTabId: 'three',
    });
  });

  it('replaces the final closed tab with a new tab', () => {
    expect(closeTabModel([{ id: 'one', url: 'https://one.test/' }], 'one', 'one', 'new')).toEqual({
      tabs: [{ id: 'new', url: NEW_TAB_URL }],
      activeTabId: 'new',
    });
  });
});

