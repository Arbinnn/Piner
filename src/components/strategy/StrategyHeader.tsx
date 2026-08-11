import { memo } from 'react';
import { formatDateTime, formatMoney, formatPercent, toneOf } from '../../lib/format';
import type { StrategyConfig, StrategyExecutionResult, StrategyStatus } from '../../strategy/types';
import { CollapseIcon, ExpandIcon, GearIcon, PlayIcon } from './Icons';

interface StrategyHeaderProps {
  title: string;
  symbol: string;
  timeframe: string;
  status: StrategyStatus;
  result: StrategyExecutionResult | null;
  config: StrategyConfig;
  onConfigChange: (patch: Partial<StrategyConfig>) => void;
  datasetFrom: number | null;
  datasetTo: number | null;
  onRun: () => void;
  onOpenSettings: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onCollapse: () => void;
}

const STATUS_LABEL: Record<StrategyStatus, string> = {
  idle: 'Not run yet',
  running: 'Running backtest…',
  success: 'Backtest ready',
  error: 'Error',
};

/** epoch seconds -> the `YYYY-MM-DD` a native date input speaks (UTC, like the bar times). */
function toDateInput(seconds: number | null): string {
  return seconds === null ? '' : new Date(seconds * 1000).toISOString().slice(0, 10);
}

function fromDateInput(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function StrategyHeaderImpl({
  title,
  symbol,
  timeframe,
  status,
  result,
  config,
  onConfigChange,
  datasetFrom,
  datasetTo,
  onRun,
  onOpenSettings,
  expanded,
  onToggleExpanded,
  onCollapse,
}: StrategyHeaderProps): React.JSX.Element {
  const s = result?.summary;

  return (
    <header className="strategy-header">
      <div className="strategy-header__row">
        <div className="strategy-header__identity">
          <span className="strategy-header__name">{title || 'Strategy'}</span>
          <span className="strategy-header__dataset">
            {symbol} · {timeframe}
          </span>
          <span className={`status-dot status-dot--${status}`} aria-live="polite">
            {STATUS_LABEL[status]}
          </span>
        </div>

        <div className="strategy-header__controls">
          {/* Date range and capital live in the header because they are the two settings a
              tester changes constantly; everything else sits in Properties. */}
          <label className="inline-field">
            <span>From</span>
            <input
              type="date"
              value={toDateInput(config.from ?? datasetFrom)}
              min={toDateInput(datasetFrom)}
              max={toDateInput(datasetTo)}
              onChange={(e) => onConfigChange({ from: fromDateInput(e.target.value, false) })}
            />
          </label>
          <label className="inline-field">
            <span>To</span>
            <input
              type="date"
              value={toDateInput(config.to ?? datasetTo)}
              min={toDateInput(datasetFrom)}
              max={toDateInput(datasetTo)}
              onChange={(e) => onConfigChange({ to: fromDateInput(e.target.value, true) })}
            />
          </label>
          <label className="inline-field">
            <span>Capital</span>
            <input
              type="number"
              min={1}
              step={1000}
              value={config.initialCapital}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                if (Number.isFinite(parsed) && parsed > 0) onConfigChange({ initialCapital: parsed });
              }}
            />
          </label>

          <button type="button" className="btn btn--primary btn--icon-text" onClick={onRun} disabled={status === 'running'}>
            <PlayIcon />
            {status === 'running' ? 'Running…' : 'Run Backtest'}
          </button>

          <button type="button" className="icon-btn" onClick={onOpenSettings} title="Properties" aria-label="Properties">
            <GearIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onToggleExpanded}
            title={expanded ? 'Restore panel' : 'Expand panel'}
            aria-label={expanded ? 'Restore panel' : 'Expand panel'}
          >
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
          <button type="button" className="icon-btn" onClick={onCollapse} title="Collapse panel" aria-label="Collapse panel">
            <span className="icon-btn__glyph">−</span>
          </button>
        </div>
      </div>

      {s && result && (
        <div className="strategy-header__stats">
          <span className="strategy-header__equity">
            {formatMoney(s.initialCapital)} → {formatMoney(s.finalEquity, { unit: true })}
          </span>
          <span className={`value value--${toneOf(s.netProfitPercent)}`}>
            {formatPercent(s.netProfitPercent, { signed: true })}
          </span>
          <span>{s.totalTrades} trades</span>
          <span>{formatPercent(s.winRate)} win rate</span>
          <span className="value value--negative">{formatPercent(s.maxDrawdownPercent)} max DD</span>
          <span className="strategy-header__period">
            {formatDateTime(result.firstBarTime, { withTime: false })} – {formatDateTime(result.lastBarTime, { withTime: false })} ·{' '}
            {result.barCount} bars
          </span>
        </div>
      )}
    </header>
  );
}

export const StrategyHeader = memo(StrategyHeaderImpl);
