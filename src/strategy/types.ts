/**
 * Normalized strategy/backtest model.
 *
 * Everything here is DERIVED from piner's broker-verbatim `StrategyReport` (see
 * `strategyAdapter.ts`) — the backtest itself (orders, fills, position, cash, equity,
 * commission, slippage) is executed by piner's `StrategyBroker`, never re-simulated here.
 */

import type { StrategyMetrics, StrategyReport } from '@heyphat/piner';

export type PineScriptType = 'indicator' | 'strategy' | 'unknown';

export type TradeDirection = 'long' | 'short';

/** piner `StrategySettings.qtyType`. */
export type QtyType = 'fixed' | 'cash' | 'percent_of_equity';

/** piner `StrategySettings.commissionType`. */
export type CommissionType = 'percent' | 'cash_per_contract' | 'cash_per_order';

/** Backtest configuration the user edits; a superset of the piner settings we override. */
export interface StrategyConfig {
  initialCapital: number;
  qtyType: QtyType;
  qtyValue: number;
  commissionType: CommissionType;
  commissionValue: number;
  /** Slippage in ticks. piner applies it to the FILL PRICE, so it is never a separate line item. */
  slippage: number;
  /** Instrument tick size — the unit `slippage` is denominated in. */
  mintick: number;
  /** Max simultaneous entries in the same direction (Pine `pyramiding`; 1 = one entry). */
  pyramiding: number;
  processOrdersOnClose: boolean;
  /** Margin requirement, percent of position value. 100 = fully funded, no leverage. */
  marginLong: number;
  marginShort: number;
  /** Inclusive backtest window, epoch SECONDS (chart-native). `null` = dataset bound. */
  from: number | null;
  to: number | null;
}

/**
 * One closed trade — exactly one row of piner's FIFO lot ledger (TradingView's shape).
 *
 * `commission` is both sides' fee and is ALREADY deducted from `netPnL`; `grossPnL` adds it
 * back. Slippage has no per-trade field because piner bakes it into `entryPrice`/`exitPrice`.
 */
export interface Trade {
  id: string;
  /** 1-based display number. */
  index: number;
  /** The Pine `strategy.entry` id that opened the lot. */
  entryId: string;
  direction: TradeDirection;
  /** Epoch SECONDS (chart-native, matching `Candle.time`). */
  entryTime: number;
  exitTime: number;
  entryBarIndex: number;
  exitBarIndex: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnL: number;
  commission: number;
  netPnL: number;
  returnPercent: number;
  /** Running net P&L through this trade (piner's `cumProfit`). */
  cumulativePnL: number;
  durationMs: number;
  /** Trade-life intrabar extremes in currency (piner's MFE / MAE). */
  maxRunup: number;
  maxDrawdown: number;
}

/** A still-open entry lot at the end of the run. Never counted as a closed trade. */
export interface OpenTrade {
  entryId: string;
  direction: TradeDirection;
  entryTime: number;
  entryBarIndex: number;
  entryPrice: number;
  quantity: number;
  unrealizedPnL: number;
  returnPercent: number;
}

export interface OpenPosition {
  direction: TradeDirection;
  size: number;
  averageEntryPrice: number;
  unrealizedPnL: number;
  trades: OpenTrade[];
}

/** Per-bar account state. `equity` is piner's; the split is derived from the trade ledger. */
export interface EquityPoint {
  /** Epoch SECONDS. */
  time: number;
  equity: number;
  /** Initial capital + realized P&L (what is not tied up in an open position's P&L). */
  cash: number;
  realizedPnL: number;
  unrealizedPnL: number;
  /** Peak-to-current decline, currency (>= 0) and percent of the peak (>= 0). */
  drawdown: number;
  drawdownPercent: number;
  /** Trough-to-current climb — the mirror of drawdown, using piner's own running-extreme
   *  definition (peak = running max, valley = running min, neither reset). */
  runup: number;
  runupPercent: number;
  /** Buy-&-hold equity over the same bars and capital, for the benchmark line. */
  benchmarkEquity: number;
}

/** Per-bar position state, derived from the lot ledger. */
export interface PositionSnapshot {
  time: number;
  barIndex: number;
  /** Signed: > 0 long, < 0 short, 0 flat. */
  size: number;
  direction: TradeDirection | 'flat';
  averageEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
}

/**
 * One alternating growth/decline stretch of the bar-close equity curve.
 *
 * Definition matches piner's own close-to-close analytics so the section's numbers and the
 * Performance Summary can never disagree: a DRAWDOWN spans a peak → its recovery to that peak
 * (an unrecovered trailing decline is excluded from the averages but kept as `open: true` for
 * the "current" readout); a RUN-UP spans a trough → the last new peak it produced.
 */
export interface EquityPhase {
  kind: 'runup' | 'drawdown';
  startTime: number;
  endTime: number;
  startBarIndex: number;
  endBarIndex: number;
  /** Magnitude in currency, always >= 0. */
  magnitude: number;
  /** Magnitude as a percent of the phase's starting equity. */
  percent: number;
  durationDays: number;
  /** True for a trailing phase that has not completed (no recovery / no new peak yet). */
  open: boolean;
}

export interface PhaseStats {
  max: number;
  average: number | null;
  current: number;
  maxPercent: number;
  averagePercent: number | null;
  currentPercent: number;
  averageDurationDays: number | null;
  count: number;
}

export interface DirectionStats {
  trades: number;
  winRate: number | null;
  netPnL: number;
  avgTrade: number | null;
}

/** Bucketed performance (day/week/month/year) from the equity curve. */
export type PeriodBucket = 'day' | 'week' | 'month' | 'year';

export interface PeriodPerformance {
  /** Sortable key, e.g. `2026-04`. */
  key: string;
  label: string;
  startEquity: number;
  endEquity: number;
  pnl: number;
  returnPercent: number;
}

/**
 * The dashboard's metric set. `null` means "not computable from this run" and MUST render as
 * `N/A` — never 0, never NaN.
 */
export interface StrategySummary {
  // Returns
  initialCapital: number;
  finalEquity: number;
  netProfit: number;
  netProfitPercent: number;
  grossProfit: number;
  grossLoss: number;
  totalCommission: number;
  /** CAGR from real bar times (piner). `null` when the span is under a day. */
  annualizedReturnPercent: number | null;
  buyHoldReturnPercent: number | null;
  buyHoldPnL: number | null;
  /** Net profit % minus buy-&-hold % over the same bars. */
  outperformancePercent: number | null;
  /** Mark-to-market P&L of the position still open on the last bar (0 when flat). */
  openPnL: number;

  // Trades
  totalTrades: number;
  openTrades: number;
  winningTrades: number;
  losingTrades: number;
  evenTrades: number;
  winRate: number | null;
  avgTrade: number | null;
  /** Mean per-trade return on the capital each trade committed. */
  avgTradePercent: number | null;
  avgWinningTrade: number | null;
  avgLosingTrade: number | null;
  /** Mean win divided by mean loss magnitude. */
  winLossRatio: number | null;
  largestWinningTrade: number | null;
  largestLosingTrade: number | null;
  maxConsecutiveWins: number | null;
  maxConsecutiveLosses: number | null;

  // Risk
  maxDrawdown: number;
  maxDrawdownPercent: number;
  /** Longest peak-to-recovery stretch of the bar-close equity curve. */
  maxDrawdownDurationBars: number | null;
  maxDrawdownDurationMs: number | null;
  /** Intrabar-path run-up extremes (piner's broker), mirroring max drawdown. */
  maxRunup: number;
  maxRunupPercent: number;
  /** Mean close-to-close phase magnitude and length (piner's derived analytics). */
  avgRunup: number | null;
  avgDrawdown: number | null;
  avgRunupDurationDays: number | null;
  avgDrawdownDurationDays: number | null;
  /** Max drawdown rebased on the STARTING capital (piner: TV's "% of initial capital"). */
  maxDrawdownPercentOfInitialCapital: number;
  maxRunupPercentOfInitialCapital: number;
  /** Net profit as a percent of initial capital (TV "Return on initial capital"). */
  returnOnInitialCapitalPercent: number;
  /** Net profit over max drawdown — TV's "Return of max drawdown" (= recovery factor). */
  returnOfMaxDrawdown: number | null;
  runupPhases: PhaseStats;
  drawdownPhases: PhaseStats;
  sharpe: number | null;
  sortino: number | null;
  /** Annualized return volatility, percent. */
  volatilityPercent: number | null;
  profitFactor: number | null;
  recoveryFactor: number | null;
  expectancy: number | null;
  calmar: number | null;
  exposurePercent: number | null;

  // Capital efficiency
  /** Capital consumed at the worst point: `initialCapital - lowest equity`, floored at 0.
   *  The smallest account that would have survived this run. */
  accountSizeRequired: number;
  /** Forced liquidations by the margin simulation (0 unless a margin percent is set). */
  marginCalls: number;
  /** Largest position value held, as a percent of the equity at that moment. */
  peakMarginUsagePercent: number | null;

  // Positions
  avgHoldingMs: number | null;
  avgBarsInTrade: number | null;
  long: DirectionStats;
  short: DirectionStats;

  /** Bars/year used to annualize Sharpe/Sortino/CAGR (reproducibility). */
  periodsPerYear: number;
}

export interface StrategyExecutionResult {
  title: string;
  symbol: string;
  timeframe: string;
  /** Bars actually backtested (after any date-range trim). */
  barCount: number;
  firstBarTime: number;
  lastBarTime: number;
  trades: Trade[];
  openPosition: OpenPosition | null;
  equityCurve: EquityPoint[];
  positions: PositionSnapshot[];
  /** Alternating run-up / drawdown stretches of the equity curve, oldest first. */
  phases: EquityPhase[];
  summary: StrategySummary;
  /** piner's raw report/metrics, kept for export + debugging. Never re-derived by hand. */
  report: StrategyReport;
  pinerMetrics: StrategyMetrics;
  /** Wall-clock execution time, ms. */
  elapsedMs: number;
}

export interface StrategyError {
  heading: string;
  message: string;
  line?: number;
  col?: number;
}

export type StrategyStatus = 'idle' | 'running' | 'success' | 'error';

/** Which strategy overlays the chart shows (section 11 toggles). */
export interface StrategyVisibility {
  entries: boolean;
  exits: boolean;
  openPositions: boolean;
  plots: boolean;
  positionBackground: boolean;
}

export const DEFAULT_VISIBILITY: StrategyVisibility = {
  entries: true,
  exits: true,
  openPositions: true,
  plots: true,
  positionBackground: false,
};

/** piner's own defaults (StrategyBroker.settings), used when a header declares nothing. */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  initialCapital: 100_000,
  qtyType: 'fixed',
  qtyValue: 1,
  commissionType: 'percent',
  commissionValue: 0,
  slippage: 0,
  mintick: 0.01,
  pyramiding: 1,
  processOrdersOnClose: false,
  marginLong: 100,
  marginShort: 100,
  from: null,
  to: null,
};
