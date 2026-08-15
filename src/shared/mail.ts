/**
 * Poppin Mail: a dedicated inbox surface plus user-defined natural-language
 * skills. Login stays in the persistent browser partition. Skills never store
 * passwords, cookies, tokens, or Keychain material.
 */

export const MAIL_INBOX_PRESETS = [
  { id: 'mailbox-1', label: 'Mailbox 1', url: 'https://mail.google.com/' },
  { id: 'mailbox-2', label: 'Mailbox 2', url: 'https://outlook.live.com/mail/' },
  { id: 'mailbox-3', label: 'Mailbox 3', url: 'https://app.fastmail.com/mail/' },
] as const;

export interface MailSkillSnapshot {
  id: string;
  name: string;
  /** Natural-language policy the harness follows for matching mail. */
  rule: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const CREDENTIAL_HINT = /\b(password|passkey|credential|otp|one[-_ ]?time|verification[-_ ]?code|cookie|token|secret|keychain|apple passwords?)\b/i;
const MAIL_CONTEXT = /\b(?:e-?mails?|inbox|unread|mailbox|webmail|gmail|outlook|fastmail)\b/i;
const MAIL_ACTIONS = /\b(?:reply to|draft (?:an? )?(?:e-?mail|reply)|check (?:my )?(?:mail|inbox)|send (?:an? )?(?:e-?mail|mail|reply))\b/i;
const MAIL_MEETING = /\b(?:meeting invite|minutes of (?:the )?meeting)\b/i;
const MAIL_RFQ = /\b(?:request for quote|\brfq\b)\b/i;

export function isMailWork(prompt: string): boolean {
  if (MAIL_CONTEXT.test(prompt) || MAIL_ACTIONS.test(prompt)) return true;
  if (MAIL_MEETING.test(prompt) && /\b(?:mail|email|inbox)\b/i.test(prompt)) return true;
  if (MAIL_RFQ.test(prompt) && /\b(?:mail|email|inbox|reply|draft)\b/i.test(prompt)) return true;
  return false;
}

export function normalizeMailInboxUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function mailInboxOrigin(inboxUrl: string | null | undefined): string | null {
  if (!inboxUrl) return null;
  try {
    return new URL(inboxUrl).origin;
  } catch {
    return null;
  }
}

const LIVE_AGENT_STATES = new Set(['running', 'paused', 'needs-approval']);
const REUSABLE_AGENT_STATES = new Set(['running', 'paused', 'needs-approval', 'completed', 'stopped']);
const MAILBOX_AUTH_HOSTS = new Set(['login.microsoftonline.com', 'login.live.com', 'accounts.google.com']);

export function mailInboxTabId(
  tabs: ReadonlyArray<{ id: string; url: string; taskSpaceId?: string | null }>,
  inboxUrl: string | null | undefined,
): string | null {
  const origin = mailInboxOrigin(inboxUrl);
  if (!origin) return null;
  const agent = tabs.find((tab) => tab.taskSpaceId && tab.url.startsWith(origin));
  if (agent) return agent.id;
  const match = tabs.find((tab) => !tab.taskSpaceId && tab.url.startsWith(origin));
  return match?.id ?? null;
}

/** Ordinary (non-agent) inbox tab, used only to clone into a new Mail Agent Tabs session. */
export function mailOrdinaryInboxTabId(
  tabs: ReadonlyArray<{ id: string; url: string; taskSpaceId?: string | null }>,
  inboxUrl: string | null | undefined,
): string | null {
  const origin = mailInboxOrigin(inboxUrl);
  if (!origin) return null;
  return tabs.find((tab) => !tab.taskSpaceId && tab.url.startsWith(origin))?.id ?? null;
}

export function isLiveMailAgentSession(
  inboxUrl: string | null | undefined,
  tabs: ReadonlyArray<{ id: string; url: string; taskSpaceId?: string | null }>,
  agent: { state: string; taskSpace: { kept: boolean; tabIds: string[] } | null } | null | undefined,
): boolean {
  if (!agent?.taskSpace || agent.taskSpace.kept) return false;
  if (!LIVE_AGENT_STATES.has(agent.state)) return false;
  const inboxId = mailInboxTabId(tabs, inboxUrl);
  return Boolean(inboxId && agent.taskSpace.tabIds.includes(inboxId));
}

/** Completed or kept Mail Agent Tabs that the next Work turn can resume. */
export function isReusableMailAgentSession(
  inboxUrl: string | null | undefined,
  tabs: ReadonlyArray<{ id: string; url: string; taskSpaceId?: string | null }>,
  agent: { state: string; taskSpace: { tabIds: string[] } | null } | null | undefined,
): boolean {
  if (!agent?.taskSpace) return false;
  if (!REUSABLE_AGENT_STATES.has(agent.state)) return false;
  const inboxId = mailInboxTabId(tabs, inboxUrl);
  return Boolean(inboxId && agent.taskSpace.tabIds.includes(inboxId));
}

/** Selected context tabs that are actually the saved inbox, not unrelated pages. */
export function mailContextTabIds(
  tabs: ReadonlyArray<{ id: string; url: string; taskSpaceId?: string | null }>,
  selectedTabIds: readonly string[],
  inboxUrl: string | null | undefined,
): string[] {
  const origin = mailInboxOrigin(inboxUrl);
  if (!origin) return [];
  return selectedTabIds.filter((id) => {
    const tab = tabs.find((item) => item.id === id);
    return Boolean(tab && !tab.taskSpaceId && tab.url.startsWith(origin));
  });
}

export function isMailboxHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'outlook.live.com'
    || host.endsWith('.outlook.com')
    || host === 'outlook.office.com'
    || host === 'outlook.office365.com'
    || host.endsWith('.office.com')
    || host === 'mail.google.com'
    || host === 'app.fastmail.com';
}

export function isMailboxAuthUrl(value: string): boolean {
  try {
    const target = new URL(value);
    if (MAILBOX_AUTH_HOSTS.has(target.hostname)) return true;
    return /authredirect/i.test(`${target.pathname}${target.search}${target.hash}`);
  } catch {
    return true;
  }
}

/** True when the live tab is a signed-in webmail page, not an auth interstitial. */
export function isSignedInMailboxUrl(tabUrl: string, inboxUrl?: string | null): boolean {
  try {
    const target = new URL(tabUrl);
    if (target.protocol !== 'https:') return false;
    if (isMailboxAuthUrl(tabUrl)) return false;
    const origin = mailInboxOrigin(inboxUrl);
    if (origin) return target.origin === origin || tabUrl.startsWith(origin);
    return isMailboxHost(target.hostname);
  } catch {
    return false;
  }
}

export type MailboxControlGate = 'ordinary' | 'send' | 'delete';

/**
 * After sign-in, only compose Send and permanent Delete pause. Folder names,
 * Search, Reply, and leftover “Sign in” chrome stay ordinary.
 */
export function classifyMailboxControl(name: string): MailboxControlGate {
  const text = name.replace(/\s+/gu, ' ').trim();
  if (!text) return 'ordinary';
  if (/^send(?:\s+(?:email|e-?mail|mail|message|now))?$/i.test(text)) return 'send';
  if (/^delete(?:\s+(?:email|e-?mail|mail|message|item|forever|permanently))?$/i.test(text)) return 'delete';
  return 'ordinary';
}

export function watchingMailNeedsWideViewport(
  watching: boolean,
  inboxUrl: string | null | undefined,
  tabs: ReadonlyArray<{ url: string; taskSpaceId?: string | null }>,
  taskSpaceId: string | null | undefined,
): boolean {
  if (!watching || !taskSpaceId) return false;
  return tabs.some((tab) => tab.taskSpaceId === taskSpaceId && isSignedInMailboxUrl(tab.url, inboxUrl));
}

export function shouldApplyMailPolicy(prompt: string, mailSessionLive: boolean): boolean {
  return mailSessionLive || isMailWork(prompt);
}

export function sanitizeMailSkillName(raw: string): string | null {
  const name = raw.replace(/\s+/gu, ' ').trim();
  if (!name) return null;
  if (name.length > 80) return null;
  if (CREDENTIAL_HINT.test(name)) return null;
  return name;
}

export function sanitizeMailSkillRule(raw: string): string | null {
  const rule = raw.replace(/\s+/gu, ' ').trim();
  if (!rule) return null;
  if (rule.length > 2_000) return null;
  if (CREDENTIAL_HINT.test(rule)) return null;
  return rule;
}

/**
 * Inspectable mail policy injected into a Work prompt. The harness follows it
 * only when the request involves the user's mailbox.
 */
export function buildMailPolicyBlock(
  inboxUrl: string | null | undefined,
  skills: readonly MailSkillSnapshot[] | undefined,
): string | null {
  const enabled = (skills ?? []).filter((skill) => skill.enabled);
  if (!inboxUrl && enabled.length === 0) return null;
  const lines = [
    'POPPIN MAIL POLICY (follow only when this request involves the user\'s mailbox)',
    inboxUrl ? `Inbox: ${inboxUrl}` : 'Inbox URL is not set; ask the user to open Mail and save one.',
    'Sign-in uses Poppin\'s existing persistent browser session. Never ask for, read, or store passwords, codes, cookies, tokens, or Keychain data.',
    'Read, search, and save drafts without extra confirmation. Stop before Send, Delete, or any irreversible mailbox action — Poppin will show an approval.',
    'Enabled mail skills are already in force. Follow them without waiting for the user to restate them.',
  ];
  if (enabled.length > 0) {
    lines.push('User-defined mail skills:');
    for (const skill of enabled) {
      lines.push(`- ${skill.name}: ${skill.rule}`);
    }
  }
  return lines.join('\n');
}
