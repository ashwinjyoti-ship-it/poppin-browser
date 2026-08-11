import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Send, Square } from 'lucide-react';

import type { AgentHarnessId } from '../../shared/agent';
import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import type { WorkspaceSnapshot } from '../../shared/workspace';
import { inferTaskRequirements, type TaskRequirements } from '../../shared/task-requirements';
import { Brand } from './Brand';

interface CommandBarProps {
  snapshot: TaskSnapshot;
  workspace: WorkspaceSnapshot;
  collapsed: boolean;
  onCollapseChange: (collapsed: boolean) => void;
  onCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onOverlayHeightChange?: (height: number) => void;
}

const PREFLIGHT_MIN_HEIGHT = 160;

export function CommandBar({ snapshot, workspace, collapsed, onCollapseChange, onCommand, onOverlayHeightChange }: CommandBarProps) {
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('');
  const [effort, setEffort] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [preflight, setPreflight] = useState<TaskRequirements | null>(null);
  const [browserQuestion, setBrowserQuestion] = useState<{ text: string; kind: 'work' | 'code' } | null>(null);
  const preflightRef = useRef<HTMLElement>(null);
  const canContinue = Boolean(snapshot.task && !snapshot.task.pendingApproval && ['Needs Approval', 'Completed', 'Failed', 'Cancelled'].includes(snapshot.task.state));
  const defaultModel = snapshot.connection.models.find((candidate) => candidate.isDefault) ?? snapshot.connection.models[0] ?? null;
  const requestedModelId = canContinue ? snapshot.task?.model ?? '' : modelId;
  const model = snapshot.connection.models.find((candidate) => candidate.id === requestedModelId) ?? defaultModel;
  const selectedModelId = model?.id ?? '';
  const requestedEffort = canContinue ? snapshot.task?.reasoningEffort ?? '' : effort;
  const selectedEffort = model?.reasoningEfforts.includes(requestedEffort) ? requestedEffort : model?.defaultReasoningEffort ?? '';
  const isBlocking = snapshot.task?.state === 'Running' || Boolean(snapshot.task?.pendingApproval);
  const agents = snapshot.connection.availableAgents ?? (snapshot.connection.agent ? [snapshot.connection.agent] : []);
  const selectedAgentId = snapshot.connection.agent?.id ?? agents[0]?.id ?? '';
  const controls = snapshot.connection.controls ?? { model: true, reasoning: true };
  const canSend = canContinue
    ? Boolean(prompt.trim() && !sending && !isBlocking && snapshot.connection.state === 'ready')
    : Boolean(
      prompt.trim()
      && selectedModelId
      && (!controls.reasoning || selectedEffort)
      && !sending
      && !isBlocking
      && snapshot.connection.state === 'ready',
    );

  useLayoutEffect(() => {
    if (!preflight && !browserQuestion) {
      onOverlayHeightChange?.(0);
      return;
    }
    const updateHeight = () => {
      const measuredHeight = Math.ceil(preflightRef.current?.getBoundingClientRect().height ?? 0);
      onOverlayHeightChange?.(Math.max(PREFLIGHT_MIN_HEIGHT, measuredHeight));
    };
    updateHeight();
    if (!preflightRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(preflightRef.current);
    return () => observer.disconnect();
  }, [browserQuestion, onOverlayHeightChange, preflight]);

  if (collapsed) {
    return (
      <button type="button" className={`command-bar-collapsed ${snapshot.task?.state === 'Running' ? 'command-activity-running' : ''}`} onClick={() => onCollapseChange(false)} aria-label="Open Codex command bar">
        <Brand compact />
        <ChevronUp size={13} />
      </button>
    );
  }

  const start = async (kind: 'work' | 'code', useBrowser?: boolean) => {
    setSending(true);
    setError('');
    const result = await onCommand({
      type: 'startTask', prompt, model: selectedModelId, reasoningEffort: selectedEffort, kind,
      ...(useBrowser === undefined ? {} : { useBrowser }),
    });
    setSending(false);
    if (result.ok) {
      setPrompt('');
      setPreflight(null);
      setBrowserQuestion(null);
      return;
    }
    // Poppin could not tell whether this needs live web access, so it asks
    // instead of guessing. The user never has to say "use browser".
    if (result.question?.kind === 'browser') {
      setBrowserQuestion({ text: result.question.text, kind });
      return;
    }
    setError(result.message ?? 'Poppin could not start that task.');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || isBlocking) return;
    if (canContinue) {
      setSending(true);
      setError('');
      const result = await onCommand({ type: 'continueTask', prompt });
      setSending(false);
      if (result.ok) setPrompt('');
      else setError(result.message ?? 'Codex could not continue that conversation.');
      return;
    }
    const requirements = inferTaskRequirements(prompt, Boolean(workspace.project), {
      selectedContextCount: selectedContextCount(workspace),
    });
    const needsPreflight = requirements.kind === 'code';
    if (needsPreflight && !preflight) {
      setPreflight(requirements);
      return;
    }
    await start(preflight?.kind ?? requirements.kind);
  };

  return (
    <form className="command-bar" onSubmit={(event) => { void submit(event); }} aria-label="Send a task to Codex">
      <div className={`command-activity ${snapshot.task?.state === 'Running' ? 'command-activity-running' : ''}`} aria-hidden="true">
        <Brand compact />
      </div>
      <label className="command-select">
        <span>Agent</span>
        <select
          value={selectedAgentId}
          onChange={(event) => {
            setModelId('');
            setEffort('');
            void onCommand({ type: 'selectAgent', agentId: event.target.value as AgentHarnessId }).then((result) => {
              if (!result.ok) setError(result.message ?? 'Poppin could not switch agent.');
            });
          }}
          disabled={isBlocking || agents.length < 2}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id} title={agent.summary}>
              {agent.availability === 'preview' ? `${agent.name} · preview` : agent.name}
            </option>
          ))}
        </select>
      </label>
      {/* Model and reasoning selectors only appear when the selected harness
          actually exposes them. ACP agents commonly do not. */}
      {controls.model ? (
        <label className="command-select command-model">
          <span>Model</span>
          <select value={selectedModelId} onChange={(event) => {
            const next = snapshot.connection.models.find((candidate) => candidate.id === event.target.value);
            setModelId(event.target.value);
            setEffort(next?.defaultReasoningEffort ?? '');
          }} disabled={snapshot.connection.state !== 'ready' || isBlocking || canContinue || snapshot.connection.models.length === 0}>
            {snapshot.connection.models.length === 0 ? <option value="">Unavailable</option> : null}
            {snapshot.connection.models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
      ) : null}
      {controls.reasoning ? (
        <label className="command-select command-reasoning">
          <span>Reasoning</span>
          <select value={selectedEffort} onChange={(event) => setEffort(event.target.value)} disabled={!model || isBlocking || canContinue}>
            {(model?.reasoningEfforts ?? []).map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
          </select>
        </label>
      ) : null}
      <label className="command-prompt">
        <span className="sr-only">Prompt</span>
        <input
          value={prompt}
          onChange={(event) => { setPrompt(event.target.value); setError(''); setPreflight(null); setBrowserQuestion(null); }}
          placeholder={snapshot.connection.state === 'ready' ? (canContinue ? 'Ask a follow-up in the same Codex conversation…' : 'Ask Poppin to summarize, research, draft, or change code…') : snapshot.connection.message}
          disabled={snapshot.connection.state !== 'ready' || isBlocking}
        />
        {error ? <span className="command-error">{error}</span> : null}
        {canContinue ? (
          <button
            type="button"
            className="command-new-task"
            onClick={() => {
              void onCommand({ type: 'finishTask' }).then((result) => {
                if (!result.ok) setError(result.message ?? 'Poppin could not start a new task.');
                else {
                  setModelId('');
                  setEffort('');
                  setError('');
                }
              });
            }}
          >
            New task
          </button>
        ) : null}
      </label>
      {snapshot.task?.state === 'Running' ? (
        <button className="command-stop" type="button" onClick={() => { void onCommand({ type: 'cancelTask' }); }} aria-label="Cancel Codex task"><Square size={15} /></button>
      ) : (
        <button className="command-send" type="submit" disabled={!canSend} aria-label={canContinue ? 'Send follow-up to Codex' : 'Send to Codex'}><Send size={17} /></button>
      )}
      <button className="command-collapse" type="button" onClick={() => onCollapseChange(true)} aria-label="Collapse Codex command bar"><ChevronDown size={15} /></button>
      {browserQuestion ? (
        <section ref={preflightRef} className="task-preflight" aria-label="Browser use question" role="group">
          <div><strong>Live web access?</strong><span>{browserQuestion.text}</span></div>
          <div className="preflight-actions">
            <button type="button" className="secondary-button" onClick={() => setBrowserQuestion(null)}>Adjust</button>
            <button type="button" className="secondary-button" onClick={() => { void start(browserQuestion.kind, false); }}>Use selected context only</button>
            <button type="button" className="primary-button" onClick={() => { void start(browserQuestion.kind, true); }}>Use Browser</button>
          </div>
        </section>
      ) : null}
      {preflight && !browserQuestion ? (
        <section ref={preflightRef} className="task-preflight" aria-label="Task preflight">
          <div><strong>{preflight.kind === 'code' ? 'Code task' : 'Work task'}</strong><span>{selectedContextCount(workspace)} selected context item(s)</span></div>
          <ul>
            <li>{preflight.browserUse ? 'Uses task-owned Agent Tabs visibly. Only critical actions pause for approval.' : 'Uses only the frozen selected context.'}</li>
            {preflight.plan.capabilities.length ? <li>Capabilities: {preflight.plan.capabilities.join(', ')}.</li> : null}
            <li>{preflight.modifiesProject ? `May modify ${workspace.project?.repositoryPath ?? 'the connected project'}.` : 'Will not modify the connected project.'}</li>
            {preflight.consequentialActions.map((action) => <li key={action}>{action} will pause for separate approval.</li>)}
          </ul>
          <div className="preflight-actions">
            <button type="button" className="secondary-button" onClick={() => setPreflight(null)}>Adjust</button>
            {preflight.kind === 'code' && !workspace.project ? <button type="button" className="secondary-button" onClick={() => { void start('work'); }}>Run as Work</button> : null}
            <button type="button" className="primary-button" disabled={preflight.kind === 'code' && !workspace.project} onClick={() => { void start(preflight.kind); }}>Start {preflight.kind === 'code' ? 'Code' : 'Work'}</button>
          </div>
        </section>
      ) : null}
    </form>
  );
}

function selectedContextCount(workspace: WorkspaceSnapshot): number {
  return workspace.tabContexts.length + workspace.documents.filter((item) => item.selected).length;
}

function titleCase(value: string): string {
  return value ? `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` : value;
}
