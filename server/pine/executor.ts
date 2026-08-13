/**
 * The Pine execution service: one request in, one JSON payload out.
 *
 * This is the whole backend contract in one function. It owns the compile cache, the result
 * cache, the indicator path and the strategy path, and it hands back only what a chart needs
 * to draw — never the compiled script, the engine, the collector or anything else the browser
 * used to hold.
 */

import type { CompiledScript } from '@heyphat/piner';
import { DatasetError, fingerprint, loadSymbol, recentBars, toPinerBars } from '../candles.ts';
import { executeStrategy } from '../strategy/executor.ts';
import { compileScript } from './compiler.ts';
import { runScript } from './runtime.ts';
import { compileCache, compileKey, resultCache, resultKey } from './cache.ts';
import { DEFAULT_STRATEGY_CONFIG, type StrategyConfig } from '../../src/strategy/types.ts';
import type { Candle } from '../../src/types/candle.ts';
import type { ExecuteRequest, ExecuteResponse, PineError, PineMeta } from '../../src/types/pine.ts';
import { serializeOutputs, emptyOutputs } from '../../src/types/pine.ts';

/** A failure the client should see verbatim (bad script, bad range) rather than a 500. */
export class PineFailure extends Error {
  readonly status: number;
  readonly pine: PineError;

  constructor(pine: PineError, status = 422) {
    super(pine.message);
    this.name = 'PineFailure';
    this.pine = pine;
    this.status = status;
  }
}

/**
 * The backtest settings a run actually uses: piner's defaults, overlaid with whatever the
 * `strategy(...)` header declared, overlaid with the user's explicit edits.
 *
 * Layering it here (rather than resolving the header on the client) is what lets the frontend
 * send only the fields the user has touched: editing the declaration changes the middle layer
 * on the next run, with no client-side bookkeeping and no extra round trip.
 */
export function resolveStrategyConfig(
  compiled: CompiledScript,
  overrides: Partial<StrategyConfig> | undefined,
): StrategyConfig {
  const header = compiled.metadata.strategy ?? {};
  return {
    ...DEFAULT_STRATEGY_CONFIG,
    ...(header.initialCapital !== undefined ? { initialCapital: header.initialCapital } : {}),
    ...(header.qtyType !== undefined ? { qtyType: header.qtyType } : {}),
    ...(header.qtyValue !== undefined ? { qtyValue: header.qtyValue } : {}),
    ...(header.commissionType !== undefined ? { commissionType: header.commissionType } : {}),
    ...(header.commissionValue !== undefined ? { commissionValue: header.commissionValue } : {}),
    ...(header.slippage !== undefined ? { slippage: header.slippage } : {}),
    ...(header.pyramiding !== undefined ? { pyramiding: header.pyramiding } : {}),
    ...(header.processOrdersOnClose !== undefined ? { processOrdersOnClose: header.processOrdersOnClose } : {}),
    ...(header.marginLong !== undefined ? { marginLong: header.marginLong } : {}),
    ...(header.marginShort !== undefined ? { marginShort: header.marginShort } : {}),
    ...(overrides ?? {}),
  };
}

/** Compiles, or returns the cached artifact for an identical source. Throws on a compile error. */
function compileCached(source: string): CompiledScript {
  const key = compileKey(source);
  const hit = compileCache.get(key);
  if (hit) return hit;

  const outcome = compileScript(source);
  if (outcome.error || !outcome.compiled) {
    throw new PineFailure(outcome.error ?? { heading: 'Compilation Error', message: 'The script did not compile.' });
  }
  compileCache.set(key, outcome.compiled);
  return outcome.compiled;
}

function metaOf(compiled: CompiledScript): PineMeta {
  return {
    title: compiled.metadata.title,
    overlay: compiled.metadata.overlay,
    isStrategy: compiled.metadata.isStrategy,
    inputs: [...compiled.metadata.inputs],
    strategyHeader: compiled.metadata.strategy ?? {},
  };
}

/** Inclusive index range of `window` inside `all`. Both hold the same candle objects. */
function rangeOf(all: readonly Candle[], window: readonly Candle[]): { start: number; end: number } {
  if (window.length === 0) return { start: 0, end: -1 };
  const start = all.indexOf(window[0] as Candle);
  return start === -1 ? { start: 0, end: window.length - 1 } : { start, end: start + window.length - 1 };
}

export async function executePine(req: ExecuteRequest): Promise<ExecuteResponse> {
  const full = await loadSymbol(req.symbol);
  const candles = recentBars(full, req.bars);
  if (candles.length === 0) {
    throw new DatasetError(`No bars available for '${req.symbol}'.`, 422);
  }

  const key = resultKey({
    source: req.script,
    symbol: req.symbol,
    timeframe: req.timeframe,
    dataset: fingerprint(candles),
    inputs: req.inputs ?? {},
    strategy: req.strategy ?? {},
  });
  const cached = resultCache.get(key);
  if (cached) return { ...cached, cached: true };

  const compiled = compileCached(req.script);
  const meta = metaOf(compiled);
  const diagnostics = compiled.diagnostics.filter((d) => d.severity !== 'error');
  const inputs = req.inputs ?? {};
  const startedAt = performance.now();

  const response: ExecuteResponse = compiled.metadata.isStrategy
    ? await runStrategy(compiled, meta, diagnostics, candles, inputs, req)
    : await runIndicator(compiled, meta, diagnostics, candles, inputs, req);

  response.elapsedMs = performance.now() - startedAt;
  resultCache.set(key, response);
  return response;
}

type Diagnostics = ExecuteResponse['diagnostics'];

async function runIndicator(
  compiled: CompiledScript,
  meta: PineMeta,
  diagnostics: Diagnostics,
  candles: readonly Candle[],
  inputs: ExecuteRequest['inputs'],
  req: ExecuteRequest,
): Promise<ExecuteResponse> {
  const outcome = await runScript(compiled, toPinerBars(candles), inputs ?? {}, {
    symbol: req.symbol,
    timeframe: req.timeframe,
  });
  if (outcome.error) throw new PineFailure(outcome.error);

  return {
    meta,
    diagnostics,
    outputs: outcome.outputs ? serializeOutputs(outcome.outputs) : serializeOutputs(emptyOutputs()),
    drawings: [...outcome.drawings],
    strategy: null,
    strategyConfig: null,
    range: { start: 0, end: candles.length - 1 },
    barCount: candles.length,
    elapsedMs: 0,
    cached: false,
  };
}

async function runStrategy(
  compiled: CompiledScript,
  meta: PineMeta,
  diagnostics: Diagnostics,
  candles: readonly Candle[],
  inputs: ExecuteRequest['inputs'],
  req: ExecuteRequest,
): Promise<ExecuteResponse> {
  const config = resolveStrategyConfig(compiled, req.strategy);
  const outcome = await executeStrategy({
    compiled,
    candles,
    inputs: inputs ?? {},
    config,
    symbol: req.symbol,
    timeframe: req.timeframe,
    source: req.script,
  });
  if (outcome.error || !outcome.result) {
    throw new PineFailure(outcome.error ?? { heading: 'Strategy Error', message: 'The backtest produced no result.' });
  }

  return {
    meta,
    diagnostics,
    outputs: outcome.outputs ? serializeOutputs(outcome.outputs) : serializeOutputs(emptyOutputs()),
    drawings: [...outcome.drawings],
    strategy: outcome.result,
    strategyConfig: config,
    range: rangeOf(candles, outcome.candles),
    barCount: outcome.candles.length,
    elapsedMs: 0,
    cached: false,
  };
}
