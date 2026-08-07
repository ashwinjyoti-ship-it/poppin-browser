import { randomUUID } from 'node:crypto';

import {
  BROWSER_AGENT_CHANNELS,
  type BrowserAgentAction,
  type BrowserAgentApproval,
  type BrowserAgentCommand,
  type BrowserAgentCommandResult,
  type BrowserAgentLogEntry,
  type BrowserAgentSnapshot,
} from '../../shared/browser-agent';

const MAX_LOG_ENTRIES = 300;
const CREDENTIAL_SELECTOR = /password|passkey|credential|one[-_ ]?time|otp|verification[-_ ]?code/i;
const AUTH_URL = /\b(sign[-_ ]?in|log[-_ ]?in|authenticate|oauth|passkey|password)\b/i;

export interface BrowserAgentPageController {
  hasTab(tabId: string): boolean;
  describeTab?(tabId: string): string;
  activateTabForAgent(tabId: string): boolean;
  inspectAction(tabId: string, action: BrowserAgentAction): Promise<{ credential: boolean; consequential: string | null; target: string }>;
  performAction(tabId: string, action: BrowserAgentAction): Promise<string>;
}

export interface BrowserAgentWindow {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string, snapshot: BrowserAgentSnapshot): void };
}

interface PendingAction {
  tabId: string;
  action: BrowserAgentAction;
  approval: BrowserAgentApproval;
}

export class BrowserAgentEngine {
  private snapshot: BrowserAgentSnapshot = emptySnapshot();
  private pendingAction: PendingAction | null = null;

  constructor(
    private readonly window: BrowserAgentWindow,
    private readonly pages: BrowserAgentPageController,
    private readonly onCapturedContext?: (tabId: string, content: string) => void,
  ) {}

  getSnapshot(): BrowserAgentSnapshot {
    return {
      ...this.snapshot,
      allowedTabIds: [...this.snapshot.allowedTabIds],
      pendingApproval: this.snapshot.pendingApproval ? { ...this.snapshot.pendingApproval } : null,
      log: this.snapshot.log.map((entry) => ({ ...entry })),
    };
  }

  async execute(command: BrowserAgentCommand): Promise<BrowserAgentCommandResult> {
    try {
      switch (command.type) {
        case 'start': return this.start(command.taskId, command.tabIds);
        case 'pause': return this.pause('Paused by the user.');
        case 'takeOver': return this.pause('User took over the visible tab.');
        case 'resume': return this.resume();
        case 'stop': return this.stop();
        case 'act': return await this.act(command.tabId, command.action);
        case 'respondApproval': return await this.respondApproval(command.decision);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The browser action failed.';
      this.append('', 'Browser action', '', 'failed', message);
      this.snapshot.currentAction = null;
      this.emit();
      return { ok: false, message };
    }
  }

  complete(): void {
    if (!this.snapshot.taskId) return;
    this.pendingAction = null;
    this.snapshot = { ...this.snapshot, state: 'completed', allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null };
    this.emit();
  }

  private start(taskId: string, requestedTabIds: string[]): BrowserAgentCommandResult {
    if (!taskId.trim()) return { ok: false, message: 'Browser use requires the active task.' };
    if (this.snapshot.taskId && ['running', 'paused', 'needs-approval'].includes(this.snapshot.state)) {
      return { ok: false, message: 'Finish or stop the current browser-use session first.' };
    }
    const tabIds = [...new Set(requestedTabIds)].filter((tabId) => this.pages.hasTab(tabId));
    if (tabIds.length === 0) return { ok: false, message: 'Select at least one available Poppin tab.' };
    this.snapshot = { ...emptySnapshot(), state: 'running', taskId, allowedTabIds: tabIds };
    this.append('', 'Browser access started', tabIds.join(', '), 'completed', `${tabIds.length} approved tab(s)`);
    this.emit();
    return { ok: true };
  }

  private pause(detail: string): BrowserAgentCommandResult {
    if (this.snapshot.state !== 'running') return { ok: false, message: 'Browser use is not running.' };
    this.snapshot.state = 'paused';
    this.snapshot.currentAction = null;
    this.append(this.snapshot.activeTabId ?? '', 'Browser use paused', '', 'paused', detail);
    this.emit();
    return { ok: true };
  }

  private resume(): BrowserAgentCommandResult {
    if (this.snapshot.state !== 'paused' || this.pendingAction) return { ok: false, message: 'Browser use cannot resume yet.' };
    this.snapshot.state = 'running';
    this.append(this.snapshot.activeTabId ?? '', 'Browser use resumed', '', 'completed', 'Explicitly resumed by the user.');
    this.emit();
    return { ok: true };
  }

  private stop(): BrowserAgentCommandResult {
    if (!this.snapshot.taskId) return { ok: false, message: 'There is no browser-use session.' };
    this.pendingAction = null;
    this.snapshot = { ...this.snapshot, state: 'stopped', allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null };
    this.append('', 'Browser access stopped', '', 'completed', 'All task-scoped tab access was revoked.');
    this.emit();
    return { ok: true };
  }

  private async act(tabId: string, action: BrowserAgentAction): Promise<BrowserAgentCommandResult> {
    if (this.snapshot.state !== 'running') return { ok: false, message: 'Resume browser use before the next action.' };
    if (!this.snapshot.allowedTabIds.includes(tabId) || !this.pages.hasTab(tabId)) {
      this.append(tabId, label(action), target(action), 'rejected', 'The tab is not approved for this task.');
      this.emit();
      return { ok: false, message: 'That tab is not approved for this task.' };
    }
    if (action.type === 'type' && (CREDENTIAL_SELECTOR.test(action.selector) || CREDENTIAL_SELECTOR.test(action.text))) {
      this.append(tabId, label(action), action.selector, 'rejected', 'Credential fields and credential data are never accessible.');
      this.emit();
      return { ok: false, message: 'Poppin never types into or inspects credential fields.' };
    }
    if (action.type === 'navigate' && AUTH_URL.test(action.url)) {
      return this.requestApproval(tabId, action, action.url, 'Authentication must be completed by the user.');
    }
    const inspection = await this.pages.inspectAction(tabId, action);
    if (inspection.credential) {
      this.append(tabId, label(action), inspection.target, 'rejected', 'Credential fields are outside the browser-agent boundary.');
      this.emit();
      return { ok: false, message: 'Poppin never reads or operates credential fields.' };
    }
    if (inspection.consequential) return this.requestApproval(tabId, action, inspection.target, inspection.consequential);
    return await this.perform(tabId, action, inspection.target);
  }

  private requestApproval(tabId: string, action: BrowserAgentAction, inspectedTarget: string, consequence: string): BrowserAgentCommandResult {
    const approval = {
      actionId: randomUUID(), title: `${label(action)} requires approval`, target: inspectedTarget,
      scope: this.pages.describeTab?.(tabId) ?? `Approved tab ${tabId}`, consequence,
    };
    this.pendingAction = { tabId, action, approval };
    this.snapshot.state = 'needs-approval';
    this.snapshot.pendingApproval = approval;
    this.snapshot.currentAction = null;
    this.append(tabId, label(action), inspectedTarget, 'paused', consequence);
    this.emit();
    return { ok: false, message: 'Approval required.' };
  }

  private async respondApproval(decision: 'approve' | 'reject'): Promise<BrowserAgentCommandResult> {
    const pending = this.pendingAction;
    if (!pending || this.snapshot.state !== 'needs-approval') return { ok: false, message: 'There is no pending browser action.' };
    this.pendingAction = null;
    this.snapshot.pendingApproval = null;
    if (decision === 'reject') {
      this.snapshot.state = 'paused';
      this.append(pending.tabId, label(pending.action), pending.approval.target, 'rejected', 'Rejected by the user.');
      this.emit();
      return { ok: false, message: 'Browser action rejected by the user.' };
    }
    this.snapshot.state = 'running';
    return await this.perform(pending.tabId, pending.action, pending.approval.target);
  }

  private async perform(tabId: string, action: BrowserAgentAction, inspectedTarget: string): Promise<BrowserAgentCommandResult> {
    if (!this.pages.activateTabForAgent(tabId)) return { ok: false, message: 'The approved tab is no longer available.' };
    this.snapshot.activeTabId = tabId;
    this.snapshot.currentAction = label(action);
    this.append(tabId, label(action), inspectedTarget, 'started', 'Visible action started.');
    this.emit();
    const data = await this.pages.performAction(tabId, action);
    if (action.type === 'read' || action.type === 'captureTranscript') this.onCapturedContext?.(tabId, data);
    this.snapshot.currentAction = null;
    this.append(tabId, label(action), inspectedTarget, 'completed', summarize(data));
    this.emit();
    return { ok: true, data };
  }

  private append(tabId: string, action: string, targetValue: string, outcome: BrowserAgentLogEntry['outcome'], detail: string): void {
    this.snapshot.log = [...this.snapshot.log, { id: randomUUID(), at: new Date().toISOString(), tabId, action, target: targetValue, outcome, detail }].slice(-MAX_LOG_ENTRIES);
  }

  private emit(): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(BROWSER_AGENT_CHANNELS.snapshot, this.getSnapshot());
    }
  }
}

function emptySnapshot(): BrowserAgentSnapshot {
  return { state: 'idle', taskId: null, allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null, log: [] };
}

function label(action: BrowserAgentAction): string {
  if (action.type === 'captureTranscript') return 'Read visible transcript';
  return `${action.type[0]!.toUpperCase()}${action.type.slice(1)}`;
}

function target(action: BrowserAgentAction): string {
  if ('selector' in action) return action.selector;
  if ('url' in action) return action.url;
  if ('text' in action) return action.text;
  if ('deltaY' in action) return String(action.deltaY);
  if ('milliseconds' in action) return `${action.milliseconds}ms`;
  return 'visible page';
}

function summarize(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact || 'Completed.';
}
