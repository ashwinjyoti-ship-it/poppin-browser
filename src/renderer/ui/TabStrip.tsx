import { Globe2, Plus, X } from 'lucide-react';

import type { BrowserTabSnapshot } from '../../shared/browser';

interface TabStripProps {
  tabs: BrowserTabSnapshot[];
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
}

export function TabStrip({ tabs, activeTabId, onActivate, onClose, onCreate }: TabStripProps) {
  return (
    <div className="tab-row">
      <div className="tab-strip" role="tablist" aria-label="Browser tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              className={`tab ${isActive ? 'tab-active' : ''}`}
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onActivate(tab.id);
                }
              }}
            >
              <span className="tab-icon" aria-hidden="true">
                <Globe2 size={15} />
                {tab.faviconUrl ? <img className="tab-favicon" src={tab.faviconUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
              </span>
              <span className="tab-title">{tab.title || 'Untitled'}</span>
              {tab.isLoading ? <span className="tab-loading" aria-label="Loading" /> : null}
              <button
                className="tab-close"
                type="button"
                aria-label={`Close ${tab.title || 'tab'}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(tab.id);
                  }
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <button className="new-tab-button" type="button" aria-label="New tab" onClick={onCreate}>
        <Plus size={19} />
      </button>
    </div>
  );
}
