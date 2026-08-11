import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { DEFAULT_BROWSER_SETTINGS } from '../shared/browser';
import { EMPTY_TANDEM_SNAPSHOT } from '../shared/tandem';
import type { ContinuityCommand } from '../shared/continuity';
import type { SettingsOverlaySnapshot, TandemSettingsCommand } from '../shared/settings-overlay';
import { BrowserSettingsPanel } from './ui/BrowserToolbar';
import './styles.css';

const EMPTY_SNAPSHOT: SettingsOverlaySnapshot = {
  open: true,
  browser: { settings: { ...DEFAULT_BROWSER_SETTINGS }, canReopenClosedTab: false },
  tandem: EMPTY_TANDEM_SNAPSHOT,
  continuity: { activeProfile: null, profiles: [], continuityReady: false },
};

export function SettingsOverlayApp() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);

  useEffect(() => {
    let mounted = true;
    void window.poppinSettings.getSnapshot().then((nextSnapshot) => {
      if (mounted) setSnapshot(nextSnapshot);
    });
    const unsubscribe = window.poppinSettings.subscribe((nextSnapshot) => {
      if (mounted) setSnapshot(nextSnapshot);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const sendTandemCommand = async (command: TandemSettingsCommand): Promise<string | null> => {
    const result = await window.poppinSettings.command({ type: 'tandem', command });
    return result.ok ? null : result.message ?? 'Poppin could not complete that Tandem action.';
  };

  const sendContinuityCommand = async (command: ContinuityCommand): Promise<string | null> => {
    const result = await window.poppinSettings.command({ type: 'continuity', command });
    return result.ok ? null : result.message ?? 'Poppin could not complete that continuity action.';
  };

  return (
    <div className="settings-overlay-root">
      <BrowserSettingsPanel
        settings={snapshot.browser.settings}
        canReopenClosedTab={snapshot.browser.canReopenClosedTab}
        onClose={() => { void window.poppinSettings.command({ type: 'close' }); }}
        onReopenClosedTab={() => { void window.poppinSettings.command({ type: 'reopenClosedTab' }); }}
        onUpdate={(settings) => { void window.poppinSettings.command({ type: 'updateBrowserSettings', settings }); }}
        tandem={snapshot.tandem}
        onTandemCommand={sendTandemCommand}
        continuity={snapshot.continuity}
        onContinuityCommand={sendContinuityCommand}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Poppin Settings could not find its application root.');

createRoot(root).render(
  <StrictMode>
    <SettingsOverlayApp />
  </StrictMode>,
);
