import { Bot, Check, Download, MessageSquarePlus, Plus, Save, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { PageBlockSnapshot, PageDocumentSnapshot, PagesCommand } from '../../shared/pages';
import type { TaskCommand, TaskCommandResult, TaskSnapshot } from '../../shared/task';
import { TandemMarkdown } from './TandemMarkdown';

export function NativePageView({ pageId, revision, onCommand, taskSnapshot, onTaskCommand, onTaskStarted }: {
  pageId: string;
  revision: number;
  onCommand: (command: PagesCommand) => Promise<string | null>;
  taskSnapshot: TaskSnapshot;
  onTaskCommand: (command: TaskCommand) => Promise<TaskCommandResult>;
  onTaskStarted: () => void;
}) {
  const [document, setDocument] = useState<PageDocumentSnapshot | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState<{ block: PageBlockSnapshot; quote: string; start: number | null; end: number | null } | null>(null);
  const [instruction, setInstruction] = useState('');
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = async () => {
    const next = await window.poppinPages.getPage(pageId);
    setDocument(next);
    setDrafts(Object.fromEntries((next?.blocks ?? []).map((block) => [block.id, textOf(block)])));
  };

  useEffect(() => {
    let mounted = true;
    void window.poppinPages.getPage(pageId).then((next) => {
      if (!mounted) return;
      setDocument(next);
      setDrafts(Object.fromEntries((next?.blocks ?? []).map((block) => [block.id, textOf(block)])));
    });
    return () => { mounted = false; };
  }, [pageId, revision]);
  useEffect(() => () => { if (titleTimer.current) clearTimeout(titleTimer.current); }, []);

  if (!document) return <section className="native-stage-empty">Loading page…</section>;

  const saveBlock = async (block: PageBlockSnapshot) => {
    const text = drafts[block.id] ?? '';
    if (text === textOf(block)) return;
    const error = await onCommand({ type: 'updateBlock', blockId: block.id, expectedVersion: block.version, content: { text } });
    setMessage(error ?? 'Saved');
    if (!error) await reload();
  };

  const addComment = async () => {
    if (!selection || !instruction.trim()) return;
    const error = await onCommand({
      type: 'addComment', pageId, blockId: selection.block.id, selectionQuote: selection.quote,
      instruction, start: selection.start, end: selection.end,
    });
    setMessage(error ?? 'Instruction attached to the selected text.');
    if (!error) { setSelection(null); setInstruction(''); await reload(); }
  };

  const captureRenderedSelection = (block: PageBlockSnapshot, root: HTMLElement) => {
    const selected = window.getSelection();
    const quote = selected?.toString().trim() ?? '';
    if (!quote || !selected?.anchorNode || !selected.focusNode || !root.contains(selected.anchorNode) || !root.contains(selected.focusNode)) return;
    setSelection({ block, quote, start: null, end: null });
  };

  const askCodex = async (commentId: string) => {
    const model = taskSnapshot.connection.models.find((candidate) => candidate.isDefault) ?? taskSnapshot.connection.models[0];
    if (!model || taskSnapshot.connection.state !== 'ready') { setMessage(taskSnapshot.connection.message); return; }
    const selectedError = await onCommand({ type: 'setPageSelected', pageId, selected: true });
    if (selectedError) { setMessage(selectedError); return; }
    const prompt = `Resolve native Page comment ${commentId}. Follow its anchored instruction, then call page_comment_apply with only the precise replacement text. Do not rewrite the full page.`;
    const existingTask = taskSnapshot.task;
    if (existingTask && ['Running', 'Needs Approval'].includes(existingTask.state)) {
      setMessage('Finish or cancel the current Codex task before resolving this instruction.');
      return;
    }
    const result = await onTaskCommand(existingTask
      ? { type: 'continueTask', prompt }
      : { type: 'startTask', kind: 'work', model: model.id, reasoningEffort: model.defaultReasoningEffort, prompt });
    if (result.ok) onTaskStarted();
    setMessage(result.ok ? 'Codex is resolving this instruction in the Task pane.' : result.message ?? 'Codex could not start.');
  };

  const taskDocument = document.blocks.some((block) => block.type === 'task-result');

  return (
    <section className="native-page-view" aria-label={`Page ${document.page.title}`}>
      <header className="native-document-header">
        <input
          className="native-title-input"
          aria-label="Page title"
          defaultValue={document.page.title}
          onChange={(event) => {
            const title = event.target.value;
            if (titleTimer.current) clearTimeout(titleTimer.current);
            titleTimer.current = setTimeout(() => { void onCommand({ type: 'renamePage', pageId, title }); }, 450);
          }}
          onBlur={(event) => { if (titleTimer.current) clearTimeout(titleTimer.current); void onCommand({ type: 'renamePage', pageId, title: event.target.value }); }}
        />
        <div className="native-document-meta"><span>{taskDocument ? 'Tandem task document' : 'Local Page'}</span><span className="native-header-actions"><button type="button" onClick={() => { void window.poppinPages.exportPage(pageId, 'pdf').then((result) => setMessage(result.message ?? 'Exported PDF.')); }}><Download size={12} /> PDF</button><button type="button" onClick={() => { void window.poppinPages.exportPage(pageId, 'docx').then((result) => setMessage(result.message ?? 'Exported Word document.')); }}><Download size={12} /> Word</button>{message ? <em>{message}</em> : null}</span></div>
      </header>
      <div className="native-page-layout">
        <div className={`block-editor ${taskDocument ? 'task-document' : ''}`} aria-label="Page blocks">
          {document.blocks.length === 0 ? <p className="native-empty-copy">This page is empty. Add your first text block.</p> : null}
          {document.blocks.map((block) => block.type === 'task-prompt' ? (
            <section className="task-document-prompt" key={block.id}>
              <span>You asked</span>
              <p>{textOf(block)}</p>
              <time>{formatTaskTime(block)}</time>
            </section>
          ) : block.type === 'task-result' ? (
            <section className="task-document-result" key={block.id}>
              <div className="task-document-result-meta"><span>Work result</span><span>Rendered with Tandem</span></div>
              <div onMouseUp={(event) => captureRenderedSelection(block, event.currentTarget)}>
                <TandemMarkdown markdown={textOf(block)} title={document.page.title} />
              </div>
              <TaskSources block={block} />
            </section>
          ) : (
            <article className="native-block" key={block.id}>
              <textarea
                aria-label="Page text block"
                value={drafts[block.id] ?? ''}
                onChange={(event) => setDrafts((current) => ({ ...current, [block.id]: event.target.value }))}
                onBlur={() => { void saveBlock(block); }}
                onSelect={(event) => {
                  const target = event.currentTarget;
                  if (target.selectionStart === target.selectionEnd) return;
                  setSelection({ block, quote: target.value.slice(target.selectionStart, target.selectionEnd), start: target.selectionStart, end: target.selectionEnd });
                }}
              />
              <button type="button" className="block-save" aria-label="Save block" onClick={() => { void saveBlock(block); }}><Save size={13} /></button>
            </article>
          ))}
          <button type="button" className="native-add-button" onClick={() => { void onCommand({ type: 'addBlock', pageId, blockType: 'paragraph', content: { text: '' } }); }}><Plus size={15} /> Add text block</button>
        </div>
        <aside className="comments-panel" aria-label="Page instructions">
          <div className="comments-panel-heading"><MessageSquarePlus size={15} /><strong>Instructions</strong></div>
          {selection ? (
            <div className="selection-comment-composer">
              <blockquote>{selection.quote}</blockquote>
              <textarea aria-label="Instruction for selected text" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="How should this text change?" />
              <div><button type="button" className="primary-button" disabled={!instruction.trim()} onClick={() => { void addComment(); }}>Attach instruction</button><button type="button" onClick={() => setSelection(null)}><X size={13} /></button></div>
            </div>
          ) : <p className="context-note">Select text in a block to attach a precise instruction.</p>}
          <div className="comment-list">
            {document.comments.filter((comment) => comment.status === 'open').map((comment) => (
              <article className="page-comment" key={comment.id}>
                <blockquote>{comment.selection.quote}</blockquote>
                <p>{comment.instruction}</p>
                <textarea aria-label={`Replacement for ${comment.selection.quote}`} value={replacements[comment.id] ?? ''} onChange={(event) => setReplacements((current) => ({ ...current, [comment.id]: event.target.value }))} placeholder="Replacement text" />
                <div><button type="button" className="primary-button" onClick={() => { void askCodex(comment.id); }}><Bot size={13} /> Ask Codex</button><button type="button" disabled={replacements[comment.id] === undefined} onClick={() => { void onCommand({ type: 'applyComment', commentId: comment.id, replacement: replacements[comment.id] ?? '' }).then(async (error) => { setMessage(error ?? 'Instruction applied.'); if (!error) await reload(); }); }}><Check size={13} /> Apply myself</button><button type="button" onClick={() => { void onCommand({ type: 'resolveComment', commentId: comment.id }).then(() => reload()); }}>Resolve</button></div>
              </article>
            ))}
            {document.comments.every((comment) => comment.status !== 'open') ? <span className="section-empty">No open instructions.</span> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

function textOf(block: PageBlockSnapshot): string {
  if (typeof block.content === 'string') return block.content;
  if (block.content && typeof block.content === 'object' && !Array.isArray(block.content) && typeof block.content.text === 'string') return block.content.text;
  return '';
}

function formatTaskTime(block: PageBlockSnapshot): string {
  if (!block.content || typeof block.content !== 'object' || Array.isArray(block.content) || typeof block.content.createdAt !== 'string') return '';
  const date = new Date(block.content.createdAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function TaskSources({ block }: { block: PageBlockSnapshot }) {
  if (!block.content || typeof block.content !== 'object' || Array.isArray(block.content) || !Array.isArray(block.content.sources)) return null;
  const sources = block.content.sources.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return typeof value.title === 'string' && typeof value.url === 'string' ? [{ title: value.title, url: value.url }] : [];
  });
  if (sources.length === 0) return null;
  return <aside className="task-document-sources"><h3>Sources</h3><ol>{sources.map((source) => <li key={source.url}><a href={source.url} onClick={(event) => { event.preventDefault(); void window.poppinBrowser.command({ type: 'create', input: source.url }); }}>{source.title || source.url}</a></li>)}</ol></aside>;
}
