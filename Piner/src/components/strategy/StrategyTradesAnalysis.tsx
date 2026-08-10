import { memo, useMemo, useState } from 'react';
import { formatDuration, formatMoney, formatNumber, formatPercent, toneOf } from '../../lib/format';
import { periodPerformance } from '../../strategy/metrics';
import type { PeriodBucket, StrategyExecutionResult, Trade } from '../../strategy/types';
import { SectionBlock, SectionCards, SectionSplit, StatList } from './SectionParts';
import { StrategySection } from './StrategySection';
import { DonutChart, Histogram, type HistogramBin } from './SvgCharts';

type Tab = 'overview' | 'details';

const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'details' as const, label: 'Trades analysis details' },
];

const BUCKETS: { id: PeriodBucket; label: string }[] = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'year', label: 'Yearly' },
];

const BIN_COUNT = 20;

/**
 * Equal-width return bins spanning the observed range, clamped so a single freak trade cannot
 * squeeze every other bar into one column.
 */
function binTrades(trades: readonly Trade[]): HistogramBin[] {
  if (trades.length === 0) return [];
  const returns = trades.map((t) => t.returnPercent);
  const rawMin = Math.min(...returns);
  const rawMax = Math.max(...returns);
  const bound = Math.max(Math.abs(rawMin), Math.abs(rawMax), 1);
  const min = Math.min(-bound, rawMin);
  const max = Math.max(bound, rawMax);
  const width = (max - min) / BIN_COUNT;

  const bins: HistogramBin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
    from: min + width * i,
    to: min + width * (i + 1),
    count: 0,
  }));
  for (const value of returns) {
    const index = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((value - min) / width)));
    bins[index].count += 1;
  }
  return bins;
}

/** Mean of the trade returns on one side of zero (percent), or null when that side is empty. */
function meanReturn(trades: readonly Trade[], winners: boolean): number | null {
  const subset = trades.filter((t) => (winners ? t.netPnL > 0 : t.netPnL < 0));
  if (subset.length === 0) return null;
  return subset.reduce((sum, t) => sum + t.returnPercent, 0) / subset.length;
}

function StrategyTradesAnalysisImpl({ result }: { result: StrategyExecutionResult }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const [bucket, setBucket] = useState<PeriodBucket>('month');
  const s = result.summary;

  const bins = useMemo(() => binTrades(result.trades), [result.trades]);
  const averageLoss = useMemo(() => meanReturn(result.trades, false), [result.trades]);
  const averageProfit = useMemo(() => meanReturn(result.trades, true), [result.trades]);
  const periods = useMemo(() => periodPerformance(result.equityCurve, bucket), [result.equityCurve, bucket]);

  return (
    <StrategySection title="Trades analysis" tabs={TABS} active={tab} onSelect={setTab}>
      {tab === 'overview' ? (
        <>
          <SectionCards
            metrics={[
              {
                label: 'Average PnL',
                value: formatMoney(s.avgTrade, { signed: true, unit: true }),
                sub: formatPercent(s.avgTradePercent, { signed: true }),
                tone: toneOf(s.avgTrade),
              },
              { label: 'Average bars in trades', value: formatNumber(s.avgBarsInTrade, 0), sub: formatDuration(s.avgHoldingMs) },
              { label: 'Largest profit', value: formatMoney(s.largestWinningTrade, { signed: true, unit: true }), tone: 'positive' },
              { label: 'Largest loss', value: formatMoney(s.largestLosingTrade, { signed: true, unit: true }), tone: 'negative' },
            ]}
          />
          <SectionSplit>
            <SectionBlock title="Returns distribution">
              {result.trades.length === 0 ? (
                <p className="empty-note">No closed trades.</p>
              ) : (
                <Histogram bins={bins} averageLossPercent={averageLoss} averageProfitPercent={averageProfit} />
              )}
            </SectionBlock>
            <SectionBlock title="Trades distribution">
              <DonutChart
                centerValue={s.totalTrades.toLocaleString()}
                centerLabel="Total trades"
                segments={[
                  { label: 'Winners', value: s.winningTrades, color: 'var(--positive)' },
                  { label: 'Losers', value: s.losingTrades, color: 'var(--negative)' },
                  { label: 'Breakevens', value: s.evenTrades, color: 'var(--warning)' },
                ]}
              />
            </SectionBlock>
          </SectionSplit>
        </>
      ) : (
        <>
          <SectionSplit>
            <StatList
              title="Trade statistics"
              rows={[
                { label: 'Total closed trades', value: `${s.totalTrades}` },
                { label: 'Open trades', value: `${s.openTrades}` },
                { label: 'Percent profitable', value: formatPercent(s.winRate) },
                { label: 'Average winning trade', value: formatMoney(s.avgWinningTrade, { signed: true, unit: true }), tone: 'positive' },
                { label: 'Average losing trade', value: formatMoney(s.avgLosingTrade, { signed: true, unit: true }), tone: 'negative' },
                { label: 'Win / loss ratio', value: formatNumber(s.winLossRatio, 3) },
                { label: 'Max consecutive wins', value: formatNumber(s.maxConsecutiveWins, 0), tone: 'positive' },
                { label: 'Max consecutive losses', value: formatNumber(s.maxConsecutiveLosses, 0), tone: 'negative' },
                { label: 'Expectancy', value: formatMoney(s.expectancy, { signed: true, unit: true }), tone: toneOf(s.expectancy) },
              ]}
            />
            <SectionBlock title="Long vs short">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col">Long</th>
                    <th scope="col">Short</th>
                    <th scope="col">All</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Trades</th>
                    <td>{s.long.trades}</td>
                    <td>{s.short.trades}</td>
                    <td>{s.totalTrades}</td>
                  </tr>
                  <tr>
                    <th scope="row">Win rate</th>
                    <td>{formatPercent(s.long.winRate)}</td>
                    <td>{formatPercent(s.short.winRate)}</td>
                    <td>{formatPercent(s.winRate)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Net PnL</th>
                    <td className={`value value--${toneOf(s.long.netPnL)}`}>{formatMoney(s.long.netPnL, { signed: true })}</td>
                    <td className={`value value--${toneOf(s.short.netPnL)}`}>{formatMoney(s.short.netPnL, { signed: true })}</td>
                    <td className={`value value--${toneOf(s.netProfit)}`}>{formatMoney(s.netProfit, { signed: true })}</td>
                  </tr>
                  <tr>
                    <th scope="row">Avg trade</th>
                    <td className={`value value--${toneOf(s.long.avgTrade)}`}>{formatMoney(s.long.avgTrade, { signed: true })}</td>
                    <td className={`value value--${toneOf(s.short.avgTrade)}`}>{formatMoney(s.short.avgTrade, { signed: true })}</td>
                    <td className={`value value--${toneOf(s.avgTrade)}`}>{formatMoney(s.avgTrade, { signed: true })}</td>
                  </tr>
                </tbody>
              </table>
            </SectionBlock>
          </SectionSplit>

          <SectionBlock title="Periodic performance">
            <div className="segmented segmented--right" role="group" aria-label="Period">
              {BUCKETS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`segmented__btn${bucket === b.id ? ' segmented__btn--active' : ''}`}
                  onClick={() => setBucket(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {periods.length === 0 ? (
              <p className="empty-note">No equity data in this range.</p>
            ) : (
              <div className="period-grid">
                {periods.map((p) => (
                  <div
                    className="period-cell"
                    key={p.key}
                    style={{
                      background: `rgba(${p.returnPercent >= 0 ? 'var(--rgb-positive)' : 'var(--rgb-negative)'}, ${(
                        Math.min(1, Math.abs(p.returnPercent) / 10) * 0.38
                      ).toFixed(3)})`,
                    }}
                  >
                    <span className="period-cell__label">{p.label}</span>
                    <span className={`period-cell__value value--${toneOf(p.returnPercent)}`}>
                      {formatPercent(p.returnPercent, { signed: true })}
                    </span>
                    <span className="period-cell__pnl">{formatMoney(p.pnl, { signed: true })}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionBlock>
        </>
      )}
    </StrategySection>
  );
}

export const StrategyTradesAnalysis = memo(StrategyTradesAnalysisImpl);
