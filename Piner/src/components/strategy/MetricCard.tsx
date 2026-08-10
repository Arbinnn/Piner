import { memo } from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'negative' | 'neutral';
  title?: string;
}

function MetricCardImpl({ label, value, sub, tone = 'neutral', title }: MetricCardProps): React.JSX.Element {
  return (
    <div className="metric-card" title={title}>
      <span className="metric-card__label">{label}</span>
      <span className={`metric-card__value metric-card__value--${tone}`}>{value}</span>
      {sub && <span className="metric-card__sub">{sub}</span>}
    </div>
  );
}

export const MetricCard = memo(MetricCardImpl);
