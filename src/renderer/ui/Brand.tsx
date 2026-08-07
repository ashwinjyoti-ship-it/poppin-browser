export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="Poppin Browser">
      <span className="brand-orbit" aria-hidden="true">
        <i className="orbit-dot orbit-dot-1" />
        <i className="orbit-dot orbit-dot-2" />
        <i className="orbit-dot orbit-dot-3" />
        <i className="orbit-dot orbit-dot-4" />
        <i className="orbit-dot orbit-dot-5" />
        <i className="orbit-dot orbit-dot-6" />
        <i className="orbit-dot orbit-dark-1" />
        <i className="orbit-dot orbit-dark-2" />
        <i className="orbit-dot orbit-core" />
      </span>
      {compact ? null : <span className="brand-name">poppin <strong>browser</strong></span>}
    </div>
  );
}
