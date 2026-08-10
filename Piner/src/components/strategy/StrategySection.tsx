import { memo, useState } from 'react';
import { ChevronDownIcon } from './Icons';

export interface SectionTab<T extends string> {
  id: T;
  label: string;
}

interface StrategySectionProps<T extends string> {
  title: string;
  tabs: readonly SectionTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  children: React.ReactNode;
  /** Sections start open; the header chevron hides the body without losing the tab choice. */
  defaultHidden?: boolean;
}

/**
 * Shell for the analysis sections: a title, pill sub-tabs, and a hide toggle.
 *
 * Collapsing is local state per section — a user reading drawdowns should be able to fold the
 * three sections they are not reading without that choice leaking into anything else.
 */
function StrategySectionImpl<T extends string>({
  title,
  tabs,
  active,
  onSelect,
  children,
  defaultHidden = false,
}: StrategySectionProps<T>): React.JSX.Element {
  const [hidden, setHidden] = useState(defaultHidden);

  return (
    <section className={`analysis-section${hidden ? ' analysis-section--hidden' : ''}`}>
      <div className="analysis-section__header">
        <h3>{title}</h3>
        <div className="pills" role="tablist" aria-label={title}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              className={`pill${active === tab.id ? ' pill--active' : ''}`}
              onClick={() => {
                onSelect(tab.id);
                setHidden(false);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`icon-btn icon-btn--chevron${hidden ? ' icon-btn--flipped' : ''}`}
          onClick={() => setHidden((prev) => !prev)}
          aria-expanded={!hidden}
          title={hidden ? `Show ${title}` : `Hide ${title}`}
          aria-label={hidden ? `Show ${title}` : `Hide ${title}`}
        >
          <ChevronDownIcon />
        </button>
      </div>
      {!hidden && <div className="analysis-section__body">{children}</div>}
    </section>
  );
}

export const StrategySection = memo(StrategySectionImpl) as typeof StrategySectionImpl;
