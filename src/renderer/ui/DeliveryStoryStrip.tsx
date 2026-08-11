import type { DeliveryStoryStage } from '../../shared/delivery-story';

interface DeliveryStoryStripProps {
  stages: DeliveryStoryStage[];
}

/** Quiet commit → push → PR → merge → local story strip for Code delivery. */
export function DeliveryStoryStrip({ stages }: DeliveryStoryStripProps) {
  return (
    <ol className="delivery-story-strip" aria-label="Delivery progress">
      {stages.map((stage, index) => (
        <li key={stage.id} className={`delivery-story-stage delivery-story-${stage.status}`}>
          {index > 0 ? <span className="delivery-story-connector" aria-hidden="true" /> : null}
          <span className="delivery-story-marker" aria-hidden="true" />
          <div>
            <strong>{stage.label}</strong>
            <small>{stage.detail}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}
