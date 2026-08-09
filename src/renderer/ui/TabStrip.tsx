import { BookOpenText, ChevronDown, ChevronRight, Database, FileDiff, FileText, Globe2, MessageSquareText, Pencil, Plus, TriangleAlert, X } from 'lucide-react';
import { type DragEvent, useMemo, useRef, useState } from 'react';

import type { BrowserFailure, BrowserTabGroup } from '../../shared/browser';
import type { BrowserTaskSpace } from '../../shared/browser-agent';

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
}

export interface TabStripTabSnapshot {
  id: string;
  title: string;
  kind?: 'browser' | 'page' | 'database' | 'task';
  /** Picks the task tab's icon: a reply bubble for Work, a diff mark for Code. */
  taskKind?: 'work' | 'code';
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
}: TabStripProps) {
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

  return (
    <div className="tab-row">
      <div
        className="tab-strip"
        role="tablist"
        aria-label="Browser tabs"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropTab(event, null, onReorder)}
      >
        {onOpenTandemWorld ? (
          <button
            type="button"
            className="tab tab-pinned tab-tandem-world"
            aria-label="Open Tandem World"
            title={tandemReady ? 'Tandem World' : tandemMessage ?? 'Connect Tandem to use Tandem World'}
            disabled={!tandemReady}
            onClick={onOpenTandemWorld}
          >
            <span className="tab-icon" aria-hidden="true"><BookOpenText size={15} /></span>
          </button>
        ) : null}
        {agentTaskSpace ? (
          <button
            type="button"
            className={`agent-tabs-entry ${watchingAgentTabs ? 'agent-tabs-entry-active' : ''}`}
            aria-label={`Agent Tabs · ${agentTaskSpace.name}. Return to live view.`}
            title={`Agent Tabs · ${agentTaskSpace.name}`}
            onClick={onWatchAgentTabs}
          >
            <span className="agent-tabs-entry-label">Agent Tabs · {agentTaskSpace.name}</span>
            <span className="agent-tabs-entry-count" aria-hidden="true">{agentTaskSpace.tabIds.length}</span>
          </button>
        ) : null}
        {tabs.flatMap((tab) => {
          const group = tab.groupId ? groupsById.get(tab.groupId) : undefined;
          const showGroup = Boolean(group && !renderedGroups.has(group.id));
          if (group) renderedGroups.add(group.id);
          const hideTab = Boolean(group?.collapsed);
          const isActive = tab.id === activeTabId;
          const groupClasses = group
            ? ` tab-grouped tab-grouped-${group.color}`
            : '';
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
            hideTab ? null : (
              <div
                className={`tab ${isActive ? 'tab-active' : ''} ${tab.pinned ? 'tab-pinned' : ''}${(tab.taskSpaceId || tab.kind === 'task') ? ' tab-agent' : ''}${groupClasses}`}
                key={tab.id}
                role="tab"
                aria-label={tab.pinned ? `${tab.title || 'Untitled'}, pinned` : group ? `${tab.title || 'Untitled'}, ${group.name} group` : undefined}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                title={tab.title || 'Untitled'}
                draggable={!tab.taskSpaceId && tab.kind !== 'task'}
                onDragStart={(event) => { if (!tab.taskSpaceId && tab.kind !== 'task') event.dataTransfer.setData('application/x-poppin-tab', tab.id); }}
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
                <span className="tab-icon" aria-hidden="true">
                  <TabFavicon key={`${tab.failure ? 'failed' : 'ready'}:${tab.faviconUrls?.join('|') ?? tab.kind}`} tab={tab} />
                </span>
                {tab.pinned ? null : <span className="tab-title">{tab.title || 'Untitled'}</span>}
                {tab.isLoading ? <span className="tab-loading" aria-label="Loading" /> : null}
                {tab.kind !== 'task' && (tab.pinned || tab.taskSpaceId) ? null : (
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
            ),
          ];
        })}
      </div>
      <button className="new-tab-button" type="button" aria-label="New tab" onClick={onCreate}>
        <Plus size={18} />
      </button>
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
  if (tab.kind === 'task') return tab.taskKind === 'code' ? <FileDiff size={15} /> : <MessageSquareText size={15} />;
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

function dropTab(event: DragEvent, beforeTabId: string | null, onReorder: (tabId: string, beforeTabId: string | null) => void) {
  event.preventDefault();
  event.stopPropagation();
  const tabId = event.dataTransfer.getData('application/x-poppin-tab');
  if (tabId && tabId !== beforeTabId) onReorder(tabId, beforeTabId);
}
