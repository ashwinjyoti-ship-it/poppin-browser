import { describe, expect, it } from 'vitest';

import { isReusableAgentSession } from '../src/shared/browser-agent';
import {
  buildMailPolicyBlock,
  classifyMailboxControl,
  isLiveMailAgentSession,
  isMailWork,
  isReusableMailAgentSession,
  isSignedInMailboxUrl,
  mailContextTabIds,
  mailInboxTabId,
  mailOrdinaryInboxTabId,
  normalizeMailInboxUrl,
  outlookWebInboxUrl,
  sanitizeMailSkillName,
  sanitizeMailSkillRule,
  shouldApplyMailPolicy,
  watchingMailNeedsWideViewport,
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

  it('prefers an Agent Tab inbox over an ordinary tab of the same origin', () => {
    expect(mailInboxTabId([
      { id: 'agent', url: 'https://mail.google.com/mail/u/0/#inbox', taskSpaceId: 'space-1' },
      { id: 'inbox', url: 'https://mail.google.com/mail/u/0/#inbox' },
    ], 'https://mail.google.com/')).toBe('agent');
    expect(mailOrdinaryInboxTabId([
      { id: 'agent', url: 'https://mail.google.com/mail/u/0/#inbox', taskSpaceId: 'space-1' },
      { id: 'inbox', url: 'https://mail.google.com/mail/u/0/#inbox' },
    ], 'https://mail.google.com/')).toBe('inbox');
  });

  it('treats a live Mail Agent Tab as a mailbox session even without mail language', () => {
    const tabs = [{ id: 'agent', url: 'https://mail.google.com/mail/u/0/#inbox', taskSpaceId: 'space-1' }];
    const agent = { state: 'running', taskSpace: { kept: false, tabIds: ['agent'] } };
    expect(isLiveMailAgentSession('https://mail.google.com/', tabs, agent)).toBe(true);
    expect(shouldApplyMailPolicy('Handle the quotes.', true)).toBe(true);
    expect(shouldApplyMailPolicy('Handle the quotes.', false)).toBe(false);
    expect(isLiveMailAgentSession('https://mail.google.com/', tabs, { state: 'idle', taskSpace: null })).toBe(false);
  });

  it('reuses completed or kept Mail Agent Tabs on the saved inbox origin', () => {
    const tabs = [{ id: 'agent', url: 'https://outlook.live.com/mail/u/0/', taskSpaceId: 'space-1' }];
    expect(isReusableMailAgentSession('https://outlook.live.com/mail/', tabs, {
      state: 'completed', taskSpace: { tabIds: ['agent'] },
    })).toBe(true);
    expect(isReusableMailAgentSession('https://outlook.live.com/mail/', tabs, {
      state: 'stopped', taskSpace: { tabIds: ['agent'] },
    })).toBe(true);
    expect(isLiveMailAgentSession('https://outlook.live.com/mail/', tabs, {
      state: 'completed', taskSpace: { kept: true, tabIds: ['agent'] },
    })).toBe(false);
    expect(isReusableMailAgentSession('https://outlook.live.com/mail/', tabs, {
      state: 'idle', taskSpace: { tabIds: ['agent'] },
    })).toBe(false);
    expect(isReusableAgentSession({ state: 'completed', taskSpace: { tabIds: ['research'] } })).toBe(true);
    expect(isReusableAgentSession({ state: 'stopped', taskSpace: { tabIds: ['research'] } })).toBe(true);
    expect(isReusableAgentSession({ state: 'idle', taskSpace: { tabIds: ['research'] } })).toBe(false);
    expect(isReusableAgentSession({ state: 'completed', taskSpace: { tabIds: [] } })).toBe(false);
  });

  it('clones only selected tabs that already match the saved inbox origin', () => {
    expect(mailContextTabIds([
      { id: 'inbox', url: 'https://outlook.live.com/mail/u/0/' },
      { id: 'youtube', url: 'https://www.youtube.com/watch?v=1' },
      { id: 'agent', url: 'https://outlook.live.com/mail/u/0/', taskSpaceId: 'space-1' },
    ], ['inbox', 'youtube', 'agent'], 'https://outlook.live.com/mail/')).toEqual(['inbox']);
  });

  it('treats signed-in mailbox URLs as ordinary after auth, not leftover sign-in chrome', () => {
    expect(isSignedInMailboxUrl('https://outlook.live.com/mail/u/0/')).toBe(true);
    expect(isSignedInMailboxUrl('https://login.microsoftonline.com/common/oauth2')).toBe(false);
    expect(isSignedInMailboxUrl('https://outlook.live.com/mail/u/0/', 'https://outlook.live.com/mail/')).toBe(true);
    expect(isSignedInMailboxUrl('https://mail.google.com/mail/u/0/#inbox', 'https://outlook.live.com/mail/')).toBe(false);
    expect(outlookWebInboxUrl('outlook.cloud.microsoft')).toBe('https://outlook.cloud.microsoft/mail/');
    expect(isSignedInMailboxUrl('https://outlook.cloud.microsoft/mail/')).toBe(true);
    expect(isSignedInMailboxUrl('https://outlook.cloud.microsoft/mail/oauthRedirect.html')).toBe(false);
    expect(classifyMailboxControl('Search')).toBe('ordinary');
    expect(classifyMailboxControl('Deleted Items')).toBe('ordinary');
    expect(classifyMailboxControl('Sign in with a different account')).toBe('ordinary');
    expect(classifyMailboxControl('Reply')).toBe('ordinary');
    expect(classifyMailboxControl('Send')).toBe('send');
    expect(classifyMailboxControl('Send email')).toBe('send');
    expect(classifyMailboxControl('Delete')).toBe('delete');
    expect(classifyMailboxControl('Delete forever')).toBe('delete');
  });

  it('widens the viewport only while watching a signed-in mailbox Agent Tab', () => {
    const tabs = [{ url: 'https://outlook.live.com/mail/u/0/', taskSpaceId: 'space-1' }];
    expect(watchingMailNeedsWideViewport(true, 'https://outlook.live.com/mail/', tabs, 'space-1')).toBe(true);
    expect(watchingMailNeedsWideViewport(false, 'https://outlook.live.com/mail/', tabs, 'space-1')).toBe(false);
    expect(watchingMailNeedsWideViewport(true, 'https://outlook.live.com/mail/', [
      { url: 'https://login.microsoftonline.com/', taskSpaceId: 'space-1' },
    ], 'space-1')).toBe(false);
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
    expect(block).toContain('Enabled mail skills are already in force');
  });
});
