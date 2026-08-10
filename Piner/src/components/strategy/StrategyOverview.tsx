import { memo, useMemo } from 'react';
import { THEME } from '../../lib/chart';
import { formatMoney, formatNumber, formatPercent, formatQuantity, toneOf } from '../../lib/format';
import type { StrategyExecutionResult } from '../../strategy/types';
import { MetricCard } from './MetricCard';
import { StrategyMiniChart, type MiniChartSeries } from './StrategyMiniChart';

interface StrategyOverviewProps {
  result: StrategyExecutionResult;
}

function StrategyOverviewImpl({ result }: StrategyOverviewProps): React.JSX.Element {
  const s = result.summary;
  const capital = s.initialCapital;

  const series = useMemo<MiniChartSeries[]>(
    () => [
      {
        id: 'strategy',
        label: 'Strategy',
        color: s.netProfit >= 0 ? THEME.upColor : THEME.downColor,
        fill: `rgba(${s.netProfit >= 0 ? '8, 153, 129' : '242, 54, 69'}, 0.18)`,
        data: result.equityCurve.map((p) => ({ time: p.time, value: p.equity - capital })),
      },
      {
        id: 'benchmark',
        label: 'Buy & Hold',
        color: THEME.benchmark,
        dashed: true,
        data: result.equityCurve.map((p) => ({ time: p.time, value: p.benchmarkEquity - capital })),
      },
    ],
    [result.equityCurve, capital, s.netProfit],
  );

  return (
    <div className="strategy-overview">
      {/* The four headline numbers, in TradingView's order. */}
      <div className="metric-grid metric-grid--headline">
        <MetricCard
          label="Net Profit"
          value={formatMoney(s.netProfit, { signed: true, unit: true })}
          sub={formatPercent(s.netProfitPercent, { signed: true })}
          tone={toneOf(s.netProfit)}
          title="Realized profit of closed trades, net of commission (TradingView's definition)."
        />
        <MetricCard
          label="Max Drawdown"
          value={formatMoney(s.maxDrawdown, { unit: true })}
          sub={formatPercent(s.maxDrawdownPercent)}
          tone={s.maxDrawdown > 0 ? 'negative' : 'neutral'}
          title="Largest peak-to-trough equity decline along the broker's intrabar path."
        />
        <MetricCard
          label="Profitable Trades"
          value={formatPercent(s.winRate)}
          sub={`${s.winningTrades} / ${s.totalTrades}`}
          tone={s.winRate === null ? 'neutral' : s.winRate >= 50 ? 'positive' : 'negative'}
        />
        <MetricCard
          label="Profit Factor"
          value={formatNumber(s.profitFactor, 3)}
          sub={`${formatMoney(s.grossProfit)} / ${formatMoney(s.grossLoss)}`}
          tone={s.profitFactor === null ? 'neutral' : s.profitFactor >= 1 ? 'positive' : 'negative'}
        />
      </div>

      <div className="metric-grid">
        <MetricCard label="Final Equity" value={formatMoney(s.finalEquity, { unit: true })} sub={`from ${formatMoney(capital)}`} />
        <MetricCard
          label="Open PnL"
          value={formatMoney(s.openPnL, { signed: true, unit: true })}
          tone={toneOf(s.openPnL)}
          sub={result.openPosition ? `${result.openPosition.direction} ${formatQuantity(Math.abs(result.openPosition.size))}` : 'flat'}
        />
        <MetricCard
          label="Buy & Hold Return"
          value={formatPercent(s.buyHoldReturnPercent, { signed: true })}
          sub={formatMoney(s.buyHoldPnL, { signed: true })}
          tone={toneOf(s.buyHoldReturnPercent)}
        />
        <MetricCard
          label="Outperformance"
          value={formatPercent(s.outperformancePercent, { signed: true })}
          tone={toneOf(s.outperformancePercent)}
          title="Strategy return minus buy-&-hold return over the same bars."
        />
        <MetricCard label="Sharpe Ratio" value={formatNumber(s.sharpe)} tone={toneOf(s.sharpe)} />
        <MetricCard label="Sortino Ratio" value={formatNumber(s.sortino)} tone={toneOf(s.sortino)} />
        <MetricCard label="CAGR" value={formatPercent(s.annualizedReturnPercent, { signed: true })} tone={toneOf(s.annualizedReturnPercent)} />
        <MetricCard label="Total Trades" value={`${s.totalTrades}`} sub={s.openTrades > 0 ? `${s.openTrades} open` : 'no open position'} />
      </div>

      {result.openPosition && (
        <div className="strategy-open-position">
          <span className={`badge badge--${result.openPosition.direction}`}>
            OPEN {result.openPosition.direction.toUpperCase()}
          </span>
          <span>
            {formatQuantity(Math.abs(result.openPosition.size))} @ {formatNumber(result.openPosition.averageEntryPrice)}
          </span>
          <span className={`value value--${toneOf(result.openPosition.unrealizedPnL)}`}>
            {formatMoney(result.openPosition.unrealizedPnL, { signed: true })} unrealized
          </span>
          <span className="strategy-open-position__note">Not counted as a closed trade.</span>
        </div>
      )}

      <section className="strategy-panel">
        <h4>Cumulative P&amp;L vs Buy &amp; Hold</h4>
        <StrategyMiniChart series={series} height={190} baseline={0} ariaLabel="Cumulative profit and loss" />
      </section>
    </div>
  );
}

export const StrategyOverview = memo(StrategyOverviewImpl);
