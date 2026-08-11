import { BookOpenText, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleSlash2, Database, FileDiff, FileText, Globe2, MessageSquareText, Pencil, Plus, TriangleAlert, X } from 'lucide-react';
import { type DragEvent, useMemo, useRef, useState } from 'react';

import type { BrowserFailure, BrowserTabGroup } from '../../shared/browser';
import type { BrowserTaskSpace } from '../../shared/browser-agent';
import type { TaskTabStatus } from './task-surface';

interface TabStripProps {
  tabs: TabStripTabSnapshot[];
  groups: BrowserTabGroup[];
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  onReorder: (tabId: string, beforeTabId: string | null) => void;
  onShowTabMenu: (tabId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onShowGroupMenu: (groupId: string) => void;
  agentTaskSpace?: BrowserTaskSpace | null;
  watchingAgentTabs?: boolean;
  onWatchAgentTabs?: () => void;
  /** Tandem World is always reachable as a pinned launcher, not a right-pane button. */
  tandemReady?: boolean;
  tandemMessage?: string;
  onOpenTandemWorld?: () => void;
  /** Vertical left rail is the shell default; horizontal remains for tests. */
  orientation?: 'horizontal' | 'vertical';
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
  /** Tab ids currently included in the Ask context package. */
  contextTabIds?: ReadonlySet<string>;
  onToggleTabContext?: (tabId: string, selected: boolean) => void;
}

export interface TabStripTabSnapshot {
  id: string;
  title: string;
  url?: string;
  kind?: 'browser' | 'page' | 'database' | 'task' | 'tandem';
  /** Picks the task tab's icon: a reply bubble for Work, a diff mark for Code. */
  taskKind?: 'work' | 'code';
  /** Persistent task state shown without consuming page viewport height. */
  taskStatus?: TaskTabStatus;
  faviconUrls?: string[];
  pinned?: boolean;
  groupId?: string | null;
  taskSpaceId?: string | null;
  isLoading?: boolean;
  failure?: BrowserFailure | null;
}

export function TabStrip({
  tabs,
  groups,
  activeTabId,
  onActivate,
  onClose,
  onCreate,
  onReorder,
  onShowTabMenu,
  onToggleGroup,
  onRenameGroup,
  onShowGroupMenu,
  agentTaskSpace,
  watchingAgentTabs,
  onWatchAgentTabs,
  tandemReady,
  tandemMessage,
  onOpenTandemWorld,
  orientation = 'horizontal',
  collapsed = false,
  onCollapseChange,
  contextTabIds,
  onToggleTabContext,
}: TabStripProps) {
  const vertical = orientation === 'vertical';
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const tabCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) if (tab.groupId) counts.set(tab.groupId, (counts.get(tab.groupId) ?? 0) + 1);
    return counts;
  }, [tabs]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const cancelRenameRef = useRef(false);
  const renderedGroups = new Set<string>();
  // The task's Agent Tabs (context/exploration browsing tabs while watching)
  // and its reply/review tab are a distinct, agent-owned zone: they dock to
  // the right of ordinary tabs instead of interleaving with them.
  const ordinaryTabs = tabs.filter((tab) => !tab.taskSpaceId && tab.kind !== 'task');
  const agentOwnedTabs = tabs.filter((tab) => tab.taskSpaceId || tab.kind === 'task');
  const showAgentCluster = Boolean(agentTaskSpace) || agentOwnedTabs.length > 0;
  const hasTandemWorldTab = ordinaryTabs.some((tab) => tab.kind === 'tandem');

  if (vertical && collapsed) {
    return (
      <aside className="side-rail side-rail-left tab-rail-collapsed" aria-label="Tabs collapsed">
        <button type="button" className="pane-toggle" onClick={() => onCollapseChange?.(false)} aria-label="Open tabs">
          <ChevronRight size={17} />
        </button>
      </aside>
    );
  }
  const startRename = (group: BrowserTabGroup) => {
    cancelRenameRef.current = false;
    setEditingGroupId(group.id);
    setGroupName(group.name);
  };

  const finishRename = () => {
    if (!cancelRenameRef.current && editingGroupId && groupName.trim()) onRenameGroup(editingGroupId, groupName);
    cancelRenameRef.current = false;
    setEditingGroupId(null);
    setGroupName('');
  };

  const cancelRename = () => {
    cancelRenameRef.current = true;
    setEditingGroupId(null);
    setGroupName('');
  };

  const renderTab = (tab: TabStripTabSnapshot, group?: BrowserTabGroup) => {
    const hideTab = Boolean(group?.collapsed);
    if (hideTab) return null;
    const isActive = tab.id === activeTabId;
    const isAgentOwned = Boolean(tab.taskSpaceId || tab.kind === 'task');
    const groupClasses = group ? ` tab-grouped tab-grouped-${group.color}` : '';
    const taskStatus = tab.kind === 'task' && tab.taskStatus ? taskStatusLabel(tab.taskStatus) : null;
    const tabTitle = tab.title || 'Untitled';
    const accessibleName = taskStatus
      ? `${tabTitle}, ${taskStatus}`
      : tab.pinned ? `${tabTitle}, pinned` : group ? `${tabTitle}, ${group.name} group` : undefined;
    const canMarkContext = Boolean(
      onToggleTabContext
      && (!tab.kind || tab.kind === 'browser')
      && !isAgentOwned
      && tab.url
      && (tab.url.startsWith('http://') || tab.url.startsWith('https://')),
    );
    const contextSelected = Boolean(contextTabIds?.has(tab.id));
    return (
      <div
        className={`tab ${isActive ? 'tab-active' : ''} ${tab.pinned ? 'tab-pinned' : ''}${isAgentOwned ? ' tab-agent' : ''}${contextSelected ? ' tab-in-context' : ''}${groupClasses}`}
        key={tab.id}
        role="tab"
        aria-label={accessibleName}
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        title={taskStatus ? `${tabTitle} — ${taskStatus}` : tabTitle}
        draggable={!isAgentOwned}
        onDragStart={(event) => { if (!isAgentOwned) event.dataTransfer.setData('application/x-poppin-tab', tab.id); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropTab(event, tab.id, onReorder)}
        onClick={() => onActivate(tab.id)}
        onContextMenu={(event) => { event.preventDefault(); if (!tab.kind || tab.kind === 'browser') onShowTabMenu(tab.id); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate(tab.id);
          }
        }}
      >
        {canMarkContext ? (
          <label className="tab-context-mark" title={contextSelected ? 'Remove from Ask context' : 'Add to Ask context'} onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={contextSelected}
              aria-label={contextSelected ? `Remove ${tabTitle} from context` : `Add ${tabTitle} to context`}
              onChange={(event) => onToggleTabContext?.(tab.id, event.target.checked)}
            />
          </label>
        ) : null}
        <span className="tab-icon" aria-hidden="true">
          <TabFavicon key={`${tab.failure ? 'failed' : 'ready'}:${tab.faviconUrls?.join('|') ?? tab.kind}:${tab.taskStatus ?? ''}`} tab={tab} />
        </span>
        {tab.pinned && !vertical ? null : <span className="tab-title">{tab.title || 'Untitled'}</span>}
        {tab.isLoading ? <span className="tab-loading" aria-label="Loading" /> : null}
        {tab.kind !== 'task' && tab.kind !== 'tandem' && (tab.pinned || tab.taskSpaceId) ? null : (
          <button
            className="tab-close"
            type="button"
            aria-label={`Close ${tab.title || 'tab'}`}
            onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onClose(tab.id);
              }
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  };

  const ordinaryStrip = (
    <div
      className={vertical ? 'tab-strip tab-strip-vertical' : 'tab-strip'}
      role="tablist"
      aria-label="Browser tabs"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => dropTab(event, null, onReorder)}
    >
      {onOpenTandemWorld && !hasTandemWorldTab ? (
        <button
          type="button"
          className="tab tab-tandem-world"
          aria-label="Open Tandem World"
          title={tandemReady ? 'Tandem World' : tandemMessage ?? 'Connect Tandem to use Tandem World'}
          disabled={!tandemReady}
          onClick={onOpenTandemWorld}
        >
          <span className="tab-icon" aria-hidden="true"><BookOpenText size={15} /></span>
          <span className="tab-title">Tandem</span>
        </button>
      ) : null}
      {ordinaryTabs.flatMap((tab) => {
        const group = tab.groupId ? groupsById.get(tab.groupId) : undefined;
        const showGroup = Boolean(group && !renderedGroups.has(group.id));
        if (group) renderedGroups.add(group.id);
        return [
          showGroup && group ? (
            <TabGroupChip
              key={`group-${group.id}`}
              group={group}
              count={tabCountByGroup.get(group.id) ?? 0}
              editing={editingGroupId === group.id}
              draftName={groupName}
              onDraftNameChange={setGroupName}
              onFinishRename={finishRename}
              onCancelRename={cancelRename}
              onStartRename={() => startRename(group)}
              onToggle={() => onToggleGroup(group.id)}
              onShowMenu={() => onShowGroupMenu(group.id)}
            />
          ) : null,
          renderTab(tab, group),
        ];
      })}
      <button className="new-tab-button" type="button" aria-label="New tab" onClick={onCreate}>
        <Plus size={18} />
      </button>
    </div>
  );

  const agentStrip = showAgentCluster ? (
    <div className={vertical ? 'tab-strip-agent tab-strip-agent-vertical' : 'tab-strip-agent'} role="tablist" aria-label="Agent Tabs and reply">
      {agentTaskSpace ? (
        <button
          type="button"
          className={`agent-tabs-entry ${watchingAgentTabs ? 'agent-tabs-entry-active' : ''} agent-tabs-entry-${agentTaskSpace.owner === 'user' ? 'user' : 'agent'}`}
          aria-label={`Agent Tabs · ${agentTaskSpace.name}. ${agentTaskSpace.owner === 'user' ? 'You own these tabs.' : 'Agent owns these tabs.'} Return to live view.`}
          title={`Agent Tabs · ${agentTaskSpace.name}`}
          onClick={onWatchAgentTabs}
        >
          <span className="agent-tabs-entry-label">Agent Tabs · {agentTaskSpace.name}</span>
          {watchingAgentTabs ? (
            <span className="agent-tabs-entry-subtitle" aria-hidden="true">
              {agentTaskSpace.owner === 'user' ? 'You own · Watching' : 'Agent owns · Watching'}
            </span>
          ) : (
            <span className="agent-tabs-entry-subtitle" aria-hidden="true">
              {agentTaskSpace.owner === 'user' ? 'You own' : 'Agent owns'}
            </span>
          )}
          <span className="agent-tabs-entry-count" aria-hidden="true">{agentTaskSpace.tabIds.length}</span>
        </button>
      ) : null}
      {agentOwnedTabs.map((tab) => renderTab(tab))}
    </div>
  ) : null;

  if (vertical) {
    return (
      <aside className="tab-rail side-pane" aria-label="Tabs">
        <div className="tab-rail-heading">
          <span>Tabs</span>
          <button type="button" className="pane-toggle" onClick={() => onCollapseChange?.(true)} aria-label="Collapse tabs">
            <ChevronLeft size={17} />
          </button>
        </div>
        {ordinaryStrip}
        {agentStrip}
      </aside>
    );
  }

  return (
    <div className="tab-row">
      {ordinaryStrip}
      {agentStrip}
    </div>
  );
}

interface TabGroupChipProps {
  group: BrowserTabGroup;
  count: number;
  editing: boolean;
  draftName: string;
  onDraftNameChange: (name: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onToggle: () => void;
  onShowMenu: () => void;
}

function TabGroupChip({ group, count, editing, draftName, onDraftNameChange, onFinishRename, onCancelRename, onStartRename, onToggle, onShowMenu }: TabGroupChipProps) {
  if (editing) {
    return (
      <form className={`tab-group tab-group-${group.color} tab-group-editing`} onSubmit={(event) => { event.preventDefault(); onFinishRename(); }}>
        <span className="tab-group-marker" aria-hidden="true" />
        <input
          aria-label={`Rename ${group.name} tab group`}
          autoFocus
          value={draftName}
          maxLength={32}
          onChange={(event) => onDraftNameChange(event.target.value)}
          onBlur={onFinishRename}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancelRename();
            }
          }}
        />
      </form>
    );
  }

  return (
    <div
      className={`tab-group tab-group-${group.color} ${group.collapsed ? 'tab-group-collapsed' : ''}`}
      role="group"
      aria-label={`${group.name} tab group, ${count} ${count === 1 ? 'tab' : 'tabs'}`}
      onContextMenu={(event) => { event.preventDefault(); onShowMenu(); }}
    >
      <button
        className="tab-group-toggle"
        type="button"
        aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.name} tab group`}
        aria-expanded={!group.collapsed}
        title={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.name}`}
        onClick={onToggle}
      >
        {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="tab-group-marker" aria-hidden="true" />
        <span className="tab-group-name">{group.name}</span>
        <span className="tab-group-count" aria-hidden="true">{count}</span>
      </button>
      <button className="tab-group-rename" type="button" aria-label={`Rename ${group.name} tab group`} title={`Rename ${group.name}`} onClick={onStartRename}>
        <Pencil size={11} />
      </button>
    </div>
  );
}

function TabFavicon({ tab }: { tab: TabStripTabSnapshot }) {
  const [candidateIndex, setCandidateIndex] = useState(0);

  if (tab.kind === 'page') return <FileText size={15} />;
  if (tab.kind === 'database') return <Database size={15} />;
  if (tab.kind === 'tandem') return <BookOpenText size={15} />;
  if (tab.kind === 'task') {
    if (tab.taskStatus === 'complete') return <Check size={15} className="tab-task-status-complete" />;
    if (tab.taskStatus === 'attention') return <CircleAlert size={15} className="tab-task-status-attention" />;
    if (tab.taskStatus === 'failed') return <TriangleAlert size={15} className="tab-task-status-failed" />;
    if (tab.taskStatus === 'cancelled' || tab.taskStatus === 'discarded') return <CircleSlash2 size={15} className="tab-task-status-cancelled" />;
    return (
      <>
        {tab.taskKind === 'code' ? <FileDiff size={15} /> : <MessageSquareText size={15} />}
        {tab.taskStatus === 'working' ? <span className="tab-task-working-dot" /> : null}
      </>
    );
  }
  if (tab.failure) return <TriangleAlert size={15} className="tab-failure-icon" />;
  const source = tab.faviconUrls?.[candidateIndex];
  if (!source) return <Globe2 size={15} />;
  return (
    <img
      className="tab-favicon"
      src={source}
      alt=""
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  );
}

function taskStatusLabel(status: TaskTabStatus): string {
  if (status === 'working') return 'task running';
  if (status === 'attention') return 'task needs attention';
  if (status === 'complete') return 'task completed';
  if (status === 'failed') return 'task failed';
  return status === 'cancelled' ? 'task cancelled' : 'task discarded';
}

function dropTab(event: DragEvent, beforeTabId: string | null, onReorder: (tabId: string, beforeTabId: string | null) => void) {
  event.preventDefault();
  event.stopPropagation();
  const tabId = event.dataTransfer.getData('application/x-poppin-tab');
  if (tabId && tabId !== beforeTabId) onReorder(tabId, beforeTabId);
}
