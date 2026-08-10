import { memo, useMemo, useState } from 'react';
import { formatMoney, formatNumber, formatPercent, toneOf } from '../../lib/format';
import type { EquityPhase, PhaseStats, StrategyExecutionResult } from '../../strategy/types';
import { SectionBlock, SectionCards, SectionSplit, StatList } from './SectionParts';
import { StrategySection } from './StrategySection';
import { ComparisonBars, PhaseBars, type PhaseBar } from './SvgCharts';

type Tab = 'overview' | 'runups' | 'drawdowns';

const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'runups' as const, label: 'Run-ups' },
  { id: 'drawdowns' as const, label: 'Drawdowns' },
];

/** Keep the bar chart readable on a long backtest: show the most recent stretches. */
const MAX_BARS = 60;

function toBars(phases: readonly EquityPhase[]): PhaseBar[] {
  return phases.slice(-MAX_BARS).map((phase) => ({
    kind: phase.kind,
    percent: phase.percent,
    open: phase.open,
    label: `${phase.kind === 'runup' ? 'Run-up' : 'Drawdown'} ${formatPercent(phase.percent)} · ${formatMoney(
      phase.magnitude,
    )} · ${formatNumber(phase.durationDays, 0)} d`,
  }));
}

function phaseRows(stats: PhaseStats, percent: boolean): { label: string; value: number; display: string }[] {
  return [
    {
      label: 'Maximum',
      value: percent ? stats.maxPercent : stats.max,
      display: percent ? formatPercent(stats.maxPercent) : formatMoney(stats.max),
    },
    {
      label: 'Average',
      value: percent ? stats.averagePercent ?? 0 : stats.average ?? 0,
      display: percent ? formatPercent(stats.averagePercent) : formatMoney(stats.average),
    },
    {
      label: 'Current',
      value: percent ? stats.currentPercent : stats.current,
      display: percent ? formatPercent(stats.currentPercent) : formatMoney(stats.current),
    },
  ];
}

function StrategyRunupsDrawdownsImpl({ result }: { result: StrategyExecutionResult }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const s = result.summary;
  const bars = useMemo(() => toBars(result.phases), [result.phases]);

  const scale = Math.max(
    s.runupPhases.maxPercent,
    s.drawdownPhases.maxPercent,
    0.0001,
  );

  return (
    <StrategySection title="Equity run-ups and drawdowns" tabs={TABS} active={tab} onSelect={setTab}>
      {tab === 'overview' && (
        <>
          <SectionCards
            metrics={[
              {
                label: 'Average run-up duration',
                value: s.runupPhases.averageDurationDays === null ? 'N/A' : `${formatNumber(s.runupPhases.averageDurationDays, 0)} days`,
              },
              {
                label: 'Average drawdown duration',
                value:
                  s.drawdownPhases.averageDurationDays === null
                    ? 'N/A'
                    : `${formatNumber(s.drawdownPhases.averageDurationDays, 0)} days`,
              },
              {
                label: 'Max drawdown as % of initial capital',
                value: formatPercent(s.maxDrawdownPercentOfInitialCapital),
                tone: s.maxDrawdownPercentOfInitialCapital > 0 ? 'negative' : 'neutral',
              },
              {
                label: 'Return of max drawdown',
                value: formatNumber(s.returnOfMaxDrawdown, 3),
                tone: toneOf(s.returnOfMaxDrawdown),
                title: 'Net profit divided by the maximum drawdown.',
              },
            ]}
          />
          <SectionSplit>
            <SectionBlock title="Alternating growth and decline">
              {bars.length === 0 ? (
                <p className="empty-note">Equity never moved.</p>
              ) : (
                <PhaseBars phases={bars} />
              )}
            </SectionBlock>
            <SectionBlock title="Comparison of growth and decline periods">
              <div className="benchmark-groups">
                <div>
                  <h6>Run-up</h6>
                  <ComparisonBars color="var(--positive)" max={scale} rows={phaseRows(s.runupPhases, true)} />
                </div>
                <div>
                  <h6>Drawdown</h6>
                  <ComparisonBars color="var(--negative)" max={scale} rows={phaseRows(s.drawdownPhases, true)} />
                </div>
              </div>
            </SectionBlock>
          </SectionSplit>
        </>
      )}

      {tab === 'runups' && (
        <SectionSplit>
          <StatList
            title="Run-ups"
            rows={[
              { label: 'Max equity run-up', value: formatMoney(s.maxRunup, { unit: true }), sub: formatPercent(s.maxRunupPercent), tone: 'positive' },
              { label: 'Max run-up as % of initial capital', value: formatPercent(s.maxRunupPercentOfInitialCapital), tone: 'positive' },
              { label: 'Largest run-up phase', value: formatMoney(s.runupPhases.max, { unit: true }), sub: formatPercent(s.runupPhases.maxPercent) },
              { label: 'Average run-up', value: formatMoney(s.runupPhases.average, { unit: true }), sub: formatPercent(s.runupPhases.averagePercent) },
              {
                label: 'Average duration',
                value: s.runupPhases.averageDurationDays === null ? 'N/A' : `${formatNumber(s.runupPhases.averageDurationDays, 1)} days`,
              },
              { label: 'Current run-up', value: formatMoney(s.runupPhases.current, { unit: true }), sub: formatPercent(s.runupPhases.currentPercent) },
              { label: 'Run-up phases', value: `${s.runupPhases.count}` },
            ]}
          />
          <SectionBlock title="Run-up phases">
            <ComparisonBars color="var(--positive)" max={scale} rows={phaseRows(s.runupPhases, true)} />
          </SectionBlock>
        </SectionSplit>
      )}

      {tab === 'drawdowns' && (
        <SectionSplit>
          <StatList
            title="Drawdowns"
            rows={[
              { label: 'Max drawdown', value: formatMoney(-s.maxDrawdown, { unit: true }), sub: formatPercent(s.maxDrawdownPercent), tone: 'negative' },
              { label: 'Max drawdown as % of initial capital', value: formatPercent(s.maxDrawdownPercentOfInitialCapital), tone: 'negative' },
              { label: 'Largest drawdown phase', value: formatMoney(s.drawdownPhases.max, { unit: true }), sub: formatPercent(s.drawdownPhases.maxPercent) },
              { label: 'Average drawdown', value: formatMoney(s.drawdownPhases.average, { unit: true }), sub: formatPercent(s.drawdownPhases.averagePercent) },
              {
                label: 'Average duration',
                value: s.drawdownPhases.averageDurationDays === null ? 'N/A' : `${formatNumber(s.drawdownPhases.averageDurationDays, 1)} days`,
              },
              {
                label: 'Longest drawdown',
                value: s.maxDrawdownDurationBars === null ? 'N/A' : `${s.maxDrawdownDurationBars} bars`,
              },
              { label: 'Current drawdown', value: formatMoney(s.drawdownPhases.current, { unit: true }), sub: formatPercent(s.drawdownPhases.currentPercent) },
              { label: 'Recovery factor', value: formatNumber(s.recoveryFactor, 3) },
            ]}
          />
          <SectionBlock title="Drawdown phases">
            <ComparisonBars color="var(--negative)" max={scale} rows={phaseRows(s.drawdownPhases, true)} />
          </SectionBlock>
        </SectionSplit>
      )}
    </StrategySection>
  );
}

export const StrategyRunupsDrawdowns = memo(StrategyRunupsDrawdownsImpl);
