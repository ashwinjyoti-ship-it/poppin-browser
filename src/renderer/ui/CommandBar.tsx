import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Send, Square } from 'lucide-react';

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
  const preflightRef = useRef<HTMLElement>(null);
  const defaultModel = snapshot.connection.models.find((candidate) => candidate.isDefault) ?? snapshot.connection.models[0] ?? null;
  const model = snapshot.connection.models.find((candidate) => candidate.id === modelId) ?? defaultModel;
  const selectedModelId = model?.id ?? '';
  const selectedEffort = model?.reasoningEfforts.includes(effort) ? effort : model?.defaultReasoningEffort ?? '';
  const isActive = snapshot.task?.state === 'Running' || snapshot.task?.state === 'Needs Approval';

  useLayoutEffect(() => {
    if (!preflight) {
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
  }, [onOverlayHeightChange, preflight]);

  if (collapsed) {
    return (
      <button type="button" className={`command-bar-collapsed ${snapshot.task?.state === 'Running' ? 'command-activity-running' : ''}`} onClick={() => onCollapseChange(false)} aria-label="Open Codex command bar">
        <Brand compact />
        <ChevronUp size={13} />
      </button>
    );
  }

  const start = async (kind: 'work' | 'code') => {
    setSending(true);
    setError('');
    const result = await onCommand({ type: 'startTask', prompt, model: selectedModelId, reasoningEffort: selectedEffort, kind });
    setSending(false);
    if (result.ok) {
      setPrompt('');
      setPreflight(null);
    } else {
      setError(result.message ?? 'Codex could not start that task.');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || isActive) return;
    const requirements = inferTaskRequirements(prompt, Boolean(workspace.project));
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
        <span>Provider</span>
        <select value="codex" disabled><option value="codex">Codex</option></select>
      </label>
      <label className="command-select command-model">
        <span>Model</span>
        <select value={selectedModelId} onChange={(event) => {
          const next = snapshot.connection.models.find((candidate) => candidate.id === event.target.value);
          setModelId(event.target.value);
          setEffort(next?.defaultReasoningEffort ?? '');
        }} disabled={snapshot.connection.state !== 'ready' || isActive}>
          {snapshot.connection.models.length === 0 ? <option value="">Unavailable</option> : null}
          {snapshot.connection.models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      <label className="command-select">
        <span>Reasoning</span>
        <select value={selectedEffort} onChange={(event) => setEffort(event.target.value)} disabled={!model || isActive}>
          {(model?.reasoningEfforts ?? []).map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
        </select>
      </label>
      <label className="command-prompt">
        <span className="sr-only">Prompt</span>
        <input
          value={prompt}
          onChange={(event) => { setPrompt(event.target.value); setError(''); setPreflight(null); }}
          placeholder={snapshot.connection.state === 'ready' ? 'Ask Poppin to summarize, research, draft, or change code…' : snapshot.connection.message}
          disabled={snapshot.connection.state !== 'ready' || isActive}
        />
        {error ? <span className="command-error">{error}</span> : null}
      </label>
      {snapshot.task?.state === 'Running' ? (
        <button className="command-stop" type="button" onClick={() => { void onCommand({ type: 'cancelTask' }); }} aria-label="Cancel Codex task"><Square size={15} /></button>
      ) : (
        <button className="command-send" type="submit" disabled={!prompt.trim() || !selectedModelId || !selectedEffort || sending || isActive} aria-label="Send to Codex"><Send size={17} /></button>
      )}
      <button className="command-collapse" type="button" onClick={() => onCollapseChange(true)} aria-label="Collapse Codex command bar"><ChevronDown size={15} /></button>
      {preflight ? (
        <section ref={preflightRef} className="task-preflight" aria-label="Task preflight">
          <div><strong>{preflight.kind === 'code' ? 'Code task' : 'Work task'}</strong><span>{selectedContextCount(workspace)} selected context item(s)</span></div>
          <ul>
            <li>{preflight.browserUse ? 'Uses the selected tabs visibly. Only critical actions pause for approval.' : 'Uses only the frozen selected context.'}</li>
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
