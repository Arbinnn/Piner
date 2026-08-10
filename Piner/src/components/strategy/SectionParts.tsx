import { memo } from 'react';

export interface SectionMetric {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'negative' | 'neutral';
  title?: string;
}

/** The headline row every analysis section opens with. */
function SectionCardsImpl({ metrics }: { metrics: readonly SectionMetric[] }): React.JSX.Element {
  return (
    <div className="section-cards">
      {metrics.map((metric) => (
        <div className="section-card" key={metric.label} title={metric.title}>
          <span className="section-card__label">{metric.label}</span>
          <span className="section-card__value">
            <span className={`value value--${metric.tone ?? 'neutral'}`}>{metric.value}</span>
            {metric.sub && <em className={`section-card__sub value--${metric.tone ?? 'neutral'}`}>{metric.sub}</em>}
          </span>
        </div>
      ))}
    </div>
  );
}

export const SectionCards = memo(SectionCardsImpl);

export interface StatRow {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'negative' | 'neutral';
  title?: string;
}

function StatListImpl({ title, rows }: { title?: string; rows: readonly StatRow[] }): React.JSX.Element {
  return (
    <div className="stat-block">
      {title && <h5>{title}</h5>}
      <dl className="stat-list">
        {rows.map((row) => (
          <div className="stat-list__row" key={row.label} title={row.title}>
            <dt>{row.label}</dt>
            <dd className={`value value--${row.tone ?? 'neutral'}`}>
              {row.value}
              {row.sub && <span className="stat-list__sub">{row.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export const StatList = memo(StatListImpl);

/** Two-column layout used by every section body (chart + chart, or stats + chart). */
export function SectionSplit({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="section-split">{children}</div>;
}

export function SectionBlock({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="section-block">
      <h5>{title}</h5>
      {children}
    </div>
  );
}
