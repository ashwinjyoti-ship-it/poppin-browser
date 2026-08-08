import { Brain, ChevronDown, ChevronRight, Database, FilePlus2, FileText, Plus } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import type { PageKind, PageSnapshot, PagesCommand, PagesSnapshot } from '../../shared/pages';

export function PagesSection({ snapshot, onCommand }: {
  snapshot: PagesSnapshot;
  onCommand: (command: PagesCommand) => Promise<string | null>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const roots = useMemo(() => snapshot.pages.filter((page) => !page.parentId), [snapshot.pages]);
  const children = useMemo(() => {
    const map = new Map<string, PageSnapshot[]>();
    for (const page of snapshot.pages) {
      if (!page.parentId) continue;
      map.set(page.parentId, [...(map.get(page.parentId) ?? []), page]);
    }
    return map;
  }, [snapshot.pages]);

  const create = async (kind: PageKind, parentId: string | null = null) => {
    await onCommand({ type: 'createPage', title: kind === 'page' ? 'Untitled page' : 'Untitled database', kind, parentId });
    if (parentId) setExpanded((current) => new Set(current).add(parentId));
  };

  const renderNode = (page: PageSnapshot, depth = 0): ReactNode => {
    const descendants = children.get(page.id) ?? [];
    const isExpanded = expanded.has(page.id);
    const selected = snapshot.selectedPageIds.includes(page.id);
    return (
      <div key={page.id} className="page-tree-node">
        <div className="page-tree-row" style={{ paddingLeft: `${depth * 14}px` }}>
          <button
            type="button"
            className="page-tree-disclosure"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${page.title}`}
            disabled={descendants.length === 0}
            onClick={() => setExpanded((current) => {
              const next = new Set(current);
              if (next.has(page.id)) next.delete(page.id); else next.add(page.id);
              return next;
            })}
          >{descendants.length ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span />}</button>
          <label className="page-context-check" title="Include in Codex context">
            <input type="checkbox" checked={selected} onChange={(event) => { void onCommand({ type: 'setPageSelected', pageId: page.id, selected: event.target.checked }); }} />
          </label>
          <button type="button" className="page-tree-open" onClick={() => { void onCommand({ type: 'openPage', pageId: page.id }); }}>
            {page.kind === 'database' ? <Database size={14} /> : <FileText size={14} />}
            <span>{page.title}</span>
          </button>
          <button type="button" className="page-tree-add-child" aria-label={`Add child to ${page.title}`} onClick={() => { void create('page', page.id); }}><Plus size={12} /></button>
        </div>
        {isExpanded ? descendants.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <section className="workspace-section pages-section">
      <div className="section-heading">
        <span>Pages</span>
        <span className="pages-actions">
          <button type="button" onClick={() => { void create('page'); }}><FilePlus2 size={13} /> Page</button>
          <button type="button" onClick={() => { void create('database'); }}><Database size={13} /> Database</button>
          <button type="button" onClick={() => { void onCommand({ type: 'openMemory' }); }}><Brain size={13} /> Memory</button>
        </span>
      </div>
      <div className="page-tree">
        {roots.length === 0 ? <span className="section-empty">Create a page or database to begin.</span> : roots.map((page) => renderNode(page))}
      </div>
    </section>
  );
}
