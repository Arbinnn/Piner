/**
 * Strategy engine tests.
 *
 * Run with: `npm test` (node's built-in runner + type stripping — no test framework added).
 *
 * The bars are synthetic and flat (open = high = low = close), so every assertion below is an
 * exact number: with no intrabar range there is exactly one price an order can fill at, which
 * makes fill timing, commission and slippage individually observable.
 */

import { strictEqual, ok } from 'node:assert/strict';
import { test } from 'node:test';
import type { UTCTimestamp } from 'lightweight-charts';
import { compileScript } from '../pine/compiler.ts';
import type { Candle } from '../../src/types/candle.ts';
import { detectPineScriptType } from '../../src/strategy/strategyDetector.ts';
import { executeStrategy } from './executor.ts';
import { periodPerformance } from '../../src/strategy/metrics.ts';
import { findUnsupportedStrategyCalls } from './unsupported.ts';
import {
  DEFAULT_STRATEGY_CONFIG,
  type StrategyConfig,
  type StrategyExecutionResult,
} from '../../src/strategy/types.ts';

const DAY = 86_400;
const START = Date.UTC(2020, 0, 1) / 1000;

function candlesFrom(prices: readonly number[]): Candle[] {
  return prices.map((p, i) => ({
    time: (START + i * DAY) as UTCTimestamp,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 1000,
  }));
}

async function run(
  source: string,
  prices: readonly number[],
  patch: Partial<StrategyConfig> = {},
): Promise<StrategyExecutionResult> {
  const outcome = compileScript(source);
  ok(outcome.compiled, `compile failed: ${outcome.error?.message}`);

  const executed = await executeStrategy({
    compiled: outcome.compiled,
    candles: candlesFrom(prices),
    inputs: {},
    config: { ...DEFAULT_STRATEGY_CONFIG, initialCapital: 100_000, qtyValue: 10, ...patch },
    symbol: 'TEST',
    timeframe: 'D',
    source,
  });
  ok(executed.result, `execution failed: ${executed.error?.heading} ${executed.error?.message}`);
  return executed.result;
}

const LONG_ROUND_TRIP = `//@version=6
strategy("Long Test")
if bar_index == 1
    strategy.entry("L", strategy.long)
if bar_index == 3
    strategy.close("L")
`;

const SHORT_ROUND_TRIP = `//@version=6
strategy("Short Test")
if bar_index == 1
    strategy.entry("S", strategy.short)
if bar_index == 3
    strategy.close("S")
`;

/** Flat bars: entry fills on bar 2's open, exit on bar 4's open (next-bar-open semantics). */
const PRICES_UP = [100, 100, 100, 100, 120, 120];
const PRICES_DOWN = [100, 100, 100, 100, 80, 80];

test('detects strategy, indicator and neither', () => {
  strictEqual(detectPineScriptType(LONG_ROUND_TRIP), 'strategy');
  strictEqual(detectPineScriptType('//@version=6\nindicator("I")\nplot(close)'), 'indicator');
  strictEqual(detectPineScriptType('plot(close)'), 'unknown');
  // `strategy.` inside an indicator body must NOT flip the app into Strategy Tester mode.
  strictEqual(detectPineScriptType('//@version=6\nindicator("I")\n// strategy("x")\nplot(close)'), 'indicator');
});

test('long round trip: entry, exit, trade, equity', async () => {
  const result = await run(LONG_ROUND_TRIP, PRICES_UP);

  strictEqual(result.trades.length, 1);
  const [trade] = result.trades;
  strictEqual(trade.direction, 'long');
  strictEqual(trade.entryBarIndex, 2);
  strictEqual(trade.exitBarIndex, 4);
  strictEqual(trade.entryPrice, 100);
  strictEqual(trade.exitPrice, 120);
  strictEqual(trade.quantity, 10);
  strictEqual(trade.netPnL, 200);
  strictEqual(trade.grossPnL, 200);
  strictEqual(trade.returnPercent, 20);

  strictEqual(result.summary.netProfit, 200);
  strictEqual(result.summary.winningTrades, 1);
  strictEqual(result.summary.winRate, 100);
  strictEqual(result.equityCurve[result.equityCurve.length - 1].equity, 100_200);
  // Position is held over [entry, exit) and flat afterwards.
  strictEqual(result.positions[2].direction, 'long');
  strictEqual(result.positions[3].size, 10);
  strictEqual(result.positions[4].direction, 'flat');
  strictEqual(result.positions[5].realizedPnL, 200);
});

test('short round trip profits when price falls', async () => {
  const result = await run(SHORT_ROUND_TRIP, PRICES_DOWN);

  strictEqual(result.trades.length, 1);
  strictEqual(result.trades[0].direction, 'short');
  strictEqual(result.trades[0].netPnL, 200);
  strictEqual(result.summary.short.trades, 1);
  strictEqual(result.summary.long.trades, 0);
  strictEqual(result.summary.long.winRate, null);
});

test('losing trade reports negative P&L and a drawdown', async () => {
  const result = await run(LONG_ROUND_TRIP, PRICES_DOWN);

  strictEqual(result.trades[0].netPnL, -200);
  strictEqual(result.summary.losingTrades, 1);
  strictEqual(result.summary.winRate, 0);
  strictEqual(result.summary.grossProfit, 0);
  strictEqual(result.summary.grossLoss, 200);
  // Gross profit 0 over a real gross loss is a defined ratio of 0 (N/A is only for 0/0).
  strictEqual(result.summary.profitFactor, 0);
  ok(result.summary.maxDrawdown > 0);
});

test('commission reduces net P&L and equity', async () => {
  const result = await run(LONG_ROUND_TRIP, PRICES_UP, {
    commissionType: 'cash_per_order',
    commissionValue: 5,
  });

  const [trade] = result.trades;
  strictEqual(trade.commission, 10);
  strictEqual(trade.grossPnL, 200);
  strictEqual(trade.netPnL, 190);
  strictEqual(result.summary.netProfit, 190);
  strictEqual(result.summary.totalCommission, 10);
  strictEqual(result.equityCurve[result.equityCurve.length - 1].equity, 100_190);
});

test('slippage moves the fill prices against the trade', async () => {
  const result = await run(LONG_ROUND_TRIP, PRICES_UP, { slippage: 1, mintick: 0.5 });

  const [trade] = result.trades;
  strictEqual(trade.entryPrice, 100.5);
  strictEqual(trade.exitPrice, 119.5);
  strictEqual(trade.netPnL, 190);
});

test('multiple trades aggregate into the summary', async () => {
  const source = `//@version=6
strategy("Multi")
if bar_index % 4 == 1
    strategy.entry("L", strategy.long)
if bar_index % 4 == 3
    strategy.close("L")
`;
  const prices = [100, 100, 100, 100, 110, 110, 110, 110, 105, 105, 105, 105, 115, 115];
  const result = await run(source, prices);

  strictEqual(result.trades.length, 3);
  strictEqual(result.summary.totalTrades, 3);
  strictEqual(result.summary.winningTrades + result.summary.losingTrades + result.summary.evenTrades, 3);
  strictEqual(
    Math.round(result.summary.netProfit * 100) / 100,
    Math.round(result.trades.reduce((sum, t) => sum + t.netPnL, 0) * 100) / 100,
  );
  ok(result.summary.avgTrade !== null);
  strictEqual(
    Math.round(result.summary.avgTrade * 100) / 100,
    Math.round((result.summary.netProfit / 3) * 100) / 100,
  );
});

test('an open position is not counted as a closed trade', async () => {
  const source = `//@version=6
strategy("Open")
if bar_index == 1
    strategy.entry("L", strategy.long)
`;
  const result = await run(source, PRICES_UP);

  strictEqual(result.trades.length, 0);
  strictEqual(result.summary.totalTrades, 0);
  strictEqual(result.summary.openTrades, 1);
  strictEqual(result.summary.winRate, null);
  ok(result.openPosition);
  strictEqual(result.openPosition.direction, 'long');
  strictEqual(result.openPosition.size, 10);
  strictEqual(result.openPosition.averageEntryPrice, 100);
  strictEqual(result.openPosition.unrealizedPnL, 200);
  // Net profit is realized-only; equity marks the open lot to market.
  strictEqual(result.summary.netProfit, 0);
  strictEqual(result.summary.finalEquity, 100_200);
});

test('a strategy with no trades produces no NaN/Infinity', async () => {
  const source = `//@version=6
strategy("Quiet")
plot(close)
`;
  const result = await run(source, PRICES_UP);
  const s = result.summary;

  strictEqual(s.totalTrades, 0);
  strictEqual(s.winRate, null);
  strictEqual(s.profitFactor, null);
  strictEqual(s.avgTrade, null);
  strictEqual(s.expectancy, null);
  strictEqual(s.sharpe, null);
  strictEqual(s.sortino, null);
  strictEqual(s.recoveryFactor, null);
  strictEqual(s.maxConsecutiveWins, null);
  strictEqual(s.netProfit, 0);

  for (const [key, value] of Object.entries(s)) {
    if (typeof value === 'number') ok(Number.isFinite(value), `${key} is not finite: ${value}`);
  }
  for (const point of result.equityCurve) {
    ok(Number.isFinite(point.equity) && Number.isFinite(point.drawdownPercent));
  }
});

test('a date range trims the backtest window', async () => {
  const prices = PRICES_UP;
  const from = START + 2 * DAY;
  const result = await run(LONG_ROUND_TRIP, prices, { from });

  strictEqual(result.barCount, prices.length - 2);
  strictEqual(result.firstBarTime, from);
});

test('empty datasets and impossible ranges fail without throwing', async () => {
  const outcome = compileScript(LONG_ROUND_TRIP);
  ok(outcome.compiled);
  const executed = await executeStrategy({
    compiled: outcome.compiled,
    candles: [],
    inputs: {},
    config: DEFAULT_STRATEGY_CONFIG,
    symbol: 'TEST',
    timeframe: 'D',
  });
  strictEqual(executed.result, null);
  ok(executed.error);
});

test('an invalid script returns a compile error instead of throwing', () => {
  const outcome = compileScript('//@version=6\nstrategy("Bad"\nplot(');
  strictEqual(outcome.compiled, null);
  ok(outcome.error);
  strictEqual(outcome.error.heading, 'Compilation Error');
});

test('an unsupported strategy.* call is reported instead of silently ignored', async () => {
  const source = `//@version=6
strategy("Unsupported")
if bar_index == 1
    strategy.someFeature("L")
`;
  const found = findUnsupportedStrategyCalls(source);
  strictEqual(found.length, 1);
  strictEqual(found[0].name, 'strategy.someFeature');

  const outcome = compileScript(source);
  ok(outcome.compiled);
  const executed = await executeStrategy({
    compiled: outcome.compiled,
    candles: candlesFrom(PRICES_UP),
    inputs: {},
    config: DEFAULT_STRATEGY_CONFIG,
    symbol: 'TEST',
    timeframe: 'D',
    source,
  });
  strictEqual(executed.result, null);
  strictEqual(executed.error?.heading, 'Unsupported strategy feature');

  // Supported members — including the nested trade accessors — must not be flagged.
  strictEqual(
    findUnsupportedStrategyCalls(
      '//@version=6\nstrategy("OK")\nstrategy.entry("L", strategy.long)\nplot(strategy.closedtrades.profit(0))\nstrategy.risk.max_drawdown(10)\n',
    ).length,
    0,
  );
});

test('benchmark, run-up and capital requirements are derived from the run', async () => {
  const result = await run(LONG_ROUND_TRIP, PRICES_UP);
  const s = result.summary;
  const last = result.equityCurve[result.equityCurve.length - 1];

  // Buy & hold: bought at the same 100 the strategy filled at, held to the last close of 120.
  strictEqual(result.equityCurve[0].benchmarkEquity, 100_000);
  strictEqual(last.benchmarkEquity, 120_000);
  ok(s.buyHoldReturnPercent !== null && Math.abs(s.buyHoldReturnPercent - 20) < 1e-9);
  ok(s.outperformancePercent !== null && Math.abs(s.outperformancePercent - (s.netProfitPercent - 20)) < 1e-9);

  // Equity only ever rose, so run-up is the whole gain and drawdown is zero.
  strictEqual(last.runup, 200);
  strictEqual(last.drawdown, 0);
  strictEqual(s.maxDrawdown, 0);

  // 10 contracts at 100, fully funded, with no losses standing at that moment.
  strictEqual(s.accountSizeRequired, 1000);
  strictEqual(s.marginCalls, 0);
  ok(s.peakMarginUsagePercent !== null && s.peakMarginUsagePercent > 0);
});

test('avg trade percent and win/loss ratio come from the trade ledger', async () => {
  const result = await run(LONG_ROUND_TRIP, PRICES_UP);
  const s = result.summary;

  strictEqual(s.avgTradePercent, 20);
  // One winner and no losers: the ratio is undefined, not Infinity.
  strictEqual(s.winLossRatio, null);
  strictEqual(s.openPnL, 0);
});

test('equity phases reproduce piner\'s close-to-close analytics', async () => {
  // A saw-tooth equity path: several complete peak -> trough -> recovery cycles, so both the
  // magnitudes and the (longer) drawdown durations have something to measure.
  const source = `//@version=6
strategy("Cycles")
if bar_index % 6 == 1
    strategy.entry("L", strategy.long)
if bar_index % 6 == 4
    strategy.close("L")
`;
  const prices = [100, 100, 100, 110, 110, 108, 104, 104, 104, 118, 118, 112, 106, 106, 106, 124, 124, 116, 120, 120];
  const result = await run(source, prices);
  const s = result.summary;

  ok(result.phases.length > 0);
  ok(result.phases.some((p) => p.kind === 'runup') && result.phases.some((p) => p.kind === 'drawdown'));
  // Exactly one trailing phase may be open; every other phase is complete.
  strictEqual(result.phases.filter((p) => p.open).length, 1);

  const near = (a: number | null, b: number | null): boolean =>
    a !== null && b !== null && Math.abs(a - b) < 1e-6;

  ok(near(s.runupPhases.average, s.avgRunup), `${s.runupPhases.average} vs ${s.avgRunup}`);
  ok(near(s.drawdownPhases.average, s.avgDrawdown), `${s.drawdownPhases.average} vs ${s.avgDrawdown}`);
  ok(
    near(s.runupPhases.averageDurationDays, s.avgRunupDurationDays),
    `${s.runupPhases.averageDurationDays} vs ${s.avgRunupDurationDays}`,
  );
  ok(
    near(s.drawdownPhases.averageDurationDays, s.avgDrawdownDurationDays),
    `${s.drawdownPhases.averageDurationDays} vs ${s.avgDrawdownDurationDays}`,
  );
});

test('periodic performance chains bucket returns', async () => {
  const result = await run(LONG_ROUND_TRIP, PRICES_UP);
  const daily = periodPerformance(result.equityCurve, 'day');

  strictEqual(daily.length, result.equityCurve.length);
  const compounded = daily.reduce((acc, p) => acc * (1 + p.returnPercent / 100), 1);
  const direct = result.equityCurve[result.equityCurve.length - 1].equity / result.summary.initialCapital;
  ok(Math.abs(compounded - direct) < 1e-9, `${compounded} vs ${direct}`);
});
