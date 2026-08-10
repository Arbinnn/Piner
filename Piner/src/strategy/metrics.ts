/**
 * Performance metrics.
 *
 * Split of responsibility: piner already computes the broker-verbatim aggregates
 * (`StrategyReport`) and the risk-adjusted analytics (`computeStrategyMetrics` — Sharpe,
 * Sortino, CAGR, Calmar, exposure, streaks), so those are consumed, not reimplemented.
 * This module adds the TradingView-style trade statistics the report does not carry
 * (win rate, profit factor, expectancy, drawdown duration, long/short split, periodic
 * returns) and — importantly — turns "not computable" into `null` instead of 0/NaN/Infinity.
 *
 * Methodology notes:
 *  - Sharpe/Sortino come from PER-BAR equity returns including flat bars (piner's method),
 *    not from per-trade P&L. Dropping idle bars shrinks the sample and inflates Sharpe.
 *  - Net profit is REALIZED (closed trades, net of commission) — TradingView's definition.
 *    Final equity additionally marks the open position to market, so with a position still
 *    open `finalEquity - initialCapital` deliberately differs from `netProfit`.
 *  - Commission is already inside every trade's `netPnL`, and slippage is inside the fill
 *    prices, so both flow into gross/net profit, equity, drawdown, Sharpe and expectancy.
 */

import type { StrategyMetrics, StrategyReport } from '@heyphat/piner';
import type {
  DirectionStats,
  EquityPhase,
  EquityPoint,
  PhaseStats,
  OpenPosition,
  PeriodBucket,
  PeriodPerformance,
  PositionSnapshot,
  StrategyConfig,
  StrategySummary,
  Trade,
} from './types';

/** `null` unless the number is a usable finite value. */
function finite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Division that reports "undefined" honestly instead of returning NaN/Infinity. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : finite(numerator / denominator);
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function directionStats(trades: readonly Trade[], direction: 'long' | 'short'): DirectionStats {
  const subset = trades.filter((t) => t.direction === direction);
  const wins = subset.filter((t) => t.netPnL > 0).length;
  const netPnL = subset.reduce((sum, t) => sum + t.netPnL, 0);
  return {
    trades: subset.length,
    winRate: subset.length === 0 ? null : (wins / subset.length) * 100,
    netPnL,
    avgTrade: ratio(netPnL, subset.length),
  };
}

/**
 * Longest peak-to-recovery stretch of the equity curve (bars and wall-clock).
 *
 * A drawdown that never recovers still counts — its duration runs to the last bar, which is
 * the honest answer for a strategy that ended underwater.
 */
function maxDrawdownDuration(curve: readonly EquityPoint[]): { bars: number | null; ms: number | null } {
  if (curve.length === 0) return { bars: null, ms: null };

  let peakEquity = curve[0].equity;
  let peakIndex = 0;
  let bars = 0;
  let ms = 0;

  for (let i = 1; i < curve.length; i += 1) {
    const point = curve[i];
    if (point.equity >= peakEquity) {
      peakEquity = point.equity;
      peakIndex = i;
      continue;
    }
    const spanBars = i - peakIndex;
    if (spanBars > bars) {
      bars = spanBars;
      ms = (point.time - curve[peakIndex].time) * 1000;
    }
  }
  return bars === 0 ? { bars: 0, ms: 0 } : { bars, ms };
}

/**
 * Capital the run actually demanded, and the heaviest margin usage along the way.
 *
 * `accountSizeRequired` is the smallest starting balance that could have both funded the
 * largest position (at the configured margin) and absorbed the losses standing at that moment —
 * evaluated bar by bar, so it reflects the worst combination rather than two separate maxima.
 */
function capitalRequirements(
  positions: readonly PositionSnapshot[],
  equityCurve: readonly EquityPoint[],
  initialCapital: number,
  marginFraction: number,
): { accountSizeRequired: number; peakMarginUsagePercent: number | null } {
  let required = 0;
  let usage: number | null = null;

  for (let i = 0; i < positions.length && i < equityCurve.length; i += 1) {
    const position = positions[i];
    if (position.size === 0) continue;
    const committed = Math.abs(position.size) * position.currentPrice * marginFraction;
    const shortfall = Math.max(0, initialCapital - equityCurve[i].equity);
    required = Math.max(required, committed + shortfall);

    const equity = equityCurve[i].equity;
    if (equity > 0) usage = Math.max(usage ?? 0, (committed / equity) * 100);
  }
  return { accountSizeRequired: required, peakMarginUsagePercent: usage };
}

const MS_PER_DAY = 86_400_000;

/**
 * Splits the bar-close equity curve into alternating run-up and drawdown stretches.
 *
 * Peaks are the running-maximum points a decline starts from; troughs are the minima inside
 * those declines. A drawdown runs peak → recovery of that peak; the run-up that follows runs
 * trough → the next peak. The trailing stretch is emitted with `open: true` (it is what the
 * "current" run-up/drawdown readout shows) and excluded from the averages, matching piner's
 * close-to-close analytics.
 */
export function equityPhases(curve: readonly EquityPoint[]): EquityPhase[] {
  if (curve.length < 2) return [];

  const phases: EquityPhase[] = [];
  /**
   * `extreme` is where the magnitude is measured to (the trough of a decline, the peak of a
   * climb); `to` is where the phase ENDS. They differ for a drawdown, whose depth is reached
   * at the trough but whose duration runs on until the prior peak is recovered — which is the
   * duration TradingView (and piner) report.
   */
  const push = (kind: EquityPhase['kind'], from: number, extreme: number, to: number, open: boolean): void => {
    if (extreme <= from) return;
    const start = curve[from];
    const magnitude = Math.abs(curve[extreme].equity - start.equity);
    if (magnitude === 0) return;
    const end = curve[to];
    phases.push({
      kind,
      startTime: start.time,
      endTime: end.time,
      startBarIndex: from,
      endBarIndex: to,
      magnitude,
      percent: start.equity !== 0 ? (magnitude / Math.abs(start.equity)) * 100 : 0,
      durationDays: ((end.time - start.time) * 1000) / MS_PER_DAY,
      open,
    });
  };

  let peakIndex = 0;
  let troughIndex = 0;
  let inDrawdown = false;

  for (let i = 1; i < curve.length; i += 1) {
    const equity = curve[i].equity;

    if (!inDrawdown) {
      if (equity >= curve[peakIndex].equity) {
        peakIndex = i;
      } else {
        // A decline opens: the climb that ended at this peak is a completed run-up.
        push('runup', troughIndex, peakIndex, peakIndex, false);
        inDrawdown = true;
        troughIndex = i;
      }
      continue;
    }

    if (equity < curve[troughIndex].equity) troughIndex = i;
    if (equity >= curve[peakIndex].equity) {
      // Recovered: the decline is a completed drawdown, and a new climb is under way.
      push('drawdown', peakIndex, troughIndex, i, false);
      inDrawdown = false;
      peakIndex = i;
    }
  }

  // Whatever is still running when the data ends.
  const last = curve.length - 1;
  if (inDrawdown) push('drawdown', peakIndex, troughIndex, last, true);
  else push('runup', troughIndex, last, last, true);

  return phases;
}

function phaseStats(phases: readonly EquityPhase[], kind: EquityPhase['kind']): PhaseStats {
  const all = phases.filter((p) => p.kind === kind);
  const closed = all.filter((p) => !p.open);
  const open = all.find((p) => p.open);

  return {
    max: all.length === 0 ? 0 : Math.max(...all.map((p) => p.magnitude)),
    average: mean(closed.map((p) => p.magnitude)),
    current: open?.magnitude ?? 0,
    maxPercent: all.length === 0 ? 0 : Math.max(...all.map((p) => p.percent)),
    averagePercent: mean(closed.map((p) => p.percent)),
    currentPercent: open?.percent ?? 0,
    averageDurationDays: mean(closed.map((p) => p.durationDays)),
    count: all.length,
  };
}

export function computeSummary(
  report: StrategyReport,
  pinerMetrics: StrategyMetrics,
  trades: readonly Trade[],
  equityCurve: readonly EquityPoint[],
  positions: readonly PositionSnapshot[],
  openPosition: OpenPosition | null,
  config: StrategyConfig,
): StrategySummary {
  const initialCapital = report.initialCapital;
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital;
  const closed = trades.length;

  const winners = trades.filter((t) => t.netPnL > 0);
  const losers = trades.filter((t) => t.netPnL < 0);
  const avgWin = mean(winners.map((t) => t.netPnL));
  // Magnitude, so expectancy below reads as "(win rate x avg win) - (loss rate x avg loss)".
  const avgLoss = mean(losers.map((t) => -t.netPnL));
  const winRate = closed === 0 ? null : (report.wins / closed) * 100;

  const expectancy =
    winRate === null || avgWin === null || avgLoss === null
      ? closed === 0
        ? null
        : ratio(report.netProfit, closed)
      : (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;

  const profitFactor =
    report.grossLoss > 0 ? report.grossProfit / report.grossLoss : report.grossProfit > 0 ? Infinity : null;

  const duration = maxDrawdownDuration(equityCurve);
  const spanMs =
    equityCurve.length > 1 ? (equityCurve[equityCurve.length - 1].time - equityCurve[0].time) * 1000 : 0;
  const DAY_MS = 86_400_000;

  const netProfitPercent = initialCapital > 0 ? (report.netProfit / initialCapital) * 100 : 0;
  const buyHold = finite(pinerMetrics.buyHoldReturnPercent);
  // Short positions post margin too; take the heavier of the two requirements.
  const marginFraction = Math.max(config.marginLong, config.marginShort) / 100;
  const capital = capitalRequirements(positions, equityCurve, initialCapital, marginFraction);
  const phases = equityPhases(equityCurve);
  const runups = phaseStats(phases, 'runup');
  const drawdowns = phaseStats(phases, 'drawdown');

  return {
    initialCapital,
    finalEquity,
    netProfit: report.netProfit,
    netProfitPercent,
    grossProfit: report.grossProfit,
    grossLoss: report.grossLoss,
    totalCommission: report.totalCommission,
    annualizedReturnPercent: spanMs >= DAY_MS ? finite(pinerMetrics.cagrPercent) : null,
    buyHoldReturnPercent: buyHold,
    buyHoldPnL: finite(pinerMetrics.buyHoldPnL),
    outperformancePercent: buyHold === null ? null : netProfitPercent - buyHold,
    openPnL: openPosition?.unrealizedPnL ?? 0,

    totalTrades: closed,
    openTrades: openPosition?.trades.length ?? 0,
    winningTrades: report.wins,
    losingTrades: report.losses,
    evenTrades: report.evens,
    winRate,
    avgTrade: ratio(report.netProfit, closed),
    avgTradePercent: mean(trades.map((t) => t.returnPercent)),
    avgWinningTrade: avgWin,
    avgLosingTrade: avgLoss === null ? null : -avgLoss,
    winLossRatio: avgWin === null || avgLoss === null || avgLoss === 0 ? null : avgWin / avgLoss,
    largestWinningTrade: winners.length === 0 ? null : Math.max(...winners.map((t) => t.netPnL)),
    largestLosingTrade: losers.length === 0 ? null : Math.min(...losers.map((t) => t.netPnL)),
    maxConsecutiveWins: closed === 0 ? null : pinerMetrics.maxConsecutiveWins,
    maxConsecutiveLosses: closed === 0 ? null : pinerMetrics.maxConsecutiveLosses,

    maxDrawdown: report.maxDrawdown,
    maxDrawdownPercent: report.maxDrawdownPercent,
    maxDrawdownDurationBars: duration.bars,
    maxDrawdownDurationMs: duration.ms,
    maxRunup: report.maxRunup,
    maxRunupPercent: report.maxRunupPercent,
    avgRunup: equityCurve.length < 2 ? null : finite(pinerMetrics.avgRunupCloseToClose),
    avgDrawdown: equityCurve.length < 2 ? null : finite(pinerMetrics.avgDrawdownCloseToClose),
    avgRunupDurationDays: equityCurve.length < 2 ? null : finite(pinerMetrics.avgRunupDurationDays),
    avgDrawdownDurationDays: equityCurve.length < 2 ? null : finite(pinerMetrics.avgDrawdownDurationDays),
    maxDrawdownPercentOfInitialCapital: finite(pinerMetrics.maxDrawdownPercentOfInitialCapital) ?? 0,
    maxRunupPercentOfInitialCapital: finite(pinerMetrics.maxRunupPercentOfInitialCapital) ?? 0,
    returnOnInitialCapitalPercent: finite(pinerMetrics.returnOnInitialCapitalPercent) ?? 0,
    returnOfMaxDrawdown: report.maxDrawdown > 0 ? report.netProfit / report.maxDrawdown : null,
    runupPhases: runups,
    drawdownPhases: drawdowns,
    // Sharpe/Sortino need at least a couple of equity observations to mean anything.
    sharpe: equityCurve.length < 2 || closed === 0 ? null : finite(pinerMetrics.sharpe),
    sortino: equityCurve.length < 2 || closed === 0 ? null : pinerMetrics.sortino,
    volatilityPercent: equityCurve.length < 2 ? null : finite(pinerMetrics.volatilityPercent),
    profitFactor,
    recoveryFactor: report.maxDrawdown > 0 ? report.netProfit / report.maxDrawdown : null,
    expectancy,
    calmar: report.maxDrawdownPercent > 0 ? finite(pinerMetrics.calmar) : null,
    exposurePercent: report.barsProcessed === 0 ? null : finite(pinerMetrics.exposurePercent),

    accountSizeRequired: capital.accountSizeRequired,
    marginCalls: report.marginCalls,
    peakMarginUsagePercent: capital.peakMarginUsagePercent,

    avgHoldingMs: mean(trades.map((t) => t.durationMs)),
    avgBarsInTrade: closed === 0 ? null : finite(pinerMetrics.avgBarsInTrade),
    long: directionStats(trades, 'long'),
    short: directionStats(trades, 'short'),

    periodsPerYear: pinerMetrics.periodsPerYear,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bucket key + display label for a bar time (epoch seconds), in UTC — the CSV's own clock. */
function bucketOf(timeSeconds: number, bucket: PeriodBucket): { key: string; label: string } {
  const d = new Date(timeSeconds * 1000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  switch (bucket) {
    case 'year':
      return { key: `${year}`, label: `${year}` };
    case 'month':
      return { key: `${year}-${String(month + 1).padStart(2, '0')}`, label: `${year} ${MONTHS[month]}` };
    case 'week': {
      // ISO-ish: bucket by the Monday that starts the week.
      const monday = new Date(Date.UTC(year, month, day));
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      const iso = monday.toISOString().slice(0, 10);
      return { key: iso, label: `Week of ${iso}` };
    }
    default: {
      const iso = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
      return { key: iso, label: iso };
    }
  }
}

/**
 * Period returns from the equity curve: each bucket's return is measured from the equity at
 * the END of the previous bucket, so the buckets chain into the total return.
 */
export function periodPerformance(curve: readonly EquityPoint[], bucket: PeriodBucket): PeriodPerformance[] {
  if (curve.length === 0) return [];

  const out: PeriodPerformance[] = [];
  let previousClose = curve[0].equity;
  let current: PeriodPerformance | null = null;
  let currentKey = '';

  for (const point of curve) {
    const { key, label } = bucketOf(point.time, bucket);
    if (key !== currentKey) {
      if (current) {
        previousClose = current.endEquity;
        out.push(current);
      }
      currentKey = key;
      current = {
        key,
        label,
        startEquity: previousClose,
        endEquity: point.equity,
        pnl: point.equity - previousClose,
        returnPercent: previousClose !== 0 ? ((point.equity - previousClose) / previousClose) * 100 : 0,
      };
      continue;
    }
    current!.endEquity = point.equity;
    current!.pnl = point.equity - current!.startEquity;
    current!.returnPercent =
      current!.startEquity !== 0 ? (current!.pnl / current!.startEquity) * 100 : 0;
  }
  if (current) out.push(current);
  return out;
}
