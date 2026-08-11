import { memo, useMemo, useState } from 'react';
import { formatMoney, formatNumber, formatPercent, toneOf } from '../../lib/format';
import type { StrategyExecutionResult } from '../../strategy/types';
import { SectionBlock, SectionCards, SectionSplit, StatList } from './SectionParts';
import { StrategySection } from './StrategySection';
import { BarChart, ComparisonBars } from './SvgCharts';

type Tab = 'overview' | 'returns' | 'benchmarking' | 'risk';

const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'returns' as const, label: 'Returns' },
  { id: 'benchmarking' as const, label: 'Benchmarking' },
  { id: 'risk' as const, label: 'Risk-adjusted performance' },
];

/** Min / current / max of a percent series, for the benchmarking comparison. */
function extremes(values: readonly number[]): { min: number; max: number; current: number } {
  if (values.length === 0) return { min: 0, max: 0, current: 0 };
  let min = values[0];
  let max = values[0];
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max, current: values[values.length - 1] };
}

function StrategyReturnDetailsImpl({ result }: { result: StrategyExecutionResult }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const s = result.summary;
  const capital = s.initialCapital;

  const { strategySeries, benchmarkSeries } = useMemo(() => {
    const scale = (value: number): number => (capital > 0 ? ((value - capital) / capital) * 100 : 0);
    return {
      strategySeries: extremes(result.equityCurve.map((p) => scale(p.equity))),
      benchmarkSeries: extremes(result.equityCurve.map((p) => scale(p.benchmarkEquity))),
    };
  }, [result.equityCurve, capital]);

  const benchmarkScale = Math.max(
    Math.abs(strategySeries.max),
    Math.abs(strategySeries.min),
    Math.abs(benchmarkSeries.max),
    Math.abs(benchmarkSeries.min),
    0.0001,
  );

  return (
    <StrategySection title="Return details" tabs={TABS} active={tab} onSelect={setTab}>
      {tab === 'overview' && (
        <>
          <SectionCards
            metrics={[
              {
                label: 'Open PnL',
                value: formatMoney(s.openPnL, { unit: true }),
                sub: formatPercent(capital > 0 ? (s.openPnL / capital) * 100 : 0),
                tone: toneOf(s.openPnL),
              },
              {
                label: 'Expected payoff',
                value: formatMoney(s.avgTrade, { signed: true, unit: true }),
                tone: toneOf(s.avgTrade),
                title: 'Mean net P&L of a closed trade.',
              },
              {
                label: 'Strategy outperformance',
                value: formatMoney(
                  s.buyHoldPnL === null ? null : s.netProfit - s.buyHoldPnL,
                  { signed: true, unit: true },
                ),
                sub: formatPercent(s.outperformancePercent, { signed: true }),
                tone: toneOf(s.outperformancePercent),
              },
              { label: 'Sharpe ratio', value: formatNumber(s.sharpe, 3), tone: toneOf(s.sharpe) },
            ]}
          />
          <SectionSplit>
            <SectionBlock title="Profit structure">
              <BarChart
                items={[
                  { label: 'Total profit', value: s.grossProfit, color: 'var(--positive)' },
                  { label: 'Total loss', value: -s.grossLoss, color: 'var(--negative)' },
                  { label: 'Commission', value: -s.totalCommission, color: 'var(--warning)' },
                  { label: 'Total PnL', value: s.netProfit, color: 'var(--accent)' },
                ]}
              />
            </SectionBlock>
            <SectionBlock title="Benchmarking">
              <div className="benchmark-groups">
                <ComparisonBars
                  color="var(--warning)"
                  max={benchmarkScale}
                  rows={[
                    { label: 'Buy and hold max', value: Math.abs(benchmarkSeries.max), display: formatPercent(benchmarkSeries.max, { signed: true }) },
                    { label: 'Buy and hold current', value: Math.abs(benchmarkSeries.current), display: formatPercent(benchmarkSeries.current, { signed: true }) },
                    { label: 'Buy and hold min', value: Math.abs(benchmarkSeries.min), display: formatPercent(benchmarkSeries.min, { signed: true }) },
                  ]}
                />
                <ComparisonBars
                  color="var(--accent)"
                  max={benchmarkScale}
                  rows={[
                    { label: 'Strategy max', value: Math.abs(strategySeries.max), display: formatPercent(strategySeries.max, { signed: true }) },
                    { label: 'Strategy current', value: Math.abs(strategySeries.current), display: formatPercent(strategySeries.current, { signed: true }) },
                    { label: 'Strategy min', value: Math.abs(strategySeries.min), display: formatPercent(strategySeries.min, { signed: true }) },
                  ]}
                />
              </div>
            </SectionBlock>
          </SectionSplit>
        </>
      )}

      {tab === 'returns' && (
        <SectionSplit>
          <StatList
            title="Profit and loss"
            rows={[
              { label: 'Initial capital', value: formatMoney(s.initialCapital, { unit: true }) },
              { label: 'Final equity', value: formatMoney(s.finalEquity, { unit: true }) },
              {
                label: 'Net profit',
                value: formatMoney(s.netProfit, { signed: true, unit: true }),
                sub: formatPercent(s.netProfitPercent, { signed: true }),
                tone: toneOf(s.netProfit),
              },
              { label: 'Gross profit', value: formatMoney(s.grossProfit, { unit: true }), tone: 'positive' },
              { label: 'Gross loss', value: formatMoney(-s.grossLoss, { unit: true }), tone: 'negative' },
              { label: 'Commission paid', value: formatMoney(-s.totalCommission, { unit: true }), tone: s.totalCommission > 0 ? 'negative' : 'neutral' },
              { label: 'Open PnL', value: formatMoney(s.openPnL, { signed: true, unit: true }), tone: toneOf(s.openPnL) },
            ]}
          />
          <StatList
            title="Return rates"
            rows={[
              { label: 'Total return', value: formatPercent(s.netProfitPercent, { signed: true }), tone: toneOf(s.netProfitPercent) },
              { label: 'Return on initial capital', value: formatPercent(s.returnOnInitialCapitalPercent, { signed: true }), tone: toneOf(s.returnOnInitialCapitalPercent) },
              { label: 'CAGR', value: formatPercent(s.annualizedReturnPercent, { signed: true }), tone: toneOf(s.annualizedReturnPercent) },
              { label: 'Expected payoff', value: formatMoney(s.avgTrade, { signed: true, unit: true }), tone: toneOf(s.avgTrade) },
              { label: 'Average PnL %', value: formatPercent(s.avgTradePercent, { signed: true }), tone: toneOf(s.avgTradePercent) },
              { label: 'Market exposure', value: formatPercent(s.exposurePercent) },
            ]}
          />
        </SectionSplit>
      )}

      {tab === 'benchmarking' && (
        <SectionSplit>
          <StatList
            title="Strategy vs buy and hold"
            rows={[
              { label: 'Strategy return', value: formatPercent(s.netProfitPercent, { signed: true }), tone: toneOf(s.netProfitPercent) },
              { label: 'Buy and hold return', value: formatPercent(s.buyHoldReturnPercent, { signed: true }), tone: toneOf(s.buyHoldReturnPercent) },
              { label: 'Buy and hold PnL', value: formatMoney(s.buyHoldPnL, { signed: true, unit: true }), tone: toneOf(s.buyHoldPnL) },
              {
                label: 'Outperformance',
                value: formatMoney(s.buyHoldPnL === null ? null : s.netProfit - s.buyHoldPnL, { signed: true, unit: true }),
                sub: formatPercent(s.outperformancePercent, { signed: true }),
                tone: toneOf(s.outperformancePercent),
              },
            ]}
          />
          <SectionBlock title="Range over the backtest">
            <div className="benchmark-groups">
              <ComparisonBars
                color="var(--warning)"
                max={benchmarkScale}
                rows={[
                  { label: 'Buy and hold max', value: Math.abs(benchmarkSeries.max), display: formatPercent(benchmarkSeries.max, { signed: true }) },
                  { label: 'Buy and hold current', value: Math.abs(benchmarkSeries.current), display: formatPercent(benchmarkSeries.current, { signed: true }) },
                  { label: 'Buy and hold min', value: Math.abs(benchmarkSeries.min), display: formatPercent(benchmarkSeries.min, { signed: true }) },
                ]}
              />
              <ComparisonBars
                color="var(--accent)"
                max={benchmarkScale}
                rows={[
                  { label: 'Strategy max', value: Math.abs(strategySeries.max), display: formatPercent(strategySeries.max, { signed: true }) },
                  { label: 'Strategy current', value: Math.abs(strategySeries.current), display: formatPercent(strategySeries.current, { signed: true }) },
                  { label: 'Strategy min', value: Math.abs(strategySeries.min), display: formatPercent(strategySeries.min, { signed: true }) },
                ]}
              />
            </div>
          </SectionBlock>
        </SectionSplit>
      )}

      {tab === 'risk' && (
        <SectionSplit>
          <StatList
            title="Risk-adjusted"
            rows={[
              {
                label: 'Sharpe ratio',
                value: formatNumber(s.sharpe, 3),
                tone: toneOf(s.sharpe),
                title: 'Annualized from per-bar equity returns including flat bars, not from trade P&L.',
              },
              { label: 'Sortino ratio', value: formatNumber(s.sortino, 3), tone: toneOf(s.sortino) },
              { label: 'Calmar ratio', value: formatNumber(s.calmar, 3) },
              { label: 'Recovery factor', value: formatNumber(s.recoveryFactor, 3) },
              { label: 'Profit factor', value: formatNumber(s.profitFactor, 3) },
            ]}
          />
          <StatList
            title="Volatility and exposure"
            rows={[
              { label: 'Annualized volatility', value: formatPercent(s.volatilityPercent) },
              { label: 'Market exposure', value: formatPercent(s.exposurePercent) },
              { label: 'Max drawdown %', value: formatPercent(s.maxDrawdownPercent), tone: s.maxDrawdownPercent > 0 ? 'negative' : 'neutral' },
              { label: 'Annualization basis', value: `${formatNumber(s.periodsPerYear, 0)} bars/year` },
            ]}
          />
        </SectionSplit>
      )}
    </StrategySection>
  );
}

export const StrategyReturnDetails = memo(StrategyReturnDetailsImpl);
