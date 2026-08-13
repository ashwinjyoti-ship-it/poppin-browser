import { describe, expect, it } from 'vitest';

import {
  buildMailPolicyBlock,
  isMailWork,
  mailInboxTabId,
  normalizeMailInboxUrl,
  sanitizeMailSkillName,
  sanitizeMailSkillRule,
} from '../src/shared/mail';

describe('Poppin Mail helpers', () => {
  it('recognises mailbox work without a magic phrase', () => {
    expect(isMailWork('Check my inbox for unread quotes')).toBe(true);
    expect(isMailWork('Summarise meeting minutes in Gmail')).toBe(true);
    expect(isMailWork('Draft a reply to the request for quote')).toBe(true);
    expect(isMailWork('Write a haiku about spring')).toBe(false);
    expect(isMailWork('Update the RFQ spreadsheet')).toBe(false);
    expect(isMailWork('Summarise meeting minutes for the board deck')).toBe(false);
  });

  it('accepts only https inbox URLs', () => {
    expect(normalizeMailInboxUrl('mail.google.com')).toBe('https://mail.google.com/');
    expect(normalizeMailInboxUrl('https://outlook.live.com/mail/')).toBe('https://outlook.live.com/mail/');
    expect(normalizeMailInboxUrl('http://mail.example.com/')).toBeNull();
    expect(normalizeMailInboxUrl('not a url')).toBeNull();
  });

  it('finds an ordinary inbox tab by origin and ignores Agent Tabs', () => {
    expect(mailInboxTabId([
      { id: 'agent', url: 'https://mail.google.com/mail/u/0/#inbox', taskSpaceId: 'space-1' },
      { id: 'inbox', url: 'https://mail.google.com/mail/u/0/#inbox' },
    ], 'https://mail.google.com/')).toBe('inbox');
  });

  it('rejects credential-looking skill names and rules', () => {
    expect(sanitizeMailSkillName('Meeting invites')).toBe('Meeting invites');
    expect(sanitizeMailSkillName('Save the password')).toBeNull();
    expect(sanitizeMailSkillRule('Do not draft a reply to meeting minutes.')).toContain('meeting minutes');
    expect(sanitizeMailSkillRule('Read the cookie and continue.')).toBeNull();
  });

  it('builds an inspectable mail policy for the active harness', () => {
    const block = buildMailPolicyBlock('https://mail.google.com/', [{
      id: 'skill-1',
      name: 'Quotes',
      rule: 'Mails addressed to Ashwin with a request for quote get a draft reply.',
      enabled: true,
      createdAt: '',
      updatedAt: '',
    }]);
    expect(block).toContain('POPPIN MAIL POLICY');
    expect(block).toContain('https://mail.google.com/');
    expect(block).toContain('Quotes:');
    expect(block).toContain('Never ask for, read, or store passwords');
    expect(block).toContain('Stop before Send');
  });
});
