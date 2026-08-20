/**
 * Compiled script -> visual output.
 *
 * The second half of the old `src/lib/pineRunner.ts`, moved unchanged. This is the only place
 * a piner `Engine` is ever constructed, and it exists exclusively on the server: nothing here
 * (the engine, the collector, the broker) is ever handed to a client.
 */

import { ArrayFeed, Engine, type Bar, type CompiledScript, type DrawObject, type OutputCollector } from '@heyphat/piner';
import type { StrategyMetrics, StrategyReport, StrategySettings } from '@heyphat/piner';
import type { OpenLotSnapshot } from '../../src/strategy/strategyAdapter.ts';
import type { InputValues } from '../../src/types/inputs.ts';
import type { PineError } from '../../src/types/pine.ts';
import { patchHtfTime } from './htfTime.ts';

/** Present only for a `strategy(...)` script: piner's backtest output, raw. */
export interface StrategyRunOutcome {
  report: StrategyReport;
  metrics: StrategyMetrics;
  /** Entry lots still open on the final bar (never counted as closed trades). */
  openLots: OpenLotSnapshot[];
}

export interface RunOutcome {
  outputs: OutputCollector | null;
  /** Live drawing objects (box/line/label/…) — the visual output of most published indicators. */
  drawings: readonly DrawObject[];
  strategy: StrategyRunOutcome | null;
  error: PineError | null;
}

export interface RunOptions {
  symbol: string;
  timeframe: string;
  /** Instrument tick size — the unit `strategy.slippage` is denominated in. */
  mintick?: number;
  /** Host override of the `strategy(...)` header settings (initial capital, commission, …). */
  strategy?: Partial<StrategySettings>;
}

/** Runs a compiled script over the given bars with the given input overrides. Never throws. */
export async function runScript(
  compiled: CompiledScript,
  bars: Bar[],
  inputs: InputValues,
  opts: RunOptions,
): Promise<RunOutcome> {
  try {
    const engine = new Engine(compiled, new ArrayFeed(bars), {
      historySlotCount: compiled.metadata.historySlotCount,
      inputs,
      ...(opts.strategy ? { strategy: opts.strategy } : {}),
    });
    patchHtfTime(engine.ctx as unknown as Parameters<typeof patchHtfTime>[0]);
    patchFormatSpecs(engine.ctx as unknown as StrContext);
    await engine.run({ symbol: opts.symbol, timeframe: opts.timeframe, mintick: opts.mintick });
    return {
      outputs: engine.outputs,
      drawings: engine.drawings,
      strategy: compiled.metadata.isStrategy
        ? { report: engine.strategy, metrics: engine.strategyMetrics(), openLots: readOpenLots(engine) }
        : null,
      error: null,
    };
  } catch (err) {
    return {
      outputs: null,
      drawings: [],
      strategy: null,
      error: {
        heading: 'Runtime Error',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function num(value: number | string): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The position still open on the last bar.
 *
 * `StrategyReport` deliberately carries only CLOSED trades, so an open position would
 * otherwise be invisible in the dashboard (or, worse, get counted as a completed trade).
 * The live lots are read off the broker through the same `strategy.opentrades_*` accessors
 * Pine itself uses, so the numbers match what the script would see.
 */
function readOpenLots(engine: Engine): OpenLotSnapshot[] {
  const broker = engine.ctx.strategyBroker;
  const count = Math.max(0, Math.trunc(engine.ctx.strategy.opentrades));
  const lots: OpenLotSnapshot[] = [];
  for (let i = 0; i < count; i += 1) {
    const size = num(broker.tradeField('opentrades', 'size', i));
    if (size === 0) continue;
    lots.push({
      entryId: String(broker.tradeField('opentrades', 'entry_id', i)),
      size,
      entryPrice: num(broker.tradeField('opentrades', 'entry_price', i)),
      entryBarIndex: num(broker.tradeField('opentrades', 'entry_bar_index', i)),
      entryTime: num(broker.tradeField('opentrades', 'entry_time', i)),
    });
  }
  return lots;
}

/** The slice of a piner execution context `patchFormatSpecs` touches. */
interface StrContext {
  str: { tostring(x: unknown, fmt?: unknown): unknown };
}

/**
 * Teaches `str.tostring` the named format specs.
 *
 * piner only understands numeric patterns (`"#.##"`), `format.mintick` and `format.volume`, so
 * `str.tostring(x, format.percent)` — what every heat/oscillator dashboard labels its readout
 * with — falls through to `String(x)` and prints `34.408602150537675` instead of `34.41%`.
 *
 * ponytail: percent and currency only; `format.price` needs the instrument precision the host
 * does not track. Add it when a script's price labels look wrong.
 */
function patchFormatSpecs(ctx: StrContext): void {
  const original = ctx.str.tostring.bind(ctx.str);
  ctx.str = {
    ...ctx.str,
    tostring(x: unknown, fmt?: unknown): unknown {
      if (typeof x === 'number' && Number.isFinite(x)) {
        if (fmt === 'percent') return `${x.toFixed(2)}%`;
        if (fmt === 'currency') return `$${x.toFixed(2)}`;
      }
      return original(x, fmt);
    },
  };
}
