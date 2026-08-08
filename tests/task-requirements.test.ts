import { describe, expect, it } from 'vitest';

import { inferTaskRequirements } from '../src/shared/task-requirements';

describe('task capability inference', () => {
  it('keeps summaries and document work independent from Git', () => {
    expect(inferTaskRequirements('Give me a five-point summary of this video.', false)).toMatchObject({
      kind: 'work', modifiesProject: false,
    });
    expect(inferTaskRequirements('Compare these two selected documents.', true)).toMatchObject({
      kind: 'work', modifiesProject: false,
    });
  });

  it('identifies project changes and consequential delivery separately', () => {
    expect(inferTaskRequirements('Fix this UI and create a pull request.', true)).toEqual({
      kind: 'code', browserUse: false, modifiesProject: true, consequentialActions: ['create a pull request'],
    });
  });

  it('detects requests for visible browser use', () => {
    expect(inferTaskRequirements('Research this using the approved tabs and browse the sources.', false).browserUse).toBe(true);
    expect(inferTaskRequirements('Use the selected website. Click “More information”, read the destination page, and do not modify my original source tab.', false)).toMatchObject({
      kind: 'work', browserUse: true, modifiesProject: false,
    });
    expect(inferTaskRequirements('Draft an email reply and save the draft.', false)).toMatchObject({
      kind: 'work', browserUse: true, consequentialActions: [],
    });
  });
});
