import { Globe2, Plus, TriangleAlert, X } from 'lucide-react';
import { type DragEvent, useMemo, useState } from 'react';

import type { BrowserTabGroup, BrowserTabSnapshot } from '../../shared/browser';

interface TabStripProps {
  tabs: BrowserTabSnapshot[];
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
}: TabStripProps) {
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const renderedGroups = new Set<string>();

  const startRename = (group: BrowserTabGroup) => {
    setEditingGroupId(group.id);
    setGroupName(group.name);
  };

  const finishRename = () => {
    if (editingGroupId && groupName.trim()) onRenameGroup(editingGroupId, groupName);
    setEditingGroupId(null);
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
        {tabs.flatMap((tab) => {
          const group = tab.groupId ? groupsById.get(tab.groupId) : undefined;
          const showGroup = Boolean(group && !renderedGroups.has(group.id));
          if (group) renderedGroups.add(group.id);
          const hideTab = Boolean(group?.collapsed);
          const isActive = tab.id === activeTabId;
          return [
            showGroup && group ? (
              editingGroupId === group.id ? (
                <form className={`tab-group tab-group-${group.color} tab-group-editing`} key={`group-${group.id}`} onSubmit={(event) => { event.preventDefault(); finishRename(); }}>
                  <input
                    aria-label="Tab group name"
                    autoFocus
                    value={groupName}
                    maxLength={32}
                    onChange={(event) => setGroupName(event.target.value)}
                    onBlur={finishRename}
                  />
                </form>
              ) : (
                <button
                  className={`tab-group tab-group-${group.color}`}
                  key={`group-${group.id}`}
                  type="button"
                  aria-label={`${group.name} tab group`}
                  aria-expanded={!group.collapsed}
                  title="Click to collapse or expand. Double-click to rename."
                  onClick={() => onToggleGroup(group.id)}
                  onDoubleClick={() => startRename(group)}
                  onContextMenu={(event) => { event.preventDefault(); onShowGroupMenu(group.id); }}
                >
                  <span />{group.name}
                </button>
              )
            ) : null,
            hideTab ? null : (
              <div
                className={`tab ${isActive ? 'tab-active' : ''} ${tab.pinned ? 'tab-pinned' : ''}`}
                key={tab.id}
                role="tab"
                aria-label={tab.pinned ? `${tab.title || 'Untitled'}, pinned` : undefined}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                title={tab.title || 'Untitled'}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('application/x-poppin-tab', tab.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropTab(event, tab.id, onReorder)}
                onClick={() => onActivate(tab.id)}
                onContextMenu={(event) => { event.preventDefault(); onShowTabMenu(tab.id); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onActivate(tab.id);
                  }
                }}
              >
                <span className="tab-icon" aria-hidden="true">
                  <TabFavicon key={`${tab.failure ? 'failed' : 'ready'}:${tab.faviconUrls.join('|')}`} tab={tab} />
                </span>
                {tab.pinned ? null : <span className="tab-title">{tab.title || 'Untitled'}</span>}
                {tab.isLoading ? <span className="tab-loading" aria-label="Loading" /> : null}
                {tab.pinned ? null : (
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

function TabFavicon({ tab }: { tab: BrowserTabSnapshot }) {
  const [candidateIndex, setCandidateIndex] = useState(0);

  if (tab.failure) return <TriangleAlert size={15} className="tab-failure-icon" />;
  const source = tab.faviconUrls[candidateIndex];
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
