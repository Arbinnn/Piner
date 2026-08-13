/**
 * The one place a backtest is executed — now server-side.
 *
 * Deliberately free of React and of lightweight-charts: it takes a compiled script, bars and
 * a config, and returns a plain result object. That is what makes it movable behind a worker
 * thread / Piscina / BullMQ later without touching the API or the UI.
 *
 * `metrics` and `strategyAdapter` still live under `src/strategy/` because they are pure
 * functions over the shared result types and the dashboard uses some of them too; the rule
 * this migration follows is that anything importing the piner ENGINE lives under `server/`.
 */

import type { CompiledScript, DrawObject, OutputCollector, StrategySettings } from '@heyphat/piner';
import { runScript } from '../pine/runtime.ts';
import { toPinerBars } from '../candles.ts';
import type { Candle } from '../../src/types/candle.ts';
import type { InputValues } from '../../src/types/inputs.ts';
import { computeSummary, equityPhases } from '../../src/strategy/metrics.ts';
import { buildEquityCurve, buildOpenPosition, buildPositions, buildTrades } from '../../src/strategy/strategyAdapter.ts';
import { describeUnsupported, findUnsupportedStrategyCalls } from './unsupported.ts';
import type { StrategyConfig, StrategyError, StrategyExecutionResult } from '../../src/strategy/types.ts';

export interface ExecuteStrategyArgs {
  compiled: CompiledScript;
  candles: readonly Candle[];
  inputs: InputValues;
  config: StrategyConfig;
  symbol: string;
  timeframe: string;
  /** Source text, for the unsupported-feature scan. Defaults to skipping that check. */
  source?: string;
}

export interface ExecuteStrategyOutcome {
  result: StrategyExecutionResult | null;
  /** Plot/fill/marker output of the strategy's own `plot()` calls — rendered by the existing
   *  indicator renderer, against `candles` (which may be a date-range slice). */
  outputs: OutputCollector | null;
  drawings: readonly DrawObject[];
  candles: readonly Candle[];
  error: StrategyError | null;
}

/** The user's config as piner broker settings. Only fields the panel owns are overridden. */
export function toStrategySettings(config: StrategyConfig): Partial<StrategySettings> {
  return {
    initialCapital: config.initialCapital,
    qtyType: config.qtyType,
    qtyValue: config.qtyValue,
    commissionType: config.commissionType,
    commissionValue: config.commissionValue,
    slippage: config.slippage,
    pyramiding: config.pyramiding,
    processOrdersOnClose: config.processOrdersOnClose,
    marginLong: config.marginLong,
    marginShort: config.marginShort,
  };
}

/** Inclusive date-range trim. Bars stay in chronological order, so no lookahead is possible. */
export function sliceCandles(candles: readonly Candle[], from: number | null, to: number | null): readonly Candle[] {
  if (from === null && to === null) return candles;
  return candles.filter((c) => (from === null || c.time >= from) && (to === null || c.time <= to));
}

export async function executeStrategy(args: ExecuteStrategyArgs): Promise<ExecuteStrategyOutcome> {
  const { compiled, config } = args;
  const candles = sliceCandles(args.candles, config.from, config.to);

  if (candles.length === 0) {
    return {
      result: null,
      outputs: null,
      drawings: [],
      candles,
      error: {
        heading: 'Invalid Data',
        message:
          args.candles.length === 0
            ? 'No historical bars are loaded.'
            : 'The selected date range contains no bars. Widen the range and run again.',
      },
    };
  }

  // An unknown strategy.* member is not a compile error in piner — it no-ops. Refusing to run
  // is the only way the user learns their orders would have been dropped.
  const unsupported = args.source === undefined ? [] : findUnsupportedStrategyCalls(args.source);
  if (unsupported.length > 0) {
    return {
      result: null,
      outputs: null,
      drawings: [],
      candles,
      error: { heading: 'Unsupported strategy feature', message: describeUnsupported(unsupported) },
    };
  }

  const startedAt = performance.now();
  const outcome = await runScript(compiled, toPinerBars(candles), args.inputs, {
    symbol: args.symbol,
    timeframe: args.timeframe,
    mintick: config.mintick,
    strategy: toStrategySettings(config),
  });

  if (outcome.error) {
    return { result: null, outputs: null, drawings: [], candles, error: outcome.error };
  }
  if (!outcome.strategy) {
    return {
      result: null,
      outputs: outcome.outputs,
      drawings: outcome.drawings,
      candles,
      error: {
        heading: 'Not a Strategy',
        message: 'This script declares indicator(), so it produces no orders, trades or equity curve.',
      },
    };
  }

  const { report, metrics, openLots } = outcome.strategy;
  const trades = buildTrades(report, candles);
  const openPosition = buildOpenPosition(openLots, candles);
  const equityCurve = buildEquityCurve(report, trades, candles);
  const positions = buildPositions(trades, openLots, candles);

  return {
    result: {
      title: compiled.metadata.title,
      symbol: args.symbol,
      timeframe: args.timeframe,
      barCount: candles.length,
      firstBarTime: candles[0].time,
      lastBarTime: candles[candles.length - 1].time,
      trades,
      openPosition,
      equityCurve,
      positions,
      phases: equityPhases(equityCurve),
      summary: computeSummary(report, metrics, trades, equityCurve, positions, openPosition, config),
      report,
      pinerMetrics: metrics,
      elapsedMs: performance.now() - startedAt,
    },
    outputs: outcome.outputs,
    drawings: outcome.drawings,
    candles,
    error: null,
  };
}
