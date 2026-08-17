import { type FormEvent, useState } from 'react';
import { Mail, Plus, X } from 'lucide-react';

import type { WorkspaceCommand, WorkspaceCommandResult, WorkspaceSnapshot } from '../../shared/workspace';
import type { BrowserTabSnapshot } from '../../shared/browser';
import {
  MAIL_INBOX_PRESETS,
  mailInboxTabId,
  normalizeMailInboxUrl,
  type MailSkillSnapshot,
} from '../../shared/mail';

interface MailSectionProps {
  workspace: WorkspaceSnapshot;
  tabs: BrowserTabSnapshot[];
  onCommand: (command: WorkspaceCommand) => Promise<WorkspaceCommandResult>;
  onOpenInbox: (url: string) => void | Promise<{ ok: boolean; message?: string }>;
}

/**
 * Dedicated Mail hub: pick an https webmail inbox, generate natural-language
 * mailbox skills, then ask the command bar in plain language. Login stays in
 * Poppin's persistent browser session.
 */
export function MailSection({ workspace, tabs, onCommand, onOpenInbox }: MailSectionProps) {
  const inboxUrl = workspace.mailInboxUrl ?? null;
  const skills = workspace.mailSkills ?? [];
  const inboxOpen = Boolean(mailInboxTabId(tabs, inboxUrl));
  const [inboxDraft, setInboxDraft] = useState('');
  const inboxInput = inboxDraft || inboxUrl || '';
  const [skillName, setSkillName] = useState('');
  const [skillRule, setSkillRule] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const run = async (command: WorkspaceCommand): Promise<WorkspaceCommandResult> => {
    try {
      const result = await onCommand(command);
      if (!result || typeof result.ok !== 'boolean') {
        const fallback = { ok: false, message: 'Could not update Mail.' };
        setMessage(fallback.message);
        return fallback;
      }
      setMessage(result.message ?? (result.ok ? '' : 'Could not update Mail.'));
      return result;
    } catch {
      const fallback = { ok: false, message: 'Could not update Mail.' };
      setMessage(fallback.message);
      return fallback;
    }
  };

  const saveInbox = async (raw: string) => {
    const url = normalizeMailInboxUrl(raw);
    if (!url) {
      setMessage('Use an https webmail address.');
      return null;
    }
    const result = await run({ type: 'setMailInboxUrl', url });
    if (result.ok) setInboxDraft(url);
    return result.ok ? url : null;
  };

  const saveSkill = async (rawName = skillName, rawRule = skillRule) => {
    const name = rawName.trim();
    const rule = rawRule.trim();
    if (!name) {
      setMessage('Give the mail skill a short name.');
      return;
    }
    if (!rule) {
      setMessage('Describe the mail skill in plain language, without passwords or secrets.');
      return;
    }
    const result = editingId
      ? await run({ type: 'updateMailSkill', skillId: editingId, name, rule })
      : await run({ type: 'createMailSkill', name, rule });
    if (result.ok) {
      setSkillName('');
      setSkillRule('');
      setEditingId(null);
    }
  };

  const submitSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void saveSkill(
      String(data.get('mail-skill-name') ?? skillName),
      String(data.get('mail-skill-rule') ?? skillRule),
    );
  };

  return (
    <div className="mail-section">
      <div className="task-tab-heading">
        <div>
          <span className="eyebrow">Poppin Mail</span>
          <h2>Inbox and mail skills</h2>
        </div>
        <span className={`task-state ${inboxOpen ? 'task-state-completed' : ''}`}>{inboxOpen ? 'Inbox open' : 'Inbox idle'}</span>
      </div>

      <p className="mail-lede">
        Open inbox starts Agent Tabs on your saved webmail. Sign in there — Poppin keeps that session in its own browser partition and never stores passwords.
        Enabled mail skills are handed to the agent automatically. Ask in the command bar; reading and drafts run in those Agent Tabs, and sending waits for approval.
      </p>

      <section className="mail-card" aria-label="Mail inbox">
        <span className="eyebrow">Inbox</span>
        <label className="mail-field">
          <span>Webmail address</span>
          <input
            value={inboxInput}
            onChange={(event) => setInboxDraft(event.target.value)}
            placeholder="https://mail.google.com/"
            aria-label="Webmail address"
          />
        </label>
        <div className="mail-presets">
          {MAIL_INBOX_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="chip-button"
              onClick={() => {
                setInboxDraft(preset.url);
                void saveInbox(preset.url);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mail-inbox-actions">
          <button type="button" className="secondary-button" onClick={() => { void saveInbox(inboxInput); }}>Save inbox</button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              void (async () => {
                const url = normalizeMailInboxUrl(inboxInput) ?? inboxUrl;
                if (!url) {
                  setMessage('Use an https webmail address.');
                  return;
                }
                if (url !== inboxUrl) {
                  const result = await run({ type: 'setMailInboxUrl', url });
                  if (!result.ok) return;
                }
                const opened = await Promise.resolve(onOpenInbox(url));
                if (opened && opened.ok === false) setMessage(opened.message ?? 'Could not open Mail as Agent Tabs.');
              })();
            }}
          >
            <Mail size={14} /> {inboxOpen ? 'Show inbox' : 'Open inbox'}
          </button>
        </div>
      </section>

      <form className="mail-card" aria-label="Mail skill generator" onSubmit={submitSkill}>
        <span className="eyebrow">Skill generator</span>
        <h3>{editingId ? 'Edit mail skill' : 'New mail skill'}</h3>
        <p className="mail-hint">Describe the behaviour in natural language. Enabled skills are ingested into Mail Agent Tabs automatically — the harness follows them on the next command-bar request.</p>
        <label className="mail-field">
          <span>Name</span>
          <input
            name="mail-skill-name"
            value={skillName}
            onChange={(event) => setSkillName(event.target.value)}
            placeholder="Meeting invites"
            aria-label="Mail skill name"
            maxLength={80}
            autoComplete="off"
          />
        </label>
        <label className="mail-field">
          <span>Rule</span>
          <textarea
            name="mail-skill-rule"
            value={skillRule}
            onChange={(event) => setSkillRule(event.target.value)}
            placeholder="When an email is a meeting invite or minutes, do not draft a reply. Extract the proposed times and summarise them instead."
            aria-label="Mail skill rule"
            rows={4}
          />
        </label>
        <div className="mail-inbox-actions">
          {editingId ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setEditingId(null);
                setSkillName('');
                setSkillRule('');
              }}
            >
              Cancel edit
            </button>
          ) : null}
          <button type="submit" className="primary-button">
            <Plus size={14} aria-hidden="true" /> {editingId ? 'Update skill' : 'Save skill'}
          </button>
        </div>
        {message ? <p className="review-message" role="status">{message}</p> : null}
      </form>

      <section className="mail-card" aria-label="Saved mail skills">
        <span className="eyebrow">Enabled for every harness</span>
        <h3>Saved skills</h3>
        {skills.length === 0 ? (
          <p className="section-empty">No mail skills yet. Example: mails addressed to you with a request for quote get a draft reply; meeting minutes do not.</p>
        ) : (
          <ul className="mail-skill-list">
            {skills.map((skill) => (
              <MailSkillRow
                key={skill.id}
                skill={skill}
                onEdit={() => {
                  setEditingId(skill.id);
                  setSkillName(skill.name);
                  setSkillRule(skill.rule);
                }}
                onCommand={(command) => { void run(command); }}
              />
            ))}
          </ul>
        )}
      </section>

      {message ? <p className="review-message" role="status">{message}</p> : null}
    </div>
  );
}

function MailSkillRow({ skill, onEdit, onCommand }: {
  skill: MailSkillSnapshot;
  onEdit: () => void;
  onCommand: (command: WorkspaceCommand) => void;
}) {
  return (
    <li className={`mail-skill-row ${skill.enabled ? '' : 'mail-skill-disabled'}`}>
      <div>
        <strong>{skill.name}</strong>
        <p>{skill.rule}</p>
      </div>
      <div className="mail-skill-actions">
        <button type="button" onClick={() => onCommand({ type: 'setMailSkillEnabled', skillId: skill.id, enabled: !skill.enabled })}>
          {skill.enabled ? 'Disable' : 'Enable'}
        </button>
        <button type="button" onClick={onEdit}>Edit</button>
        <button type="button" aria-label={`Delete ${skill.name}`} onClick={() => onCommand({ type: 'deleteMailSkill', skillId: skill.id })}>
          <X size={13} />
        </button>
      </div>
    </li>
  );
}
