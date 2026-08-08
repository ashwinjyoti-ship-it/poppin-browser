import { randomUUID } from 'node:crypto';

import {
  BROWSER_AGENT_CHANNELS,
  type BrowserAgentAction,
  type BrowserAgentApproval,
  type BrowserAgentCommand,
  type BrowserAgentCommandResult,
  type BrowserAgentLogEntry,
  type BrowserAgentSnapshot,
  type BrowserBatchStep,
  type BrowserSemanticSnapshot,
  type BrowserTaskSpace,
} from '../../shared/browser-agent';
import { BrowserAgentStateStore } from './browser-agent-state-store';

const MAX_LOG_ENTRIES = 300;
const CREDENTIAL_SELECTOR = /password|passkey|credential|one[-_ ]?time|otp|verification[-_ ]?code/i;
const AUTH_URL = /\b(sign[-_ ]?in|log[-_ ]?in|authenticate|oauth|passkey|password)\b/i;

export interface BrowserAgentPageController {
  hasTab(tabId: string): boolean;
  describeTab?(tabId: string): string;
  createTaskSpaceTabs(taskSpaceId: string, sourceTabIds: string[]): string[];
  createTaskSpaceExplorationTab(taskSpaceId: string): string | null;
  prepareTabForAgent(tabId: string, taskSpaceId: string): boolean;
  watchTaskSpace(taskSpaceId: string, activeTabId: string | null): boolean;
  closeTaskSpaceTabs(taskSpaceId: string): void;
  createSemanticSnapshot(tabId: string, snapshotId: string, taskSpaceId: string): Promise<BrowserSemanticSnapshot>;
  isSemanticSnapshotCurrent(tabId: string, snapshotId: string): boolean;
  inspectAction(tabId: string, action: BrowserAgentAction): Promise<{ credential: boolean; consequential: string | null; takeover?: string | null; target: string }>;
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

interface PendingBatch {
  taskSpaceId: string;
  tabId: string;
  snapshotId: string;
  steps: BrowserBatchStep[];
  index: number;
  results: Array<{ step: number; ok: boolean; detail: string }>;
}

export class BrowserAgentEngine {
  private snapshot: BrowserAgentSnapshot = emptySnapshot();
  private pendingAction: PendingAction | null = null;
  private controlEpoch = 0;
  private saveWork: Promise<void> = Promise.resolve();
  private readonly latestSnapshotByTab = new Map<string, string>();
  private pendingBatch: PendingBatch | null = null;
  private batchRunning = false;

  constructor(
    private readonly window: BrowserAgentWindow,
    private readonly pages: BrowserAgentPageController,
    private readonly onCapturedContext?: (tabId: string, content: string) => void,
    private readonly stateStore?: BrowserAgentStateStore,
  ) {}

  async restore(): Promise<void> {
    const restored = await this.stateStore?.load();
    if (!restored) return;
    const tabIds = restored.tabIds.filter((tabId) => this.pages.hasTab(tabId));
    if (tabIds.length === 0) {
      await this.stateStore?.save(null);
      return;
    }
    const interrupted = restored.status === 'agent-controlling' || restored.status === 'waiting-for-approval';
    const taskSpace: BrowserTaskSpace = {
      ...restored,
      tabIds,
      contextTabIds: restored.contextTabIds.filter((tabId) => tabIds.includes(tabId)),
      explorationTabIds: restored.explorationTabIds.filter((tabId) => tabIds.includes(tabId)),
      activeTabId: restored.activeTabId && tabIds.includes(restored.activeTabId) ? restored.activeTabId : tabIds[0]!,
      owner: 'user',
      status: interrupted ? 'user-controlling' : restored.status,
      updatedAt: new Date().toISOString(),
    };
    this.snapshot = {
      ...emptySnapshot(),
      state: interrupted || restored.status === 'paused' || restored.status === 'user-controlling' ? 'paused' : restored.status === 'completed' ? 'completed' : 'stopped',
      taskId: taskSpace.taskId,
      taskSpace,
      allowedTabIds: tabIds,
      activeTabId: taskSpace.activeTabId,
    };
    this.append(taskSpace.activeTabId ?? '', 'Agent Tabs restored', taskSpace.name, 'paused', 'Restored without resuming automation. The user controls these tabs.');
    await this.persist();
    this.emit();
  }

  async flush(): Promise<void> {
    await this.saveWork;
  }

  getSnapshot(): BrowserAgentSnapshot {
    return {
      ...this.snapshot,
      taskSpace: this.snapshot.taskSpace ? {
        ...this.snapshot.taskSpace,
        tabIds: [...this.snapshot.taskSpace.tabIds],
        contextTabIds: [...this.snapshot.taskSpace.contextTabIds],
        explorationTabIds: [...this.snapshot.taskSpace.explorationTabIds],
      } : null,
      allowedTabIds: [...this.snapshot.allowedTabIds],
      pendingApproval: this.snapshot.pendingApproval ? { ...this.snapshot.pendingApproval } : null,
      log: this.snapshot.log.map((entry) => ({ ...entry })),
    };
  }

  async execute(command: BrowserAgentCommand): Promise<BrowserAgentCommandResult> {
    try {
      switch (command.type) {
        case 'start': return await this.start(command.taskId, command.name, command.mode, command.tabIds);
        case 'pause': return this.pause('Paused by the user.');
        case 'takeOver': return this.takeOver();
        case 'resume': return this.resume();
        case 'stop': return this.stop();
        case 'watch': return this.watch();
        case 'keepTabs': return this.keepTabs();
        case 'closeTaskTabs': return this.closeTaskTabs();
        case 'act': return await this.act(command.taskSpaceId, command.tabId, command.action);
        case 'batch': return await this.executeBatch(command.taskSpaceId, command.tabId, command.snapshotId, command.steps);
        case 'respondApproval': return await this.respondApproval(command.decision);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The browser action failed.';
      if (this.pendingBatch) {
        this.skipPendingBatch(`Skipped after an error: ${message}`);
        this.pendingBatch = null;
      }
      this.batchRunning = false;
      this.append('', 'Browser action', '', 'failed', message);
      this.snapshot.currentAction = null;
      this.emit();
      return { ok: false, message };
    }
  }

  complete(): void {
    if (!this.snapshot.taskId) return;
    this.controlEpoch += 1;
    this.pendingAction = null;
    this.pendingBatch = null;
    this.latestSnapshotByTab.clear();
    this.updateTaskSpace({ owner: 'user', status: 'completed' });
    this.snapshot = { ...this.snapshot, state: 'completed', currentAction: null, pendingApproval: null };
    this.append(this.snapshot.activeTabId ?? '', 'Agent Tabs completed', '', 'completed', 'Close task tabs is the default cleanup; Keep tabs preserves this collection.');
    void this.persist();
    this.emit();
  }

  private async start(taskId: string, name: string | undefined, mode: BrowserTaskSpace['mode'], requestedTabIds: string[]): Promise<BrowserAgentCommandResult> {
    if (!taskId.trim()) return { ok: false, message: 'Browser use requires the active task.' };
    if (this.snapshot.taskSpace) {
      if (this.snapshot.taskSpace.kept) return { ok: false, message: 'Close the kept Agent Tabs before starting another browser-use task.' };
      if (['running', 'paused', 'needs-approval'].includes(this.snapshot.state)) return { ok: false, message: 'Finish or stop the current Agent Tabs session first.' };
      this.pages.closeTaskSpaceTabs(this.snapshot.taskSpace.id);
    }
    const sourceTabIds = [...new Set(requestedTabIds)].filter((tabId) => this.pages.hasTab(tabId));
    const id = randomUUID();
    const contextTabIds = this.pages.createTaskSpaceTabs(id, sourceTabIds);
    const explorationTabId = this.pages.createTaskSpaceExplorationTab(id);
    if (!explorationTabId) {
      this.pages.closeTaskSpaceTabs(id);
      return { ok: false, message: 'Poppin could not create a fresh task-owned exploration tab.' };
    }
    const explorationTabIds = [explorationTabId];
    const tabIds = [...contextTabIds, ...explorationTabIds];
    const now = new Date().toISOString();
    const taskSpace: BrowserTaskSpace = {
      id, taskId, name: name?.trim().slice(0, 80) || 'Browser task', mode, owner: 'agent', status: 'agent-controlling',
      tabIds, contextTabIds, explorationTabIds, activeTabId: explorationTabId, createdAt: now, updatedAt: now, kept: false,
    };
    this.controlEpoch += 1;
    this.latestSnapshotByTab.clear();
    this.snapshot = { ...emptySnapshot(), state: 'running', taskId, taskSpace, allowedTabIds: tabIds, activeTabId: explorationTabId };
    this.append('', 'Agent Tabs started', tabIds.join(', '), 'completed', `${contextTabIds.length} context clone(s) and 1 fresh exploration tab created; source tabs were unchanged.`);
    await this.persist();
    this.emit();
    return { ok: true, data: JSON.stringify({ taskSpaceId: id, mode, contextTabIds, explorationTabIds }) };
  }

  private pause(detail: string): BrowserAgentCommandResult {
    if (this.snapshot.state !== 'running') return { ok: false, message: 'Browser use is not running.' };
    this.controlEpoch += 1;
    this.latestSnapshotByTab.clear();
    this.snapshot.state = 'paused';
    this.snapshot.currentAction = null;
    this.updateTaskSpace({ status: 'paused' });
    this.append(this.snapshot.activeTabId ?? '', 'Browser use paused', '', 'paused', detail);
    void this.persist();
    this.emit();
    return { ok: true };
  }

  private resume(): BrowserAgentCommandResult {
    if (this.snapshot.state !== 'paused' || this.pendingAction) return { ok: false, message: 'Browser use cannot resume yet.' };
    if (!this.snapshot.taskSpace) return { ok: false, message: 'There is no Agent Tabs session.' };
    this.controlEpoch += 1;
    this.snapshot.state = 'running';
    this.updateTaskSpace({ owner: 'agent', status: 'agent-controlling' });
    this.append(this.snapshot.activeTabId ?? '', 'Browser use resumed', '', 'completed', 'Explicitly resumed by the user.');
    void this.persist();
    this.emit();
    return { ok: true };
  }

  private stop(): BrowserAgentCommandResult {
    if (!this.snapshot.taskId) return { ok: false, message: 'There is no browser-use session.' };
    this.controlEpoch += 1;
    this.latestSnapshotByTab.clear();
    this.pendingAction = null;
    this.skipPendingBatch('Skipped because the task was stopped.');
    this.pendingBatch = null;
    this.updateTaskSpace({ owner: 'user', status: 'failed-stopped' });
    this.snapshot = { ...this.snapshot, state: 'stopped', currentAction: null, pendingApproval: null };
    this.append('', 'Browser access stopped', '', 'completed', 'Agent control was revoked. Task tabs await explicit cleanup.');
    void this.persist();
    this.emit();
    return { ok: true };
  }

  private takeOver(): BrowserAgentCommandResult {
    if (!this.snapshot.taskSpace || !['running', 'needs-approval'].includes(this.snapshot.state)) return { ok: false, message: 'The agent is not controlling Agent Tabs.' };
    this.controlEpoch += 1;
    this.latestSnapshotByTab.clear();
    this.pendingAction = null;
    this.skipPendingBatch('Skipped because the user took control.');
    this.pendingBatch = null;
    this.snapshot.state = 'paused';
    this.snapshot.pendingApproval = null;
    this.snapshot.currentAction = null;
    this.updateTaskSpace({ owner: 'user', status: 'user-controlling' });
    this.append(this.snapshot.activeTabId ?? '', 'User took over', '', 'paused', 'Agent actions are blocked until explicit Resume agent.');
    void this.persist();
    this.emit();
    return { ok: true };
  }

  private watch(): BrowserAgentCommandResult {
    const space = this.snapshot.taskSpace;
    if (!space || !this.pages.watchTaskSpace(space.id, space.activeTabId)) return { ok: false, message: 'Agent Tabs are no longer available.' };
    this.snapshot.watching = true;
    this.emit();
    return { ok: true };
  }

  private keepTabs(): BrowserAgentCommandResult {
    if (!this.snapshot.taskSpace || !['completed', 'stopped'].includes(this.snapshot.state)) return { ok: false, message: 'Tabs can be kept after the task stops.' };
    this.updateTaskSpace({ owner: 'user', kept: true });
    this.append('', 'Agent Tabs kept', this.snapshot.taskSpace.name, 'completed', 'The completed collection remains visible and inactive.');
    void this.persist();
    this.emit();
    return { ok: true };
  }

  private closeTaskTabs(): BrowserAgentCommandResult {
    const space = this.snapshot.taskSpace;
    if (!space) return { ok: false, message: 'There are no task tabs to close.' };
    this.controlEpoch += 1;
    this.latestSnapshotByTab.clear();
    this.pages.closeTaskSpaceTabs(space.id);
    this.pendingAction = null;
    this.snapshot = emptySnapshot();
    void this.persist();
    this.emit();
    return { ok: true };
  }

  private async act(taskSpaceId: string, tabId: string, action: BrowserAgentAction): Promise<BrowserAgentCommandResult> {
    if (this.snapshot.state !== 'running') return { ok: false, message: 'Resume browser use before the next action.' };
    if (!this.snapshot.taskSpace || this.snapshot.taskSpace.owner !== 'agent' || taskSpaceId !== this.snapshot.taskSpace.id) {
      return { ok: false, message: 'That action is outside the active task space.' };
    }
    const epoch = this.controlEpoch;
    if (!this.snapshot.allowedTabIds.includes(tabId) || !this.pages.hasTab(tabId) || !this.pages.prepareTabForAgent(tabId, taskSpaceId)) {
      this.append(tabId, label(action), target(action), 'rejected', 'The tab is not approved for this task.');
      this.emit();
      return { ok: false, message: 'That tab is not approved for this task.' };
    }
    if ((action.type === 'click' || action.type === 'type') && action.ref) {
      if (!action.snapshotId || this.latestSnapshotByTab.get(tabId) !== action.snapshotId) {
        this.append(tabId, label(action), action.ref, 'rejected', 'The semantic reference is stale. Read the page again.');
        this.emit();
        return { ok: false, message: 'That semantic reference is stale. Read the page again.' };
      }
    }
    if (action.type === 'type' && (CREDENTIAL_SELECTOR.test(action.selector ?? '') || CREDENTIAL_SELECTOR.test(action.text))) {
      this.append(tabId, label(action), action.selector ?? action.ref ?? 'editable field', 'rejected', 'Credential fields and credential data are never accessible.');
      this.emit();
      return { ok: false, message: 'Poppin never types into or inspects credential fields.' };
    }
    if (action.type === 'navigate' && AUTH_URL.test(action.url)) {
      return this.requestTakeover(tabId, action.url, 'Authentication must be completed by the user.');
    }
    const inspection = await this.pages.inspectAction(tabId, action);
    if (epoch !== this.controlEpoch || this.snapshot.state !== 'running' || this.snapshot.taskSpace?.owner !== 'agent') return { ok: false, message: 'Browser control changed before the action could run.' };
    if (inspection.credential) {
      return this.requestTakeover(tabId, inspection.target, 'Credential entry must be completed by the user. Poppin does not read or operate the field.');
    }
    if (inspection.takeover) return this.requestTakeover(tabId, inspection.target, inspection.takeover);
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
    this.updateTaskSpace({ status: 'waiting-for-approval' });
    this.snapshot.pendingApproval = approval;
    this.snapshot.currentAction = null;
    this.append(tabId, label(action), inspectedTarget, 'paused', consequence);
    void this.persist();
    this.emit();
    return { ok: false, message: 'Approval required.' };
  }

  private requestTakeover(tabId: string, inspectedTarget: string, detail: string): BrowserAgentCommandResult {
    this.controlEpoch += 1;
    this.latestSnapshotByTab.clear();
    this.pendingAction = null;
    this.snapshot.state = 'paused';
    this.snapshot.currentAction = null;
    this.snapshot.pendingApproval = null;
    this.updateTaskSpace({ owner: 'user', status: 'user-controlling', activeTabId: tabId });
    this.append(tabId, 'User takeover required', inspectedTarget, 'paused', detail);
    void this.persist();
    this.emit();
    return { ok: false, message: 'User takeover required.' };
  }

  private async respondApproval(decision: 'approve' | 'reject'): Promise<BrowserAgentCommandResult> {
    const pending = this.pendingAction;
    if (!pending || this.snapshot.state !== 'needs-approval') return { ok: false, message: 'There is no pending browser action.' };
    this.pendingAction = null;
    this.snapshot.pendingApproval = null;
    if (decision === 'reject') {
      this.latestSnapshotByTab.clear();
      this.snapshot.state = 'paused';
      this.updateTaskSpace({ status: 'paused' });
      this.append(pending.tabId, label(pending.action), pending.approval.target, 'rejected', 'Rejected by the user.');
      this.skipPendingBatch('Skipped because the critical step was rejected.');
      this.pendingBatch = null;
      void this.persist();
      this.emit();
      return { ok: false, message: 'Browser action rejected by the user.' };
    }
    this.snapshot.state = 'running';
    this.updateTaskSpace({ status: 'agent-controlling' });
    this.batchRunning = Boolean(this.pendingBatch);
    const result = await this.perform(pending.tabId, pending.action, pending.approval.target);
    this.batchRunning = false;
    if (!this.pendingBatch) return result;
    const batch = this.pendingBatch;
    batch.results.push({ step: batch.index, ok: result.ok, detail: result.data ?? result.message ?? 'Critical step completed.' });
    batch.index += 1;
    this.skipPendingBatch('Skipped after the one approved critical continuation. Start a fresh batch from a new read.');
    const data = JSON.stringify({ steps: batch.results, stoppedAfterApproval: true });
    this.pendingBatch = null;
    return { ok: result.ok, ...(result.ok ? { data } : { message: result.message }) };
  }

  private async executeBatch(taskSpaceId: string, tabId: string, snapshotId: string, steps: BrowserBatchStep[]): Promise<BrowserAgentCommandResult> {
    if (this.pendingBatch) return { ok: false, message: 'Resolve the current browser batch first.' };
    if (steps.length === 0 || steps.length > 20) return { ok: false, message: 'A browser batch requires 1–20 reviewed steps.' };
    const finalStep = steps.at(-1);
    if (finalStep?.action !== 'read' && finalStep?.action !== 'assert') return { ok: false, message: 'End each browser batch with read or assert verification.' };
    if (this.latestSnapshotByTab.get(tabId) !== snapshotId) return { ok: false, message: 'The batch snapshot is stale. Read the page again.' };
    this.pendingBatch = { taskSpaceId, tabId, snapshotId, steps: steps.map((step) => ({ ...step })), index: 0, results: [] };
    return await this.continueBatch();
  }

  private async continueBatch(): Promise<BrowserAgentCommandResult> {
    const batch = this.pendingBatch;
    if (!batch) return { ok: false, message: 'There is no browser batch.' };
    while (batch.index < batch.steps.length) {
      if (this.snapshot.state !== 'running' || this.snapshot.taskSpace?.owner !== 'agent') {
        this.skipPendingBatch('Skipped because browser control changed.');
        const data = JSON.stringify({ steps: batch.results, stopped: true });
        this.pendingBatch = null;
        return { ok: false, message: 'The browser batch was interrupted.', data };
      }
      const step = batch.steps[batch.index]!;
      let result: BrowserAgentCommandResult;
      this.batchRunning = true;
      if (step.action === 'click') {
        result = await this.act(batch.taskSpaceId, batch.tabId, { type: 'click', ref: step.ref, snapshotId: batch.snapshotId });
      } else if (step.action === 'fill') {
        result = await this.act(batch.taskSpaceId, batch.tabId, { type: 'type', ref: step.ref, snapshotId: batch.snapshotId, text: step.text });
      } else if (step.action === 'read') {
        result = await this.perform(batch.tabId, { type: 'read' }, 'visible page');
        if (result.ok && result.data) batch.snapshotId = (JSON.parse(result.data) as BrowserSemanticSnapshot).snapshotId;
      } else if (step.action === 'waitFor') {
        result = await this.performBatchWait(batch, step);
      } else {
        result = await this.performBatchAssert(batch, step);
      }
      this.batchRunning = false;
      if (!result.ok && this.getSnapshot().state === 'needs-approval') return result;
      batch.results.push({ step: batch.index, ok: result.ok, detail: result.data ?? result.message ?? 'Completed.' });
      batch.index += 1;
      if (result.ok && step.action === 'click') {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (!this.pages.isSemanticSnapshotCurrent(batch.tabId, batch.snapshotId)) {
          const semantic = await this.pages.createSemanticSnapshot(batch.tabId, randomUUID(), batch.taskSpaceId);
          batch.snapshotId = semantic.snapshotId;
          this.latestSnapshotByTab.set(batch.tabId, semantic.snapshotId);
          this.skipPendingBatch('Skipped because the click navigated or replaced the document. Continue from the new snapshot.');
          const data = JSON.stringify({ steps: batch.results, snapshot: semantic, stopped: true });
          this.pendingBatch = null;
          return { ok: false, message: 'The batch stopped after page navigation.', data };
        }
      }
      if (!result.ok) {
        this.skipPendingBatch('Skipped after a failed batch step.');
        const data = JSON.stringify({ steps: batch.results, stopped: true });
        this.pendingBatch = null;
        return { ok: false, message: result.message ?? 'A browser batch step failed.', data };
      }
    }
    const data = JSON.stringify({ steps: batch.results, snapshotId: batch.snapshotId, verified: true });
    this.pendingBatch = null;
    return { ok: true, data };
  }

  private async performBatchWait(batch: PendingBatch, step: Extract<BrowserBatchStep, { action: 'waitFor' }>): Promise<BrowserAgentCommandResult> {
    if (step.condition === 'milliseconds') {
      const milliseconds = Math.max(100, Math.min(5_000, Number(step.value) || 0));
      return await this.perform(batch.tabId, { type: 'wait', milliseconds }, `${milliseconds}ms`);
    }
    const timeoutMs = Math.max(250, Math.min(10_000, step.timeoutMs ?? 5_000));
    const deadline = Date.now() + timeoutMs;
    do {
      const semantic = await this.pages.createSemanticSnapshot(batch.tabId, randomUUID(), batch.taskSpaceId);
      batch.snapshotId = semantic.snapshotId;
      this.latestSnapshotByTab.set(batch.tabId, semantic.snapshotId);
      if (semanticText(semantic).includes(step.value.toLowerCase())) {
        this.append(batch.tabId, 'Wait for text', step.value, 'completed', 'The expected page text appeared.');
        this.emit();
        return { ok: true, data: `Found “${step.value}”` };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    this.append(batch.tabId, 'Wait for text', step.value, 'failed', 'Timed out waiting for expected page text.');
    this.emit();
    return { ok: false, message: `Timed out waiting for “${step.value}”.` };
  }

  private async performBatchAssert(batch: PendingBatch, step: Extract<BrowserBatchStep, { action: 'assert' }>): Promise<BrowserAgentCommandResult> {
    const semantic = await this.pages.createSemanticSnapshot(batch.tabId, randomUUID(), batch.taskSpaceId);
    batch.snapshotId = semantic.snapshotId;
    this.latestSnapshotByTab.set(batch.tabId, semantic.snapshotId);
    const matches = step.condition === 'urlIncludes'
      ? semantic.url.toLowerCase().includes(step.value.toLowerCase())
      : semanticText(semantic).includes(step.value.toLowerCase());
    this.append(batch.tabId, 'Assert page state', step.value, matches ? 'completed' : 'failed', matches ? 'Page-state assertion passed.' : 'Page-state assertion failed.');
    this.emit();
    return matches ? { ok: true, data: `Verified ${step.condition}: ${step.value}` } : { ok: false, message: `Page-state assertion failed: ${step.value}` };
  }

  private skipPendingBatch(detail: string): void {
    const batch = this.pendingBatch;
    if (!batch) return;
    for (let index = batch.index; index < batch.steps.length; index += 1) {
      const step = batch.steps[index]!;
      this.append(batch.tabId, `Batch ${step.action}`, batchTarget(step), 'rejected', detail);
      batch.results.push({ step: index, ok: false, detail });
    }
    batch.index = batch.steps.length;
    this.emit();
  }

  private async perform(tabId: string, action: BrowserAgentAction, inspectedTarget: string): Promise<BrowserAgentCommandResult> {
    const space = this.snapshot.taskSpace;
    if (!space || space.owner !== 'agent' || !this.pages.prepareTabForAgent(tabId, space.id)) return { ok: false, message: 'The task-owned tab is no longer available.' };
    const epoch = this.controlEpoch;
    this.snapshot.activeTabId = tabId;
    this.updateTaskSpace({ activeTabId: tabId });
    this.snapshot.currentAction = label(action);
    this.append(tabId, label(action), inspectedTarget, 'started', 'Visible action started.');
    this.emit();
    const data = action.type === 'read'
      ? JSON.stringify(await this.pages.createSemanticSnapshot(tabId, randomUUID(), space.id))
      : await this.pages.performAction(tabId, action);
    if (epoch !== this.controlEpoch || this.snapshot.taskSpace?.owner !== 'agent') return { ok: false, message: 'Browser control changed while the action was running.' };
    if (action.type === 'read') {
      const semantic = JSON.parse(data) as BrowserSemanticSnapshot;
      this.latestSnapshotByTab.set(tabId, semantic.snapshotId);
    }
    if (action.type === 'captureTranscript') this.onCapturedContext?.(tabId, data);
    if (!this.batchRunning && (action.type === 'navigate' || action.type === 'click' || action.type === 'type')) this.latestSnapshotByTab.delete(tabId);
    this.snapshot.currentAction = null;
    this.append(tabId, label(action), inspectedTarget, 'completed', summarize(data));
    this.emit();
    return { ok: true, data };
  }

  private updateTaskSpace(patch: Partial<BrowserTaskSpace>): void {
    if (!this.snapshot.taskSpace) return;
    this.snapshot.taskSpace = { ...this.snapshot.taskSpace, ...patch, updatedAt: new Date().toISOString() };
  }

  private persist(): Promise<void> {
    const value = this.snapshot.taskSpace ? { ...this.snapshot.taskSpace, tabIds: [...this.snapshot.taskSpace.tabIds] } : null;
    this.saveWork = this.saveWork.catch(() => undefined).then(() => this.stateStore?.save(value)).then(() => undefined).catch(() => undefined);
    return this.saveWork;
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
  return { state: 'idle', taskId: null, taskSpace: null, watching: false, allowedTabIds: [], activeTabId: null, currentAction: null, pendingApproval: null, log: [] };
}

function label(action: BrowserAgentAction): string {
  if (action.type === 'captureTranscript') return 'Read visible transcript';
  return `${action.type[0]!.toUpperCase()}${action.type.slice(1)}`;
}

function target(action: BrowserAgentAction): string {
  if ('ref' in action && action.ref) return action.ref;
  if ('selector' in action && action.selector) return action.selector;
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

function semanticText(snapshot: BrowserSemanticSnapshot): string {
  return `${snapshot.title}\n${snapshot.url}\n${snapshot.nodes.map((node) => `${node.role} ${node.name} ${node.states.join(' ')}`).join('\n')}`.toLowerCase();
}

function batchTarget(step: BrowserBatchStep): string {
  if ('ref' in step) return step.ref;
  if ('value' in step) return step.value;
  return 'visible page';
}
