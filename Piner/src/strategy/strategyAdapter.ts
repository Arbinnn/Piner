/**
 * Normalizes piner's broker-verbatim `StrategyReport` into the UI model.
 *
 * Nothing here re-simulates the backtest: fills, commission, slippage, cash and equity all
 * come from `StrategyBroker`. This module only reshapes them (ms -> chart seconds, lot rows ->
 * trades, equity array -> curve + drawdown, lot ledger -> per-bar position).
 */

import type { ClosedTrade, StrategyReport } from '@heyphat/piner';
import type { Candle } from '../types/candle';
import type { EquityPoint, OpenPosition, OpenTrade, PositionSnapshot, Trade, TradeDirection } from './types';

/** A live entry lot at the end of the run, read off the broker by `pineRunner`. */
export interface OpenLotSnapshot {
  entryId: string;
  /** Signed size: > 0 long, < 0 short. */
  size: number;
  entryPrice: number;
  entryBarIndex: number;
  /** Epoch MILLISECONDS (piner bar time). */
  entryTime: number;
}

const MS_PER_SECOND = 1000;

function directionOf(dir: number): TradeDirection {
  return dir >= 0 ? 'long' : 'short';
}

/** Percent return on the capital the lot committed (|entry price x qty|), TradingView's basis. */
function tradePercent(amount: number, entryPrice: number, qty: number): number {
  const basis = Math.abs(entryPrice * qty);
  return basis > 0 ? (amount / basis) * 100 : 0;
}

/** Chart-native seconds for a bar index, falling back to the broker's ms stamp. */
function barSeconds(candles: readonly Candle[], barIndex: number, fallbackMs: number): number {
  const candle = candles[barIndex];
  return candle ? candle.time : Math.floor(fallbackMs / MS_PER_SECOND);
}

export function buildTrades(report: StrategyReport, candles: readonly Candle[]): Trade[] {
  return report.closedTrades.map((row: ClosedTrade, i: number) => {
    // piner books `profit` NET of both sides' commission; gross adds it back.
    const netPnL = row.profit;
    const grossPnL = row.profit + row.commission;
    return {
      id: `${i}`,
      index: i + 1,
      entryId: row.entryId,
      direction: directionOf(row.dir),
      entryTime: barSeconds(candles, row.entryBar, row.entryTime),
      exitTime: barSeconds(candles, row.exitBar, row.exitTime),
      entryBarIndex: row.entryBar,
      exitBarIndex: row.exitBar,
      entryPrice: row.entryPrice,
      exitPrice: row.exitPrice,
      quantity: row.qty,
      grossPnL,
      commission: row.commission,
      netPnL,
      returnPercent: tradePercent(netPnL, row.entryPrice, row.qty),
      cumulativePnL: row.cumProfit,
      durationMs: Math.max(0, row.exitTime - row.entryTime),
      maxRunup: row.maxRunup,
      maxDrawdown: row.maxDrawdown,
    };
  });
}

/**
 * The position still open on the last bar.
 *
 * Unrealized P&L is marked here against the final bar's close rather than read back off the
 * broker: once the run has ended the broker's live-close mark no longer refers to that bar,
 * and this is the same mark-to-market the equity curve's last point uses.
 */
export function buildOpenPosition(lots: readonly OpenLotSnapshot[], candles: readonly Candle[]): OpenPosition | null {
  if (lots.length === 0 || candles.length === 0) return null;

  const lastClose = candles[candles.length - 1].close;
  let size = 0;
  let notional = 0;
  let unrealized = 0;
  const trades: OpenTrade[] = [];

  for (const lot of lots) {
    const qty = Math.abs(lot.size);
    const pnl = lot.size * (lastClose - lot.entryPrice);
    size += lot.size;
    notional += lot.entryPrice * qty;
    unrealized += pnl;
    trades.push({
      entryId: lot.entryId,
      direction: directionOf(lot.size),
      entryTime: barSeconds(candles, lot.entryBarIndex, lot.entryTime),
      entryBarIndex: lot.entryBarIndex,
      entryPrice: lot.entryPrice,
      quantity: qty,
      unrealizedPnL: pnl,
      returnPercent: tradePercent(pnl, lot.entryPrice, qty),
    });
  }

  const totalQty = lots.reduce((sum, lot) => sum + Math.abs(lot.size), 0);
  return {
    direction: directionOf(size),
    size,
    averageEntryPrice: totalQty > 0 ? notional / totalQty : 0,
    unrealizedPnL: unrealized,
    trades,
  };
}

/**
 * Per-bar equity, cash and drawdown.
 *
 * `equity` is piner's own mark-to-market series. The split is exact rather than re-derived:
 * realized P&L is the running sum of closed-trade rows (which already net commission), and
 * whatever equity holds beyond `initial + realized` is the open position's unrealized P&L.
 * A bar before the strategy activated carries the last known equity (piner leaves those
 * slots unwritten), so the curve never renders a hole at initial capital.
 */
export function buildEquityCurve(
  report: StrategyReport,
  trades: readonly Trade[],
  candles: readonly Candle[],
): EquityPoint[] {
  const initial = report.initialCapital;
  const benchmark = buildBenchmarkCurve(candles, trades, initial);
  const realizedByBar = new Float64Array(candles.length);
  for (const trade of trades) {
    if (trade.exitBarIndex >= 0 && trade.exitBarIndex < realizedByBar.length) {
      realizedByBar[trade.exitBarIndex] += trade.netPnL;
    }
  }

  const points: EquityPoint[] = [];
  let realized = 0;
  let peak = initial;
  let valley = initial;
  let last = initial;

  for (let i = 0; i < candles.length; i += 1) {
    realized += realizedByBar[i];
    const raw = report.equityCurve[i];
    const equity = Number.isFinite(raw) ? raw : last;
    last = equity;
    if (equity > peak) peak = equity;
    if (equity < valley) valley = equity;
    const drawdown = Math.max(0, peak - equity);
    const runup = Math.max(0, equity - valley);
    points.push({
      time: candles[i].time,
      equity,
      cash: initial + realized,
      realizedPnL: realized,
      unrealizedPnL: equity - initial - realized,
      drawdown,
      drawdownPercent: peak > 0 ? (drawdown / peak) * 100 : 0,
      runup,
      runupPercent: valley > 0 ? (runup / valley) * 100 : 0,
      benchmarkEquity: benchmark[i],
    });
  }
  return points;
}

/**
 * Buy-&-hold equity over the same bars and the same capital.
 *
 * Basis matches piner's own benchmark (`StrategyMetrics.buyHoldReturnPercent`) so the chart
 * line and the reported percentage can't disagree: entry is the first closed trade's entry
 * fill — TradingView measures "from when the strategy first opened a position" — falling back
 * to the second bar's open, which is where a bar-0 signal would actually have filled.
 */
export function buildBenchmarkCurve(
  candles: readonly Candle[],
  trades: readonly Trade[],
  initialCapital: number,
): number[] {
  if (candles.length === 0) return [];

  const entryBar = trades.length > 0 ? trades[0].entryBarIndex : Math.min(1, candles.length - 1);
  const basis = trades.length > 0 ? trades[0].entryPrice : candles[Math.min(1, candles.length - 1)].open;
  if (!Number.isFinite(basis) || basis <= 0) return candles.map(() => initialCapital);

  return candles.map((candle, i) =>
    i < entryBar ? initialCapital : initialCapital * (candle.close / basis),
  );
}

/**
 * Per-bar position state from the lot ledger.
 *
 * A lot is held over `[entryBar, exitBar)` — the exit bar is the bar the closing fill happened
 * on, so the position is flat from there. Built with a difference sweep (O(bars + lots)) rather
 * than scanning every lot per bar, which matters once a strategy produces tens of thousands.
 */
export function buildPositions(
  trades: readonly Trade[],
  openLots: readonly OpenLotSnapshot[],
  candles: readonly Candle[],
): PositionSnapshot[] {
  const n = candles.length;
  const signedSize = new Float64Array(n + 1);
  const notional = new Float64Array(n + 1);
  const realizedByBar = new Float64Array(n + 1);

  const addLot = (from: number, to: number, signed: number, price: number): void => {
    const start = Math.max(0, Math.min(from, n));
    const end = Math.max(0, Math.min(to, n));
    if (start >= end) return;
    const qty = Math.abs(signed);
    signedSize[start] += signed;
    signedSize[end] -= signed;
    notional[start] += price * qty;
    notional[end] -= price * qty;
  };

  for (const trade of trades) {
    const signed = trade.direction === 'long' ? trade.quantity : -trade.quantity;
    addLot(trade.entryBarIndex, trade.exitBarIndex, signed, trade.entryPrice);
    if (trade.exitBarIndex >= 0 && trade.exitBarIndex <= n) realizedByBar[trade.exitBarIndex] += trade.netPnL;
  }
  for (const lot of openLots) {
    addLot(lot.entryBarIndex, n, lot.size, lot.entryPrice);
  }

  const snapshots: PositionSnapshot[] = [];
  let size = 0;
  let runningNotional = 0;
  let realized = 0;

  for (let i = 0; i < n; i += 1) {
    size += signedSize[i];
    runningNotional += notional[i];
    realized += realizedByBar[i];

    const qty = Math.abs(size);
    // Float sweeps drift; snap the flat state so `direction` never reads 'long' at 1e-13.
    const flat = qty < 1e-9;
    const averageEntryPrice = flat ? 0 : runningNotional / qty;
    const close = candles[i].close;
    snapshots.push({
      time: candles[i].time,
      barIndex: i,
      size: flat ? 0 : size,
      direction: flat ? 'flat' : size > 0 ? 'long' : 'short',
      averageEntryPrice,
      currentPrice: close,
      unrealizedPnL: flat ? 0 : (close - averageEntryPrice) * size,
      realizedPnL: realized,
    });
  }
  return snapshots;
}
