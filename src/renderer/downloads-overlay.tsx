import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { EMPTY_DOWNLOADS_SNAPSHOT } from '../shared/downloads';
import { DownloadsPanel } from './ui/DownloadsPopover';
import './styles.css';

export function DownloadsOverlayApp() {
  const [snapshot, setSnapshot] = useState(EMPTY_DOWNLOADS_SNAPSHOT);

  useEffect(() => {
    let mounted = true;
    void window.poppinDownloads.getSnapshot().then((nextSnapshot) => {
      if (mounted) setSnapshot(nextSnapshot);
    });
    const unsubscribe = window.poppinDownloads.subscribe((nextSnapshot) => {
      if (mounted) setSnapshot(nextSnapshot);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <div className="downloads-overlay-root">
      <DownloadsPanel
        snapshot={snapshot}
        onCancel={(id) => { void window.poppinDownloads.command({ type: 'cancel', id }); }}
        onReveal={(id) => { void window.poppinDownloads.command({ type: 'reveal', id }); }}
        onDismiss={(id) => { void window.poppinDownloads.command({ type: 'dismiss', id }); }}
        onClearFinished={() => { void window.poppinDownloads.command({ type: 'clearFinished' }); }}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Poppin Downloads could not find its application root.');

createRoot(root).render(
  <StrictMode>
    <DownloadsOverlayApp />
  </StrictMode>,
);
