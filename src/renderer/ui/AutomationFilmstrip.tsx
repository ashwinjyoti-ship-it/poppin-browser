import type { BrowserAgentLogEntry } from '../../shared/browser-agent';

interface AutomationFilmstripProps {
  log: BrowserAgentLogEntry[];
}

/**
 * Quiet filmstrip of recent automation frames. Prefers screenshot thumbnails;
 * falls back to compact action chips when a step has no frame.
 */
export function AutomationFilmstrip({ log }: AutomationFilmstripProps) {
  const frames = log
    .filter((entry) => entry.outcome !== 'started')
    .slice(-12);
  if (frames.length === 0) return null;

  return (
    <div className="automation-filmstrip" aria-label="Automation filmstrip">
      <div className="automation-filmstrip-track">
        {frames.map((entry) => (
          <figure key={entry.id} className={`automation-frame automation-frame-${entry.outcome}`}>
            {entry.frameDataUrl ? (
              <img src={entry.frameDataUrl} alt="" width={96} height={64} loading="lazy" />
            ) : (
              <div className="automation-frame-placeholder" aria-hidden="true" />
            )}
            <figcaption>
              <span>{entry.action}</span>
              <small>{entry.detail || (entry.ref ? `ref ${entry.ref}` : entry.target) || entry.outcome}</small>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
