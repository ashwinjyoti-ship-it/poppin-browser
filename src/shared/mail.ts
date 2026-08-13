/**
 * Poppin Mail: a dedicated inbox surface plus user-defined natural-language
 * skills. Login stays in the persistent browser partition. Skills never store
 * passwords, cookies, tokens, or Keychain material.
 */

export const MAIL_INBOX_PRESETS = [
  { id: 'gmail', label: 'Gmail', url: 'https://mail.google.com/' },
  { id: 'outlook', label: 'Outlook', url: 'https://outlook.live.com/mail/' },
  { id: 'fastmail', label: 'Fastmail', url: 'https://app.fastmail.com/mail/' },
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

export function mailInboxTabId(
  tabs: ReadonlyArray<{ id: string; url: string; taskSpaceId?: string | null }>,
  inboxUrl: string | null | undefined,
): string | null {
  const origin = mailInboxOrigin(inboxUrl);
  if (!origin) return null;
  const match = tabs.find((tab) => !tab.taskSpaceId && tab.url.startsWith(origin));
  return match?.id ?? null;
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
  ];
  if (enabled.length > 0) {
    lines.push('User-defined mail skills:');
    for (const skill of enabled) {
      lines.push(`- ${skill.name}: ${skill.rule}`);
    }
  }
  return lines.join('\n');
}
