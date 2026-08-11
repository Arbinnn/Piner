import { memo, useMemo, useState } from 'react';
import { THEME } from '../../lib/chart';
import { formatMoney, formatPercent, toneOf } from '../../lib/format';
import type { StrategyExecutionResult } from '../../strategy/types';
import { ChevronDownIcon } from './Icons';
import { StrategyMiniChart, type MiniChartSeries } from './StrategyMiniChart';

interface StrategyCurvesProps {
  result: StrategyExecutionResult;
}

type Mode = 'currency' | 'percent';

/** The four curves the performance chart can show, each independently hideable. */
type SeriesKey = 'pnl' | 'buyHold' | 'excursions' | 'phases';

const SERIES: { key: SeriesKey; label: string }[] = [
  { key: 'pnl', label: 'Cumulative PnL' },
  { key: 'buyHold', label: 'Buy and hold' },
  { key: 'excursions', label: 'Trades excursions' },
  { key: 'phases', label: 'Run-ups and drawdowns' },
];

function StrategyCurvesImpl({ result }: StrategyCurvesProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('currency');
  const [hiddenPanel, setHiddenPanel] = useState(false);
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    pnl: true,
    buyHold: true,
    excursions: false,
    phases: true,
  });

  const s = result.summary;
  const capital = s.initialCapital;

  const series = useMemo<MiniChartSeries[]>(() => {
    const scale = (value: number): number => (mode === 'currency' ? value : capital > 0 ? (value / capital) * 100 : 0);
    const out: MiniChartSeries[] = [];

    if (visible.pnl) {
      out.push({
        id: 'pnl',
        label: 'Cumulative PnL',
        color: s.netProfit >= 0 ? THEME.upColor : THEME.downColor,
        fill: `rgba(${s.netProfit >= 0 ? '8, 153, 129' : '242, 54, 69'}, 0.18)`,
        data: result.equityCurve.map((p) => ({ time: p.time, value: scale(p.equity - capital) })),
      });
    }
    if (visible.buyHold) {
      out.push({
        id: 'buyHold',
        label: 'Buy and hold',
        color: THEME.benchmark,
        dashed: true,
        data: result.equityCurve.map((p) => ({ time: p.time, value: scale(p.benchmarkEquity - capital) })),
      });
    }
    if (visible.excursions) {
      // Per-trade MFE / MAE plotted at the bar the trade closed on: how far each trade ran in
      // favour and against before it was booked. Zero on every bar without a closed trade, so
      // the two series read as spikes rather than a misleading interpolation.
      const runup = new Map<number, number>();
      const drawdown = new Map<number, number>();
      for (const trade of result.trades) {
        runup.set(trade.exitTime, (runup.get(trade.exitTime) ?? 0) + trade.maxRunup);
        drawdown.set(trade.exitTime, (drawdown.get(trade.exitTime) ?? 0) - trade.maxDrawdown);
      }
      out.push({
        id: 'excursion-up',
        label: 'Trade run-up (MFE)',
        color: THEME.upColor,
        data: result.equityCurve.map((p) => ({ time: p.time, value: scale(runup.get(p.time) ?? 0) })),
      });
      out.push({
        id: 'excursion-down',
        label: 'Trade drawdown (MAE)',
        color: THEME.downColor,
        data: result.equityCurve.map((p) => ({ time: p.time, value: scale(drawdown.get(p.time) ?? 0) })),
      });
    }
    if (visible.phases) {
      out.push({
        id: 'runup',
        label: 'Run-up',
        color: THEME.upColor,
        fill: 'rgba(8, 153, 129, 0.14)',
        data: result.equityCurve.map((p) => ({ time: p.time, value: mode === 'currency' ? p.runup : p.runupPercent })),
      });
      out.push({
        id: 'drawdown',
        label: 'Drawdown',
        color: THEME.downColor,
        fill: 'rgba(242, 54, 69, 0.14)',
        data: result.equityCurve.map((p) => ({
          time: p.time,
          value: mode === 'currency' ? -p.drawdown : -p.drawdownPercent,
        })),
      });
    }
    return out;
  }, [result.equityCurve, result.trades, capital, mode, s.netProfit, visible]);

  return (
    <section className={`performance-chart${hiddenPanel ? ' performance-chart--hidden' : ''}`}>
      <div className="performance-chart__header">
        <h3>Performance</h3>
        <div className="performance-chart__toggles">
          {SERIES.map((entry) => (
            <label className="toggle-chip" key={entry.key}>
              <input
                type="checkbox"
                checked={visible[entry.key]}
                onChange={() => setVisible((prev) => ({ ...prev, [entry.key]: !prev[entry.key] }))}
              />
              <span>{entry.label}</span>
            </label>
          ))}
        </div>
        <div className="performance-chart__actions">
          <div className="segmented" role="group" aria-label="Units">
            <button
              type="button"
              className={`segmented__btn${mode === 'currency' ? ' segmented__btn--active' : ''}`}
              onClick={() => setMode('currency')}
            >
              NPR
            </button>
            <button
              type="button"
              className={`segmented__btn${mode === 'percent' ? ' segmented__btn--active' : ''}`}
              onClick={() => setMode('percent')}
            >
              %
            </button>
          </div>
          <button
            type="button"
            className={`icon-btn icon-btn--chevron${hiddenPanel ? ' icon-btn--flipped' : ''}`}
            onClick={() => setHiddenPanel((prev) => !prev)}
            aria-expanded={!hiddenPanel}
            title={hiddenPanel ? 'Show chart' : 'Hide chart'}
            aria-label={hiddenPanel ? 'Show chart' : 'Hide chart'}
          >
            <ChevronDownIcon />
          </button>
        </div>
      </div>

      {!hiddenPanel && (
        <>
          {series.length === 0 ? (
            <p className="empty-note">Every curve is hidden — tick one above.</p>
          ) : (
            <StrategyMiniChart series={series} height={250} baseline={0} ariaLabel="Strategy performance curves" />
          )}
          <div className="strategy-curves__footnote">
            <span>
              Strategy{' '}
              <b className={`value value--${toneOf(s.netProfit)}`}>
                {mode === 'currency'
                  ? formatMoney(s.netProfit, { signed: true, unit: true })
                  : formatPercent(s.netProfitPercent, { signed: true })}
              </b>
            </span>
            <span>
              Buy and hold{' '}
              <b className={`value value--${toneOf(s.buyHoldPnL)}`}>
                {mode === 'currency'
                  ? formatMoney(s.buyHoldPnL, { signed: true, unit: true })
                  : formatPercent(s.buyHoldReturnPercent, { signed: true })}
              </b>
            </span>
            <span>
              Max run-up <b className="value value--positive">{formatPercent(s.maxRunupPercent)}</b>
            </span>
            <span>
              Max drawdown <b className="value value--negative">{formatPercent(s.maxDrawdownPercent)}</b>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export const StrategyCurves = memo(StrategyCurvesImpl);
