import { memo } from 'react';
import { formatDateTime, formatDuration, formatMoney, formatPercent, formatPrice, formatQuantity, toneOf } from '../../lib/format';
import type { Trade } from '../../strategy/types';

interface StrategyTradeDetailsProps {
  trade: Trade;
  onClose: () => void;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }): React.JSX.Element {
  return (
    <div className="stat-list__row">
      <dt>{label}</dt>
      <dd className={`value value--${tone ?? 'neutral'}`}>{value}</dd>
    </div>
  );
}

function StrategyTradeDetailsImpl({ trade, onClose }: StrategyTradeDetailsProps): React.JSX.Element {
  return (
    <aside className="trade-details">
      <div className="trade-details__header">
        <h4>Trade #{trade.index}</h4>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="stat-list">
        <Row label="Direction" value={trade.direction.toUpperCase()} tone={trade.direction === 'long' ? 'positive' : 'negative'} />
        <Row label="Entry ID" value={trade.entryId} />
        <Row label="Entry" value={formatDateTime(trade.entryTime)} />
        <Row label="Entry Price" value={formatPrice(trade.entryPrice)} />
        <Row label="Exit" value={formatDateTime(trade.exitTime)} />
        <Row label="Exit Price" value={formatPrice(trade.exitPrice)} />
        <Row label="Quantity" value={formatQuantity(trade.quantity)} />
        <Row label="Gross P&L" value={formatMoney(trade.grossPnL, { signed: true })} tone={toneOf(trade.grossPnL)} />
        <Row label="Commission" value={formatMoney(-trade.commission)} tone={trade.commission > 0 ? 'negative' : 'neutral'} />
        <Row label="Net P&L" value={formatMoney(trade.netPnL, { signed: true })} tone={toneOf(trade.netPnL)} />
        <Row label="Return" value={formatPercent(trade.returnPercent, { signed: true })} tone={toneOf(trade.returnPercent)} />
        <Row label="Cumulative P&L" value={formatMoney(trade.cumulativePnL, { signed: true })} tone={toneOf(trade.cumulativePnL)} />
        <Row label="Duration" value={formatDuration(trade.durationMs)} />
        <Row label="Max Run-up" value={formatMoney(trade.maxRunup)} />
        <Row label="Max Drawdown" value={formatMoney(-trade.maxDrawdown)} />
      </dl>
      <p className="trade-details__note">
        Slippage is applied by the engine to the fill prices above, so it is inside every P&amp;L figure rather
        than a separate line item.
      </p>
    </aside>
  );
}

export const StrategyTradeDetails = memo(StrategyTradeDetailsImpl);
