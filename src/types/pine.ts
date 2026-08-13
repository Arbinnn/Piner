/**
 * The Pine execution API contract — the ONLY thing shared between the browser and the
 * Node backend.
 *
 * The frontend never compiles or runs Pine: it POSTs a script to `/api/pine/execute` and
 * receives already-computed visual output. Everything here is therefore plain JSON, and the
 * two `*Outputs` converters below are the single place a `Map` becomes an entry array and
 * back — kept in one module so the two ends cannot drift.
 *
 * The `@heyphat/piner` imports are TYPE-ONLY on purpose: they describe the payload shape and
 * are erased at build time, so the engine itself never reaches the browser bundle.
 */

import type {
  CandleSeries,
  Diagnostic,
  DrawObject,
  FillRegion,
  HLine,
  InputDecl,
  MarkerSeries,
  PlotSeries,
  StrategySettings,
} from '@heyphat/piner';
import type { Candle } from './candle';
import type { InputValues } from './inputs';
import type { StrategyConfig, StrategyExecutionResult } from '../strategy/types';

/** A compile or runtime failure, in the shape the console panel renders. */
export interface PineError {
  heading: string;
  message: string;
  line?: number;
  col?: number;
}

/**
 * The renderer's view of a run's visual output — structurally piner's `OutputCollector`
 * minus its recording methods, which the frontend has no use for.
 */
export interface PineOutputs {
  plots: Map<number, PlotSeries>;
  markers: Map<number, MarkerSeries>;
  candles: Map<number, CandleSeries>;
  hlines: Map<number, HLine>;
  fills: Map<number, FillRegion>;
  barColors: Map<number, (string | null)[]>;
  bgColors: Map<number, (string | null)[]>;
}

/** `PineOutputs` on the wire: every map flattened to its entry array. */
export interface WireOutputs {
  plots: [number, PlotSeries][];
  markers: [number, MarkerSeries][];
  candles: [number, CandleSeries][];
  hlines: [number, HLine][];
  fills: [number, FillRegion][];
  barColors: [number, (string | null)[]][];
  bgColors: [number, (string | null)[]][];
}

/** What the compile told us about the script, for the toolbar, inputs panel and renderer. */
export interface PineMeta {
  title: string;
  overlay: boolean;
  isStrategy: boolean;
  /** Input schema, so the panel can build controls without compiling anything. */
  inputs: InputDecl[];
  /** Settings the `strategy(...)` header itself declared; `{}` for an indicator. */
  strategyHeader: Partial<StrategySettings>;
}

export interface ExecuteRequest {
  script: string;
  symbol: string;
  timeframe: string;
  /** Input overrides, keyed by piner's input key. */
  inputs?: InputValues;
  /** Cap on how many of the most recent bars to run over. Omit for the whole dataset. */
  bars?: number;
  /**
   * User overrides for the backtest settings, layered over the script's own `strategy(...)`
   * header. Only the fields the user has actually edited — anything absent follows the header,
   * so editing the declaration keeps working without the client tracking it.
   */
  strategy?: Partial<StrategyConfig>;
}

export interface ExecuteResponse {
  meta: PineMeta;
  /** Compile warnings. Errors never arrive here — they come back as an `ErrorResponse`. */
  diagnostics: Diagnostic[];
  outputs: WireOutputs;
  drawings: DrawObject[];
  /** Backtest result for a `strategy(...)` script; `null` for an indicator. */
  strategy: StrategyExecutionResult | null;
  /** The settings the backtest actually ran with (header + request overrides). */
  strategyConfig: StrategyConfig | null;
  /** Inclusive index range, into the symbol's candle array, that the run covered. */
  range: { start: number; end: number };
  barCount: number;
  /** Server-side execution time, ms. 0 when the response came from the result cache. */
  elapsedMs: number;
  cached: boolean;
}

export interface ErrorResponse {
  error: PineError;
}

export interface CandlesResponse {
  symbol: string;
  timeframe: string;
  candles: Candle[];
}

/** Anything with the collector's readable surface — the live class, or a rehydrated payload. */
type OutputSource = { [K in keyof PineOutputs]: ReadonlyMap<number, unknown> };

/** Backend side: `OutputCollector` -> JSON. */
export function serializeOutputs(outputs: OutputSource): WireOutputs {
  return {
    plots: [...outputs.plots] as [number, PlotSeries][],
    markers: [...outputs.markers] as [number, MarkerSeries][],
    candles: [...outputs.candles] as [number, CandleSeries][],
    hlines: [...outputs.hlines] as [number, HLine][],
    fills: [...outputs.fills] as [number, FillRegion][],
    barColors: [...outputs.barColors] as [number, (string | null)[]][],
    bgColors: [...outputs.bgColors] as [number, (string | null)[]][],
  };
}

/**
 * Frontend side: JSON -> the maps the renderer walks.
 *
 * Note that `JSON.stringify` turns `NaN`/`Infinity` into `null`, so a bar the script left `na`
 * arrives as `null` rather than `NaN`. Every consumer gates on `Number.isFinite`, which
 * rejects both identically, so the gaps survive the round trip unchanged.
 */
export function deserializeOutputs(wire: WireOutputs): PineOutputs {
  return {
    plots: new Map(wire.plots),
    markers: new Map(wire.markers),
    candles: new Map(wire.candles),
    hlines: new Map(wire.hlines),
    fills: new Map(wire.fills),
    barColors: new Map(wire.barColors),
    bgColors: new Map(wire.bgColors),
  };
}

/** An empty output set, for the "compiled but produced nothing" path. */
export function emptyOutputs(): PineOutputs {
  return {
    plots: new Map(),
    markers: new Map(),
    candles: new Map(),
    hlines: new Map(),
    fills: new Map(),
    barColors: new Map(),
    bgColors: new Map(),
  };
}
