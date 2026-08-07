import { type FormEvent, useState } from 'react';
import { ChevronDown, ChevronUp, Send, Square } from 'lucide-react';

import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import { Brand } from './Brand';

interface CommandBarProps {
  snapshot: TaskSnapshot;
  collapsed: boolean;
  onCollapseChange: (collapsed: boolean) => void;
  onCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
}

export function CommandBar({ snapshot, collapsed, onCollapseChange, onCommand }: CommandBarProps) {
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('');
  const [effort, setEffort] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const defaultModel = snapshot.connection.models.find((candidate) => candidate.isDefault) ?? snapshot.connection.models[0] ?? null;
  const model = snapshot.connection.models.find((candidate) => candidate.id === modelId) ?? defaultModel;
  const selectedModelId = model?.id ?? '';
  const selectedEffort = model?.reasoningEfforts.includes(effort) ? effort : model?.defaultReasoningEffort ?? '';
  const isActive = snapshot.task?.state === 'Running' || snapshot.task?.state === 'Needs Approval';

  if (collapsed) {
    return (
      <button type="button" className={`command-bar-collapsed ${snapshot.task?.state === 'Running' ? 'command-activity-running' : ''}`} onClick={() => onCollapseChange(false)} aria-label="Open Codex command bar">
        <Brand compact />
        <ChevronUp size={13} />
      </button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || isActive) return;
    setSending(true);
    setError('');
    const result = await onCommand({ type: 'startTask', prompt, model: selectedModelId, reasoningEffort: selectedEffort });
    setSending(false);
    if (result.ok) setPrompt('');
    else setError(result.message ?? 'Codex could not start that task.');
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
          onChange={(event) => { setPrompt(event.target.value); setError(''); }}
          placeholder={snapshot.connection.state === 'ready' ? 'Describe the change you want Codex to make…' : snapshot.connection.message}
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
    </form>
  );
}

function titleCase(value: string): string {
  return value ? `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` : value;
}
