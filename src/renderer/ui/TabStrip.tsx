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
            <button
              className={`tab ${isActive ? 'tab-active' : ''}`}
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onActivate(tab.id)}
              type="button"
            >
              <span className="tab-icon" aria-hidden="true">
                {tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : <Globe2 size={15} />}
              </span>
              <span className="tab-title">{tab.title || 'Untitled'}</span>
              {tab.isLoading ? <span className="tab-loading" aria-label="Loading" /> : null}
              <span
                className="tab-close"
                role="button"
                aria-label={`Close ${tab.title || 'tab'}`}
                tabIndex={0}
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
              </span>
            </button>
          );
        })}
      </div>
      <button className="new-tab-button" type="button" aria-label="New tab" onClick={onCreate}>
        <Plus size={19} />
      </button>
    </div>
  );
}

