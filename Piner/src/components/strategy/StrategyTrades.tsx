import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { formatDateTime, formatDuration, formatMoney, formatPercent, formatPrice, formatQuantity, toneOf } from '../../lib/format';
import type { Trade } from '../../strategy/types';
import { StrategyTradeDetails } from './StrategyTradeDetails';

interface StrategyTradesProps {
  trades: readonly Trade[];
  selectedTradeIndex: number | null;
  onSelect: (index: number | null) => void;
  onExportCsv: () => void;
}

type SortKey = 'index' | 'entryTime' | 'exitTime' | 'netPnL' | 'returnPercent' | 'durationMs' | 'quantity';
type Filter = 'all' | 'long' | 'short' | 'winners' | 'losers';

const ROW_HEIGHT = 30;
const OVERSCAN = 8;
const VIEWPORT_HEIGHT = 320;

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: 'index', label: '#' },
  { key: null, label: 'Direction' },
  { key: 'entryTime', label: 'Entry Time' },
  { key: null, label: 'Entry' },
  { key: 'exitTime', label: 'Exit Time' },
  { key: null, label: 'Exit' },
  { key: 'quantity', label: 'Qty' },
  { key: 'netPnL', label: 'P&L (NPR)' },
  { key: 'returnPercent', label: 'Return' },
  { key: 'durationMs', label: 'Duration' },
];

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'long', label: 'Long' },
  { id: 'short', label: 'Short' },
  { id: 'winners', label: 'Winners' },
  { id: 'losers', label: 'Losers' },
];

function matches(trade: Trade, filter: Filter): boolean {
  switch (filter) {
    case 'long':
      return trade.direction === 'long';
    case 'short':
      return trade.direction === 'short';
    case 'winners':
      return trade.netPnL > 0;
    case 'losers':
      return trade.netPnL < 0;
    default:
      return true;
  }
}

/**
 * The trade ledger.
 *
 * Rows are windowed by hand (fixed row height + a scroll offset) rather than pulled in as a
 * virtualization dependency: a strategy can produce six figures of trades, and this is ~20
 * lines of arithmetic against a library plus its React adapter. Sorting/filtering derive ONE
 * new array per change (`useMemo`) instead of copying per render, and the search box is
 * deferred so typing never blocks on a large ledger.
 */
function StrategyTradesImpl({ trades, selectedTradeIndex, onSelect, onExportCsv }: StrategyTradesProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('index');
  const [ascending, setAscending] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  const visibleTrades = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const filtered = trades.filter(
      (t) => matches(t, filter) && (needle === '' || `${t.index}`.includes(needle) || t.entryId.toLowerCase().includes(needle)),
    );
    const direction = ascending ? 1 : -1;
    return filtered.sort((a, b) => (a[sortKey] - b[sortKey]) * direction);
  }, [trades, filter, deferredQuery, sortKey, ascending]);

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setAscending((prev) => !prev);
      else {
        setSortKey(key);
        setAscending(key === 'index' || key === 'entryTime' || key === 'exitTime');
      }
    },
    [sortKey],
  );

  const total = visibleTrades.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(total, start + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2);
  const window = visibleTrades.slice(start, end);

  const selectedTrade = selectedTradeIndex === null ? null : trades.find((t) => t.index === selectedTradeIndex) ?? null;

  return (
    <div className="strategy-trades">
      <div className="strategy-trades__toolbar">
        <div className="segmented" role="group" aria-label="Filter trades">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`segmented__btn${filter === f.id ? ' segmented__btn--active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="strategy-trades__search"
          placeholder="Search # or entry id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search trades"
        />
        <span className="strategy-trades__count">
          {total} of {trades.length}
        </span>
        <button type="button" className="btn btn--ghost" onClick={onExportCsv} disabled={trades.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="strategy-trades__body">
        <div className="trade-table" role="table" aria-rowcount={total}>
          <div className="trade-table__head" role="row">
            {COLUMNS.map((col) => (
              <div
                key={col.label}
                role="columnheader"
                className={`trade-table__cell${col.key ? ' trade-table__cell--sortable' : ''}`}
                onClick={col.key ? () => toggleSort(col.key!) : undefined}
                aria-sort={col.key && col.key === sortKey ? (ascending ? 'ascending' : 'descending') : undefined}
              >
                {col.label}
                {col.key === sortKey ? (ascending ? ' ▲' : ' ▼') : ''}
              </div>
            ))}
          </div>

          <div
            className="trade-table__viewport"
            ref={viewportRef}
            style={{ height: VIEWPORT_HEIGHT }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            {total === 0 ? (
              <p className="empty-note">No trades match this filter.</p>
            ) : (
              <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
                <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
                  {window.map((trade) => (
                    <div
                      key={trade.id}
                      role="row"
                      className={`trade-table__row${selectedTradeIndex === trade.index ? ' trade-table__row--selected' : ''}`}
                      style={{ height: ROW_HEIGHT }}
                      onClick={() => onSelect(selectedTradeIndex === trade.index ? null : trade.index)}
                    >
                      <div role="cell" className="trade-table__cell">
                        {trade.index}
                      </div>
                      <div role="cell" className={`trade-table__cell value--${trade.direction === 'long' ? 'positive' : 'negative'}`}>
                        {trade.direction.toUpperCase()}
                      </div>
                      <div role="cell" className="trade-table__cell">
                        {formatDateTime(trade.entryTime, { withTime: false })}
                      </div>
                      <div role="cell" className="trade-table__cell">
                        {formatPrice(trade.entryPrice)}
                      </div>
                      <div role="cell" className="trade-table__cell">
                        {formatDateTime(trade.exitTime, { withTime: false })}
                      </div>
                      <div role="cell" className="trade-table__cell">
                        {formatPrice(trade.exitPrice)}
                      </div>
                      <div role="cell" className="trade-table__cell">
                        {formatQuantity(trade.quantity)}
                      </div>
                      <div role="cell" className={`trade-table__cell value--${toneOf(trade.netPnL)}`}>
                        {formatMoney(trade.netPnL, { signed: true })}
                      </div>
                      <div role="cell" className={`trade-table__cell value--${toneOf(trade.returnPercent)}`}>
                        {formatPercent(trade.returnPercent, { signed: true })}
                      </div>
                      <div role="cell" className="trade-table__cell">
                        {formatDuration(trade.durationMs)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {selectedTrade && <StrategyTradeDetails trade={selectedTrade} onClose={() => onSelect(null)} />}
      </div>
    </div>
  );
}

export const StrategyTrades = memo(StrategyTradesImpl);
