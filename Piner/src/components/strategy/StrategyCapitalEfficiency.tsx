import { memo, useMemo, useState } from 'react';
import { THEME } from '../../lib/chart';
import { formatMoney, formatNumber, formatPercent, toneOf } from '../../lib/format';
import type { StrategyConfig, StrategyExecutionResult } from '../../strategy/types';
import { SectionBlock, SectionCards, SectionSplit, StatList } from './SectionParts';
import { StrategyMiniChart, type MiniChartSeries } from './StrategyMiniChart';
import { StrategySection } from './StrategySection';

type Tab = 'overview' | 'capital' | 'margin';

const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'capital' as const, label: 'Capital usage' },
  { id: 'margin' as const, label: 'Margin usage' },
];

interface UsageSeries {
  capital: { time: number; value: number }[];
  margin: { time: number; value: number }[];
  peakCapital: number;
}

/**
 * Per-bar capital and margin usage.
 *
 * Capital usage is the position's full market value against equity; margin usage applies the
 * configured margin requirement to it — with margin at 100% (fully funded) the two coincide,
 * which is exactly what a cash-account backtest should show.
 */
function buildUsage(result: StrategyExecutionResult, config: StrategyConfig): UsageSeries {
  const fraction = Math.max(config.marginLong, config.marginShort) / 100;
  const capital: { time: number; value: number }[] = [];
  const margin: { time: number; value: number }[] = [];
  let peak = 0;

  for (let i = 0; i < result.positions.length && i < result.equityCurve.length; i += 1) {
    const position = result.positions[i];
    const equity = result.equityCurve[i].equity;
    const value = Math.abs(position.size) * position.currentPrice;
    const usage = equity > 0 ? (value / equity) * 100 : 0;
    if (usage > peak) peak = usage;
    capital.push({ time: position.time, value: usage });
    margin.push({ time: position.time, value: usage * fraction });
  }
  return { capital, margin, peakCapital: peak };
}

function StrategyCapitalEfficiencyImpl({
  result,
  config,
}: {
  result: StrategyExecutionResult;
  config: StrategyConfig;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const s = result.summary;
  const usage = useMemo(() => buildUsage(result, config), [result, config]);

  const marginSeries = useMemo<MiniChartSeries[]>(
    () => [
      {
        id: 'margin',
        label: 'Margin usage',
        color: THEME.accent,
        fill: 'rgba(41, 98, 255, 0.18)',
        data: usage.margin,
      },
    ],
    [usage.margin],
  );

  const capitalSeries = useMemo<MiniChartSeries[]>(
    () => [
      {
        id: 'capital',
        label: 'Capital usage',
        color: THEME.upColor,
        fill: 'rgba(8, 153, 129, 0.18)',
        data: usage.capital,
      },
    ],
    [usage.capital],
  );

  return (
    <StrategySection title="Capital efficiency" tabs={TABS} active={tab} onSelect={setTab}>
      {tab === 'overview' && (
        <>
          <SectionCards
            metrics={[
              { label: 'CAGR', value: formatPercent(s.annualizedReturnPercent, { signed: true }), tone: toneOf(s.annualizedReturnPercent) },
              {
                label: 'Account size required',
                value: formatMoney(s.accountSizeRequired, { unit: true }),
                title:
                  'Smallest starting balance that could have funded the largest position at the configured margin and absorbed the losses standing at that moment.',
              },
              {
                label: 'Return on initial capital',
                value: formatPercent(s.returnOnInitialCapitalPercent, { signed: true }),
                tone: toneOf(s.returnOnInitialCapitalPercent),
              },
              {
                label: 'Margin calls',
                value: `${s.marginCalls}`,
                tone: s.marginCalls > 0 ? 'negative' : 'neutral',
                title: 'Forced liquidations by the margin simulation. Always 0 while margin is 100%.',
              },
            ]}
          />
          <SectionBlock title="Margin usage">
            <StrategyMiniChart series={marginSeries} height={190} baseline={0} ariaLabel="Margin usage over time" />
          </SectionBlock>
        </>
      )}

      {tab === 'capital' && (
        <SectionSplit>
          <StatList
            title="Capital usage"
            rows={[
              { label: 'Initial capital', value: formatMoney(s.initialCapital, { unit: true }) },
              { label: 'Final equity', value: formatMoney(s.finalEquity, { unit: true }) },
              { label: 'Account size required', value: formatMoney(s.accountSizeRequired, { unit: true }) },
              { label: 'Peak capital usage', value: formatPercent(usage.peakCapital) },
              { label: 'Market exposure', value: formatPercent(s.exposurePercent) },
              { label: 'Return on initial capital', value: formatPercent(s.returnOnInitialCapitalPercent, { signed: true }), tone: toneOf(s.returnOnInitialCapitalPercent) },
            ]}
          />
          <SectionBlock title="Capital usage over time">
            <StrategyMiniChart series={capitalSeries} height={190} baseline={0} ariaLabel="Capital usage over time" />
          </SectionBlock>
        </SectionSplit>
      )}

      {tab === 'margin' && (
        <SectionSplit>
          <StatList
            title="Margin"
            rows={[
              { label: 'Margin long', value: formatPercent(config.marginLong, { digits: 0 }) },
              { label: 'Margin short', value: formatPercent(config.marginShort, { digits: 0 }) },
              { label: 'Peak margin usage', value: formatPercent(s.peakMarginUsagePercent) },
              { label: 'Margin calls', value: `${s.marginCalls}`, tone: s.marginCalls > 0 ? 'negative' : 'neutral' },
              { label: 'Commission paid', value: formatMoney(-s.totalCommission, { unit: true }), tone: s.totalCommission > 0 ? 'negative' : 'neutral' },
              { label: 'Engine time', value: `${formatNumber(result.elapsedMs, 1)} ms` },
            ]}
          />
          <SectionBlock title="Margin usage over time">
            <StrategyMiniChart series={marginSeries} height={190} baseline={0} ariaLabel="Margin usage over time" />
          </SectionBlock>
        </SectionSplit>
      )}
    </StrategySection>
  );
}

export const StrategyCapitalEfficiency = memo(StrategyCapitalEfficiencyImpl);
