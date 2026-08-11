import { memo } from 'react';
import { formatDuration, formatMoney, formatNumber, formatPercent, toneOf } from '../../lib/format';
import type { StrategyExecutionResult } from '../../strategy/types';

interface StrategyPerformanceProps {
  result: StrategyExecutionResult;
}

interface Row {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'negative' | 'neutral';
  title?: string;
}

function StatTable({ title, rows }: { title: string; rows: Row[] }): React.JSX.Element {
  return (
    <section className="strategy-panel">
      <h4>{title}</h4>
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
    </section>
  );
}

/** Performance Summary tab — the full metric set, grouped the way a tester expects to read it. */
function StrategyPerformanceImpl({ result }: StrategyPerformanceProps): React.JSX.Element {
  const s = result.summary;

  return (
    <div className="strategy-performance__grid">
      <StatTable
        title="Return & Risk-Adjusted Performance"
        rows={[
          { label: 'Initial Capital', value: formatMoney(s.initialCapital) },
          { label: 'Final Equity', value: formatMoney(s.finalEquity) },
          {
            label: 'Net Profit',
            value: formatMoney(s.netProfit, { signed: true }),
            sub: formatPercent(s.netProfitPercent, { signed: true }),
            tone: toneOf(s.netProfit),
          },
          { label: 'Gross Profit', value: formatMoney(s.grossProfit), tone: 'positive' },
          { label: 'Gross Loss', value: formatMoney(-s.grossLoss), tone: 'negative' },
          { label: 'Open PnL', value: formatMoney(s.openPnL, { signed: true }), tone: toneOf(s.openPnL) },
          {
            label: 'Buy & Hold Return',
            value: formatPercent(s.buyHoldReturnPercent, { signed: true }),
            sub: formatMoney(s.buyHoldPnL, { signed: true }),
            tone: toneOf(s.buyHoldReturnPercent),
          },
          {
            label: 'Strategy Outperformance',
            value: formatPercent(s.outperformancePercent, { signed: true }),
            tone: toneOf(s.outperformancePercent),
          },
          {
            label: 'Sharpe Ratio',
            value: formatNumber(s.sharpe),
            tone: toneOf(s.sharpe),
            title: 'Annualized from per-bar equity returns including flat bars, not from trade P&L.',
          },
          { label: 'Sortino Ratio', value: formatNumber(s.sortino), tone: toneOf(s.sortino) },
          {
            label: 'CAGR',
            value: formatPercent(s.annualizedReturnPercent, { signed: true }),
            tone: toneOf(s.annualizedReturnPercent),
            title: `Compounded over the real bar-time span (${formatNumber(s.periodsPerYear, 0)} bars/year).`,
          },
          { label: 'Calmar Ratio', value: formatNumber(s.calmar) },
          { label: 'Market Exposure', value: formatPercent(s.exposurePercent) },
        ]}
      />

      <StatTable
        title="Trades Overview"
        rows={[
          { label: 'Total Closed Trades', value: `${s.totalTrades}` },
          { label: 'Open Trades', value: `${s.openTrades}` },
          { label: 'Winning Trades', value: `${s.winningTrades}`, tone: 'positive' },
          { label: 'Losing Trades', value: `${s.losingTrades}`, tone: 'negative' },
          { label: 'Breakeven Trades', value: `${s.evenTrades}` },
          { label: 'Percent Profitable', value: formatPercent(s.winRate) },
          {
            label: 'Avg PnL per Trade',
            value: formatMoney(s.avgTrade, { signed: true }),
            sub: formatPercent(s.avgTradePercent, { signed: true }),
            tone: toneOf(s.avgTrade),
          },
          { label: 'Avg Winning Trade', value: formatMoney(s.avgWinningTrade, { signed: true }), tone: 'positive' },
          { label: 'Avg Losing Trade', value: formatMoney(s.avgLosingTrade, { signed: true }), tone: 'negative' },
          { label: 'Win / Loss Ratio', value: formatNumber(s.winLossRatio, 3) },
          { label: 'Largest Winning Trade', value: formatMoney(s.largestWinningTrade, { signed: true }), tone: 'positive' },
          { label: 'Largest Losing Trade', value: formatMoney(s.largestLosingTrade, { signed: true }), tone: 'negative' },
          { label: 'Max Consecutive Wins', value: formatNumber(s.maxConsecutiveWins, 0) },
          { label: 'Max Consecutive Losses', value: formatNumber(s.maxConsecutiveLosses, 0) },
          {
            label: 'Avg Bars in Trade',
            value: formatNumber(s.avgBarsInTrade, 1),
            sub: formatDuration(s.avgHoldingMs),
          },
          { label: 'Profit Factor', value: formatNumber(s.profitFactor, 3) },
          {
            label: 'Expectancy',
            value: formatMoney(s.expectancy, { signed: true }),
            tone: toneOf(s.expectancy),
            title: '(win rate x avg win) - (loss rate x avg loss), in currency per trade.',
          },
        ]}
      />

      <StatTable
        title="Run-ups & Drawdowns"
        rows={[
          {
            label: 'Max Equity Run-up',
            value: formatMoney(s.maxRunup),
            sub: formatPercent(s.maxRunupPercent),
            tone: s.maxRunup > 0 ? 'positive' : 'neutral',
          },
          { label: 'Avg Run-up', value: formatMoney(s.avgRunup), title: 'Close-to-close phase magnitude.' },
          {
            label: 'Avg Run-up Duration',
            value: s.avgRunupDurationDays === null ? 'N/A' : `${formatNumber(s.avgRunupDurationDays, 1)} d`,
          },
          {
            label: 'Max Drawdown',
            value: formatMoney(-s.maxDrawdown),
            sub: formatPercent(s.maxDrawdownPercent),
            tone: s.maxDrawdown > 0 ? 'negative' : 'neutral',
          },
          { label: 'Avg Drawdown', value: formatMoney(s.avgDrawdown === null ? null : -s.avgDrawdown) },
          {
            label: 'Avg Drawdown Duration',
            value: s.avgDrawdownDurationDays === null ? 'N/A' : `${formatNumber(s.avgDrawdownDurationDays, 1)} d`,
          },
          {
            label: 'Longest Drawdown',
            value: s.maxDrawdownDurationBars === null ? 'N/A' : `${s.maxDrawdownDurationBars} bars`,
            sub: formatDuration(s.maxDrawdownDurationMs),
          },
          { label: 'Recovery Factor', value: formatNumber(s.recoveryFactor) },
        ]}
      />

      <StatTable
        title="Capital Efficiency & Fees"
        rows={[
          { label: 'Commission Paid', value: formatMoney(-s.totalCommission), tone: s.totalCommission > 0 ? 'negative' : 'neutral' },
          {
            label: 'Account Size Required',
            value: formatMoney(s.accountSizeRequired),
            title:
              'Smallest starting balance that could have funded the largest position at the configured margin and absorbed the losses standing at that moment.',
          },
          {
            label: 'Peak Margin Usage',
            value: formatPercent(s.peakMarginUsagePercent),
            title: 'Largest position value held, as a percent of the equity at that bar.',
          },
          {
            label: 'Margin Calls',
            value: `${s.marginCalls}`,
            tone: s.marginCalls > 0 ? 'negative' : 'neutral',
            title: 'Forced liquidations by the margin simulation. Always 0 while margin is 100%.',
          },
          { label: 'Bars Backtested', value: `${result.barCount}` },
          { label: 'Engine Time', value: `${formatNumber(result.elapsedMs, 1)} ms` },
        ]}
      />
    </div>
  );
}

export const StrategyPerformance = memo(StrategyPerformanceImpl);
