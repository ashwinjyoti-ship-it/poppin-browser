import { useEffect, useRef, useState } from 'react';
import { BookOpenText, Check, Copy, Download, ExternalLink, FileSignature, FolderOpen, GitCompare, Plus, RotateCcw, Save, Sparkles, X } from 'lucide-react';

import type { TaskCommand, TaskCommandResult, TaskGeneratedFileSnapshot, TaskSnapshot, TaskTurnSnapshot } from '../../shared/task';
import type { WorkspaceCommand, WorkspaceCommandResult, WorkspaceSnapshot } from '../../shared/workspace';
import type { BrowserAgentCommand, BrowserAgentCommandResult, BrowserAgentSnapshot } from '../../shared/browser-agent';
import { extractProvenanceClaims } from '../../shared/provenance';
import { isOpenableGeneratedFile, matchGeneratedFile } from '../../shared/task-output';
import { formatDownloadBytes } from '../../shared/downloads';
import { parseCompareMatrix } from '../../shared/compare-board';
import { buildDeliveryStory } from '../../shared/delivery-story';
import { recipeStartUrl, sanitizeRecipeSteps } from '../../shared/recipes';
import { TandemMarkdown } from './TandemMarkdown';
import { CompareBoard } from './CompareBoard';
import { DeliveryStoryStrip } from './DeliveryStoryStrip';
import { AutomationFilmstrip } from './AutomationFilmstrip';

interface TaskTabViewProps {
  taskSnapshot: TaskSnapshot;
  workspace: WorkspaceSnapshot;
  browserAgentSnapshot?: BrowserAgentSnapshot;
  onTaskCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onBrowserAgentCommand?: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult>;
  onWorkspaceCommand?: (command: WorkspaceCommand) => Promise<WorkspaceCommandResult>;
}

/**
 * The agent's dedicated tab: one surface for a task's whole lifecycle. While a
 * turn is running it shows live progress and Agent Tabs status; once it's done
 * it shows the reply (Work) or the diff and delivery flow (Code). Replaces the
 * old right-pane Task/Result views and the native-Pages "Tandem page" render —
 * that name belongs to the real, connected Tandem product now.
 */
export function TaskTabView({ taskSnapshot, workspace, browserAgentSnapshot, onTaskCommand, onBrowserAgentCommand, onWorkspaceCommand }: TaskTabViewProps) {
  const task = taskSnapshot.task;
  const overlayRef = useRef<HTMLDivElement>(null);
  const hasApproval = Boolean(task?.pendingApproval || (browserAgentSnapshot?.pendingApproval && onBrowserAgentCommand));
  useEffect(() => {
    if (hasApproval) overlayRef.current?.focus();
  }, [hasApproval, browserAgentSnapshot?.pendingApproval, task?.pendingApproval]);

  if (!task) {
    return (
      <div className="task-tab-content">
        <div className="context-empty">No task yet. Ask the agent something from the command bar.</div>
      </div>
    );
  }

  const isLive = task.state === 'Running' || Boolean(task.pendingApproval);

  return (
    <div className="task-tab-shell">
      {hasApproval ? (
        <div ref={overlayRef} className="approval-overlay" tabIndex={-1}>
          <ApprovalCards task={task} browserAgent={browserAgentSnapshot} onTaskCommand={onTaskCommand} onBrowserAgentCommand={onBrowserAgentCommand} />
        </div>
      ) : null}
      <div className="task-tab-content">
        <div className="task-tab-heading">
          <div><span className="eyebrow">{task.kind === 'code' ? 'Code task' : 'Work task thread'}</span><h2>{taskHeadline(task.turns?.[0]?.prompt ?? task.prompt)}</h2></div>
          <div className="task-tab-actions">
            <span className={`task-state task-state-${slug(task.state)}`}>{task.state}</span>
            {['Completed', 'Failed', 'Cancelled'].includes(task.state) ? (
              <button type="button" className="secondary-button task-new-button" onClick={() => { void onTaskCommand({ type: 'finishTask' }); }}><Plus size={13} /> New task</button>
            ) : null}
          </div>
        </div>
        {taskSnapshot.connection.state !== 'ready' ? (
          <p className="task-account">
            {taskSnapshot.connection.message}
            <button type="button" className="secondary-button" onClick={() => { void onTaskCommand({ type: 'refreshConnection' }); }}>Reconnect</button>
          </p>
        ) : null}
        {browserAgentSnapshot?.taskSpace && onBrowserAgentCommand ? (
          <div className="task-agent-controls">
            <BrowserUseView snapshot={browserAgentSnapshot} onCommand={onBrowserAgentCommand} />
          </div>
        ) : null}
        {task.kind === 'work' ? (
          <WorkThread
            task={task}
            browserAgent={browserAgentSnapshot}
            onCommand={onTaskCommand}
            onWorkspaceCommand={onWorkspaceCommand}
          />
        ) : null}
        {isLive
          ? <LiveView task={task} browserAgent={browserAgentSnapshot} onBrowserAgentCommand={undefined} onTaskCommand={onTaskCommand} />
          : task.kind === 'code'
            ? <CodeReview task={task} workspace={workspace} onCommand={onTaskCommand} />
            : null}
        {task.error ? <p className="task-error">{task.error}</p> : null}
      </div>
    </div>
  );
}

function ApprovalCards({ task, browserAgent, onTaskCommand, onBrowserAgentCommand }: {
  task: NonNullable<TaskSnapshot['task']>;
  browserAgent?: BrowserAgentSnapshot;
  onTaskCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onBrowserAgentCommand?: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult>;
}) {
  const [questionAnswer, setQuestionAnswer] = useState('');
  return (
    <>
      {task.pendingApproval ? (
        <section className="approval-card approval-card-prominent" role="dialog" aria-modal="true" aria-label="Agent approval required">
          <span className="eyebrow">Approval required</span>
          <h3>{task.pendingApproval.title}</h3>
          {task.pendingApproval.reason ? <p>{task.pendingApproval.reason}</p> : null}
          <pre>{task.pendingApproval.detail}</pre>
          {task.pendingApproval.kind === 'question' ? (
            <div className="question-response">
              <textarea value={questionAnswer} onChange={(event) => setQuestionAnswer(event.target.value)} aria-label="Answer blocking question" placeholder="Type the missing detail…" />
              <button type="button" className="primary-button" disabled={!questionAnswer.trim()} onClick={() => { void onTaskCommand({ type: 'respondQuestion', answer: questionAnswer }).then((result) => { if (result.ok) setQuestionAnswer(''); }); }}>Continue task</button>
            </div>
          ) : (
            <div className="approval-actions">
              <button type="button" className="primary-button" onClick={() => { void onTaskCommand({ type: 'respondApproval', decision: 'accept' }); }}><Check size={14} /> {task.pendingApproval.kind === 'git' || task.pendingApproval.kind === 'github' ? 'Approve' : 'Allow once'}</button>
              <button type="button" className="secondary-button" onClick={() => { void onTaskCommand({ type: 'respondApproval', decision: 'decline' }); }}><X size={14} /> Decline</button>
            </div>
          )}
        </section>
      ) : null}
      {browserAgent?.pendingApproval && onBrowserAgentCommand ? (
        <section className="approval-card approval-card-prominent" role="dialog" aria-modal="true" aria-label="Browser action approval required">
          <span className="eyebrow">Browser approval required</span>
          <h3>{browserAgent.pendingApproval.title}</h3>
          <p><strong>Target:</strong> {browserAgent.pendingApproval.target}</p>
          <p><strong>Scope:</strong> {browserAgent.pendingApproval.scope}</p>
          <p><strong>Consequence:</strong> {browserAgent.pendingApproval.consequence}</p>
          <div className="approval-actions">
            <button type="button" className="primary-button" onClick={() => { void onBrowserAgentCommand({ type: 'respondApproval', decision: 'approve' }); }}><Check size={14} /> Approve</button>
            <button type="button" className="secondary-button" onClick={() => { void onBrowserAgentCommand({ type: 'respondApproval', decision: 'reject' }); }}><X size={14} /> Reject</button>
          </div>
        </section>
      ) : null}
    </>
  );
}

function LiveView({ task, browserAgent, onBrowserAgentCommand, onTaskCommand }: {
  task: NonNullable<TaskSnapshot['task']>;
  browserAgent?: BrowserAgentSnapshot;
  onBrowserAgentCommand?: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult>;
  onTaskCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
}) {
  const visibleProgress = task.kind === 'work' && task.state === 'Completed'
    ? task.progress.filter((item) => item.kind !== 'message')
    : task.progress;
  return (
    <>
      {onBrowserAgentCommand ? <BrowserUseView snapshot={browserAgent} onCommand={onBrowserAgentCommand} /> : null}
      <div className="task-progress-list">
        {visibleProgress.map((item) => (
          <article key={item.id} className="task-progress-item"><i className={`progress-state progress-${item.status}`} /><div><strong>{item.title}</strong>{item.detail ? <pre>{item.detail}</pre> : null}</div></article>
        ))}
      </div>
      {task.state === 'Running' || task.pendingApproval ? <button type="button" className="task-cancel" onClick={() => { void onTaskCommand({ type: 'cancelTask' }); }}>Cancel task</button> : null}
    </>
  );
}

function BrowserUseView({ snapshot, onCommand }: { snapshot?: BrowserAgentSnapshot; onCommand: (command: BrowserAgentCommand) => Promise<BrowserAgentCommandResult> }) {
  const canControl = snapshot?.state === 'running' || snapshot?.state === 'needs-approval';
  const canCleanUp = snapshot?.state === 'completed' || snapshot?.state === 'stopped';
  const taskSpace = snapshot?.taskSpace;
  const ownership = taskSpace?.owner === 'user' ? 'user' : 'agent';
  const ownershipLabel = ownership === 'agent' ? 'Agent owns these tabs' : 'You own these tabs';
  return (
    <section className="browser-use-card" aria-label="Controlled browser use">
      <div className="browser-use-heading">
        <div>
          <span className="eyebrow">Agent Tabs</span>
          <h3>{snapshot?.currentAction ?? snapshot?.taskSpace?.name ?? titleCase(snapshot?.state ?? 'idle')}</h3>
        </div>
        <div className="browser-use-heading-badges">
          {taskSpace ? (
            <span className={`ownership-pill ownership-pill-${ownership}`} aria-label={ownershipLabel}>{ownershipLabel}</span>
          ) : null}
          <span className={`task-state browser-state-${snapshot?.state ?? 'idle'}`} aria-hidden="true">{snapshot?.taskSpace?.status ?? snapshot?.state ?? 'idle'}</span>
        </div>
      </div>
      {!taskSpace ? <p className="context-note">This task is using frozen context only. Eligible browser-use tasks create Agent Tabs automatically.</p> : null}
      {taskSpace ? <p className="context-note">{taskSpace.contextTabIds.length} context · {taskSpace.explorationTabIds.length} exploration · {snapshot?.watching ? 'Live browser view' : 'Working in background'}</p> : null}
      {taskSpace ? (
        <div className="browser-controls" role="group" aria-label="Agent Tab controls">
          <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'watch' }); }}>{snapshot?.watching ? 'Watching live' : 'Return to live view'}</button>
          {canControl ? <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'pause' }); }}>Pause</button> : null}
          {canControl ? <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'takeOver' }); }}>Take over</button> : null}
          {snapshot?.state === 'paused' ? <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'resume' }); }}>Resume agent</button> : null}
          {!canCleanUp ? <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'setKeepTabs', keep: !taskSpace.kept }); }}>{taskSpace.kept ? 'Close tabs after task' : 'Keep tabs after task'}</button> : null}
          {!canCleanUp ? <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'stop' }); }}>Stop</button> : null}
        </div>
      ) : null}
      {canCleanUp ? <div className="browser-controls browser-cleanup-controls"><button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'closeTaskTabs' }); }}>Close task tabs</button>{taskSpace && !taskSpace.kept ? <button type="button" onClick={() => { void onCommand({ type: 'keepTabs' }); }}>Keep tabs</button> : null}</div> : null}
      {snapshot?.log.length ? <AutomationFilmstrip log={snapshot.log} /> : null}
    </section>
  );
}

function WorkThread({ task, browserAgent, onCommand, onWorkspaceCommand }: {
  task: NonNullable<TaskSnapshot['task']>;
  browserAgent?: BrowserAgentSnapshot;
  onCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onWorkspaceCommand?: (command: WorkspaceCommand) => Promise<WorkspaceCommandResult>;
}) {
  const [revision, setRevision] = useState('');
  const [message, setMessage] = useState('');
  const canReview = task.state === 'Needs Approval' && !task.pendingApproval;
  const turns: TaskTurnSnapshot[] = task.turns?.length ? task.turns : [{
    id: task.turnId || 'current-turn', prompt: task.prompt, result: task.result,
    status: task.state === 'Completed' ? 'completed' as const : task.state === 'Failed' ? 'failed' as const : task.state === 'Cancelled' ? 'cancelled' as const : 'running' as const,
    sources: task.browserRun.sources, createdAt: task.createdAt, completedAt: task.state === 'Running' ? null : task.updatedAt,
  }];
  const hasResult = turns.some((turn) => turn.result.trim());
  const lastCompletedTurn = [...turns].reverse().find((turn) => turn.status === 'completed' && turn.result.trim()) ?? null;
  const canReplyAction = Boolean(lastCompletedTurn) && !task.pendingApproval && ['Completed', 'Needs Approval', 'Failed', 'Cancelled'].includes(task.state);
  const threadText = turns.map((turn, index) => `Turn ${index + 1}\nYou\n${turn.prompt}\n\nAgent\n${turn.result}`).join('\n\n---\n\n');
  const runTaskCommand = (command: TaskCommand, defaultMessage: string) => {
    void onCommand(command).then((result) => setMessage(result.message ?? defaultMessage));
  };
  return (
    <div className="reply-view task-thread" aria-label="Task conversation">
      {hasResult ? (
        <div className="reply-toolbar">
          {canReplyAction ? (
            <button
              type="button"
              className="primary-button"
              title="Create a new Tandem page with this result and open it in Tandem World."
              onClick={() => runTaskCommand({ type: 'addResultToTandem', mode: 'new' }, 'Added to Tandem.')}
            >
              <BookOpenText size={13} /> Add to Tandem
            </button>
          ) : <span aria-hidden="true" />}
          <div className="reply-toolbar-actions">
            <button type="button" className="secondary-button" onClick={() => { void navigator.clipboard.writeText(threadText).then(() => setMessage('Copied thread.')); }}><Copy size={13} /> Copy thread</button>
            <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'exportResult', format: 'markdown' }).then((result) => setMessage(result.message ?? 'Saved.')); }}>Save</button>
            <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'exportResult', format: 'text' }).then((result) => setMessage(result.message ?? 'Exported.')); }}>Export</button>
          </div>
        </div>
      ) : null}
      {turns.map((turn, index) => (
        <article className={`task-turn task-turn-${turn.status}`} key={turn.id}>
          <header className="task-turn-request"><span>You · Turn {index + 1}</span><p>{turn.prompt}</p></header>
          {turn.result ? (
            <TandemMarkdown
              markdown={turn.result}
              title={taskHeadline(turn.prompt)}
              className="reply-body task-turn-reply"
              onFileLink={(href) => {
                const file = matchGeneratedFile(href, task.generatedFiles ?? []);
                if (!file) {
                  setMessage('Poppin could not find that file. Use Save as… on the generated files listed below.');
                  return;
                }
                void onCommand({ type: 'saveGeneratedFile', relativePath: file.relativePath }).then((result) => {
                  setMessage(result.message ?? (result.ok ? 'Saved.' : 'Could not save that file.'));
                });
              }}
            />
          ) : null}
          {turn.result ? <TurnCompareBoard markdown={turn.result} /> : null}
          {turn.result ? <ClaimsList turn={turn} /> : null}
          {(task.generatedFiles?.length ?? 0) > 0 && index === turns.length - 1 ? (
            <GeneratedFilesList
              files={task.generatedFiles ?? []}
              onCommand={onCommand}
              onMessage={setMessage}
            />
          ) : null}
          {turn.sources.length ? (
            <section className="reply-sources">
              <h3>Sources</h3>
              <ul>{turn.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>
            </section>
          ) : null}
          {turn.status === 'running' ? <div className="task-turn-thinking" role="status"><span className="agent-dock-dot" aria-hidden="true" /> Agent thinking…</div> : null}
        </article>
      ))}
      {canReplyAction && lastCompletedTurn ? (
        <NextActionChips
          task={task}
          browserAgent={browserAgent}
          onCommand={onCommand}
          onWorkspaceCommand={onWorkspaceCommand}
          onMessage={setMessage}
        />
      ) : null}
      {canReview ? (
        <div className="review-actions">
          <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'approveResult' }).then((result) => setMessage(result.message ?? 'Approved.')); }}><Check size={14} /> Approve</button>
          <label><span>Or revise</span><textarea value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="Tell the agent what should change…" /></label>
          <button type="button" className="secondary-button" disabled={!revision.trim()} onClick={() => { void onCommand({ type: 'reviseTask', prompt: revision }).then((result) => { setMessage(result.message ?? 'Revision started.'); if (result.ok) setRevision(''); }); }}><RotateCcw size={14} /> Send revision</button>
        </div>
      ) : null}
      {message ? <p className="review-message">{message}</p> : null}
    </div>
  );
}

function TurnCompareBoard({ markdown }: { markdown: string }) {
  const matrix = parseCompareMatrix(markdown);
  if (!matrix) return null;
  return <CompareBoard matrix={matrix} title="Options compared" />;
}

function GeneratedFilesList({
  files,
  onCommand,
  onMessage,
}: {
  files: TaskGeneratedFileSnapshot[];
  onCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onMessage: (value: string) => void;
}) {
  const run = (command: TaskCommand, fallback: string) => {
    void onCommand(command).then((result) => onMessage(result.message ?? fallback));
  };
  return (
    <section className="reply-generated-files" aria-label="Generated files">
      <h3>Generated files</h3>
      <p className="context-note">Save as… lets you choose the name and folder. Poppin never overwrites a file without that dialog.</p>
      <ul>
        {files.map((file) => (
          <li key={file.relativePath}>
            <div>
              <strong>{file.name}</strong>
              <small>{formatDownloadBytes(file.sizeBytes)}</small>
            </div>
            <div className="reply-generated-file-actions">
              <button type="button" className="primary-button" onClick={() => run({ type: 'saveGeneratedFile', relativePath: file.relativePath }, 'Saved.')}>
                <Download size={13} /> Save as…
              </button>
              <button type="button" className="secondary-button" onClick={() => run({ type: 'revealGeneratedFile', relativePath: file.relativePath }, 'Shown in Finder.')}>
                <FolderOpen size={13} /> Show in Finder
              </button>
              {isOpenableGeneratedFile(file.name) ? (
                <button type="button" className="secondary-button" onClick={() => run({ type: 'openGeneratedFile', relativePath: file.relativePath }, 'Opened.')}>
                  Open
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClaimsList({ turn }: { turn: TaskTurnSnapshot }) {
  const claims = extractProvenanceClaims(turn.result, turn.sources);
  if (claims.length === 0) return null;
  return (
    <section className="reply-claims" aria-label="Claims and sources">
      <h3>Claims · Sources</h3>
      <ol>
        {claims.map((claim) => (
          <li key={claim.url}>
            <a href={claim.url} target="_blank" rel="noreferrer">{claim.claim}</a>
            {claim.sourceTitle && claim.sourceTitle !== claim.claim ? <small> — {claim.sourceTitle}</small> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function NextActionChips({ task, browserAgent, onCommand, onWorkspaceCommand, onMessage }: {
  task: NonNullable<TaskSnapshot['task']>;
  browserAgent?: BrowserAgentSnapshot;
  onCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onWorkspaceCommand?: (command: WorkspaceCommand) => Promise<WorkspaceCommandResult>;
  onMessage: (value: string) => void;
}) {
  const run = (command: TaskCommand, defaultMessage: string) => {
    void onCommand(command).then((result) => onMessage(result.message ?? defaultMessage));
  };
  return (
    <div className="reply-next-actions" aria-label="Next actions">
      <button
        type="button"
        className="chip-button"
        title="Ask the agent to keep researching the open questions in the last result."
        onClick={() => run({
          type: 'continueTask',
          prompt: 'Continue researching based on the open questions in the last result. Use Agent Tabs and cite each new claim with a markdown link to the source URL.',
        }, 'Continuing research.')}
      >
        <Sparkles size={12} /> Continue research
      </button>
      <button
        type="button"
        className="chip-button"
        title="Ask the agent to compare the leading options from the last result."
        onClick={() => run({
          type: 'continueTask',
          prompt: 'Compare the leading options from the last result side by side on price, features, caveats, and sources. Prefer a comparison table and cite every fact with a markdown link.',
        }, 'Preparing comparison.')}
      >
        <GitCompare size={12} /> Compare
      </button>
      <button
        type="button"
        className="chip-button"
        title="Ask the agent to draft a concise recommendation from the last result."
        onClick={() => run({
          type: 'continueTask',
          prompt: 'Draft a concise recommendation from the last result. Keep it under 200 words, address the user directly, and cite each claim with a markdown link to the source URL.',
        }, 'Drafting recommendation.')}
      >
        <FileSignature size={12} /> Draft
      </button>
      <button
        type="button"
        className="chip-button"
        title="Append this result to Poppin's protected Memory page."
        onClick={() => run({ type: 'saveResultToMemory' }, 'Saved to Memory.')}
      >
        <Save size={12} /> Save to Memory
      </button>
      {onWorkspaceCommand && browserAgent?.log.length ? (
        <button
          type="button"
          className="chip-button"
          title="Save this verified browser run as a reusable local recipe. Credentials are never stored."
          onClick={() => {
            const steps = sanitizeRecipeSteps(browserAgent.log);
            if (!steps) {
              onMessage('Need at least two safe completed steps to save a recipe.');
              return;
            }
            const name = window.prompt('Name this recipe', taskHeadline(task.prompt).slice(0, 60));
            if (!name?.trim()) return;
            void onWorkspaceCommand({
              type: 'saveRecipe',
              name: name.trim(),
              steps,
              startUrl: recipeStartUrl(steps),
            }).then((result) => onMessage(result.message ?? (result.ok ? 'Recipe saved.' : 'Could not save recipe.')));
          }}
        >
          <Save size={12} /> Save recipe
        </button>
      ) : null}
      {task.state === 'Completed' || task.state === 'Needs Approval' ? (
        <span className="chip-hint"><ExternalLink size={11} /> Sources open in new tabs.</span>
      ) : null}
    </div>
  );
}

function CodeReview({ task, workspace, onCommand }: { task: NonNullable<TaskSnapshot['task']>; workspace: WorkspaceSnapshot; onCommand: (command: TaskCommand) => Promise<TaskCommandResult> }) {
  const [revision, setRevision] = useState('');
  const [message, setMessage] = useState('');
  const [branch, setBranch] = useState(workspace.project?.branch ?? 'codex/poppin-task');
  const [commitMessage, setCommitMessage] = useState('feat: complete Poppin task');
  const [base, setBase] = useState('main');
  const [prTitle, setPrTitle] = useState(task.prompt.slice(0, 120));
  const [prBody, setPrBody] = useState('Completed and verified with Poppin Browser.');
  const [mergeStrategy, setMergeStrategy] = useState<'merge' | 'squash' | 'rebase'>('squash');
  const canReview = task.state === 'Needs Approval' && !task.pendingApproval;
  const pullRequest = task.delivery?.pullRequest ?? null;
  const pullRequestMerged = Boolean(pullRequest && /^merged$/i.test(pullRequest.state));
  return (
    <div className="review-view">
      <button type="button" className="secondary-button preview-button" onClick={() => { void onCommand({ type: 'openPreview' }).then((result) => setMessage(result.message ?? 'Preview opened in the centre browser.')); }}>Open localhost preview</button>
      <section className="result-section"><h3>Codex summary</h3><pre>{task.result || (task.state === 'Running' ? 'Codex is working…' : 'No summary was returned.')}</pre></section>
      {task.result && (task.state === 'Completed' || task.state === 'Needs Approval') ? (
        <div className="reply-next-actions" aria-label="Result actions">
          <button
            type="button"
            className="chip-button"
            title="Append this Code summary to Poppin's protected Memory page."
            onClick={() => { void onCommand({ type: 'saveResultToMemory' }).then((result) => setMessage(result.message ?? 'Saved to Memory.')); }}
          >
            <Save size={12} /> Save to Memory
          </button>
          <button
            type="button"
            className="chip-button"
            title="Create a new Tandem page with this Code summary."
            onClick={() => { void onCommand({ type: 'addResultToTandem', mode: 'new' }).then((result) => setMessage(result.message ?? 'Added to Tandem.')); }}
          >
            <BookOpenText size={12} /> Add to Tandem
          </button>
        </div>
      ) : null}
      <section className="result-section diff-section"><h3>Git diff</h3><pre>{task.diff || 'No project diff yet.'}</pre></section>
      {canReview ? (
        <div className="review-actions">
          <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'approveResult' }).then((result) => setMessage(result.message ?? 'Approved. The changes remain in your working tree.')); }}><Check size={14} /> Approve</button>
          <label><span>Or revise</span><textarea value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="Tell Codex what should change…" /></label>
          <button type="button" className="secondary-button" disabled={!revision.trim()} onClick={() => { void onCommand({ type: 'reviseTask', prompt: revision }).then((result) => { setMessage(result.message ?? 'Revision started.'); if (result.ok) setRevision(''); }); }}><RotateCcw size={14} /> Send revision</button>
        </div>
      ) : null}
      {message ? <p className="review-message">{message}</p> : null}
      {task.state === 'Completed' ? (
        <section className="delivery-card">
          <h3>GitHub delivery</h3>
          <DeliveryStoryStrip stages={buildDeliveryStory(task.delivery)} />
          {!task.delivery?.commit ? (
            <div className="delivery-form">
              <label>Branch<input value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
              <label>Commit message<input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} /></label>
              <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'prepareCommit', branch, message: commitMessage }).then((result) => setMessage(result.message ?? 'Commit prepared.')); }}>Prepare commit</button>
            </div>
          ) : null}
          {task.delivery?.commit ? (
            <div className="delivery-status">
              <p><strong>{task.delivery.branch}</strong> · {task.delivery.commit.slice(0, 7)}</p>
              <p>{task.delivery.message}</p>
              {!task.delivery.pushed ? <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'requestPush' }).then((result) => setMessage(result.message ?? 'Review the push approval.')); }}>Review push</button> : null}
            </div>
          ) : null}
          {task.delivery?.pushed && !pullRequest ? (
            <div className="delivery-form">
              <label>Base branch<input value={base} onChange={(event) => setBase(event.target.value)} /></label>
              <label>PR title<input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} /></label>
              <label>PR summary<textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} /></label>
              <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'requestPullRequest', base, title: prTitle, body: prBody }).then((result) => setMessage(result.message ?? 'Review the pull-request approval.')); }}>Create Pull Request</button>
            </div>
          ) : null}
          {pullRequest ? (
            <div className="delivery-status">
              <p><strong>PR #{pullRequest.number}</strong> · {pullRequest.state}</p>
              <p>{pullRequest.base} ← {pullRequest.head}</p>
              <p>{pullRequest.checks} · {pullRequest.review}</p>
              <div className="delivery-actions">
                <button type="button" className="secondary-button" onClick={() => { void onCommand({ type: 'refreshPullRequest' }).then((result) => setMessage(result.message ?? 'Pull request updated.')); }}>Refresh status</button>
                {!pullRequestMerged ? (
                  <>
                    <select aria-label="Merge strategy" value={mergeStrategy} onChange={(event) => setMergeStrategy(event.target.value as typeof mergeStrategy)}>
                      <option value="merge">Merge</option>
                      <option value="squash">Squash</option>
                      <option value="rebase">Rebase</option>
                    </select>
                    <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'requestMerge', strategy: mergeStrategy }).then((result) => setMessage(result.message ?? 'Review the separate merge approval.')); }}>Review Merge</button>
                  </>
                ) : null}
                {pullRequestMerged && !task.delivery?.localUpdated ? (
                  <button type="button" className="primary-button" onClick={() => { void onCommand({ type: 'requestUpdateLocal' }).then((result) => setMessage(result.message ?? 'Review the local update approval.')); }}>Update local folder</button>
                ) : null}
                {task.delivery?.localUpdated ? <p>Local {pullRequest.base} is up to date.</p> : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function taskHeadline(prompt: string): string {
  const oneLine = prompt.replace(/\s+/gu, ' ').trim();
  return oneLine.length > 90 ? `${oneLine.slice(0, 87).trimEnd()}…` : oneLine;
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-');
}
