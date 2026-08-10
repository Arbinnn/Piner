import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi } from 'lightweight-charts';
import type { CompiledScript } from '@heyphat/piner';
import type { PlotRenderer } from '../lib/plotRenderer';
import type { Candle, ConsoleLevel } from '../types/candle';
import type { InputValues } from '../types/inputs';
import { buildPositionBackground, buildStrategyMarkers, type MarkerInfo } from '../strategy/markers';
import { executeStrategy } from '../strategy/strategyExecutor';
import { StrategyCache, cacheKey } from '../strategy/strategyCache';
import {
  DEFAULT_STRATEGY_CONFIG,
  DEFAULT_VISIBILITY,
  type StrategyConfig,
  type StrategyError,
  type StrategyExecutionResult,
  type StrategyStatus,
  type StrategyVisibility,
} from '../strategy/types';

const CONFIG_DEBOUNCE_MS = 150;
/** Padding, in bars, around a trade when the chart is focused on it. */
const FOCUS_PADDING_BARS = 12;

interface UseStrategyArgs {
  candles: readonly Candle[];
  rendererRef: React.RefObject<PlotRenderer | null>;
  chartRef: React.RefObject<IChartApi | null>;
  symbol: string;
  timeframe: string;
  log: (level: ConsoleLevel, heading: string, message: string) => void;
}

export interface UseStrategyResult {
  status: StrategyStatus;
  result: StrategyExecutionResult | null;
  error: StrategyError | null;
  config: StrategyConfig;
  setConfig: (patch: Partial<StrategyConfig>) => void;
  resetConfig: () => void;
  visibility: StrategyVisibility;
  toggleVisibility: (key: keyof StrategyVisibility) => void;
  selectedTradeIndex: number | null;
  selectTrade: (index: number | null) => void;
  /** Bar time (seconds) -> chart marker payloads, for the hover tooltip. */
  markersByTime: Map<number, MarkerInfo[]>;
  /** Compile-derived defaults + user edits, run through piner. Renders plots and markers. */
  execute: (compiled: CompiledScript, source: string, inputs: InputValues, reveal: boolean) => Promise<void>;
  /** Leaves strategy mode: drops the result and the chart overlays. */
  clear: () => void;
}

/**
 * Header settings the script itself declared, layered over piner's defaults. A strategy that
 * says `strategy(..., initial_capital=50000)` should open the settings panel showing 50,000,
 * not our fallback — the panel overrides the header, so it has to start equal to it.
 */
function configFromHeader(compiled: CompiledScript): StrategyConfig {
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
  };
}

/**
 * Owns everything strategy-specific: backtest config, execution, result and chart overlays.
 * Deliberately separate from the indicator pipeline's state (section 27) — an indicator run
 * touches none of this, and leaving strategy mode simply clears it.
 */
export function useStrategy({
  candles,
  rendererRef,
  chartRef,
  symbol,
  timeframe,
  log,
}: UseStrategyArgs): UseStrategyResult {
  const [status, setStatus] = useState<StrategyStatus>('idle');
  const [result, setResult] = useState<StrategyExecutionResult | null>(null);
  const [error, setError] = useState<StrategyError | null>(null);
  const [config, setConfigState] = useState<StrategyConfig>(DEFAULT_STRATEGY_CONFIG);
  const [visibility, setVisibility] = useState<StrategyVisibility>(DEFAULT_VISIBILITY);
  const [selectedTradeIndex, setSelectedTradeIndex] = useState<number | null>(null);
  const [markersByTime, setMarkersByTime] = useState<Map<number, MarkerInfo[]>>(new Map());

  const cache = useMemo(() => new StrategyCache(), []);
  const runSeqRef = useRef(0);
  const configRef = useRef(config);
  const visibilityRef = useRef(visibility);
  const resultRef = useRef(result);
  const selectedRef = useRef(selectedTradeIndex);
  const headerConfigRef = useRef<StrategyConfig>(DEFAULT_STRATEGY_CONFIG);
  /** What `execute` was last called with, so a settings change can replay it. */
  const lastRunRef = useRef<{ compiled: CompiledScript; source: string; inputs: InputValues } | null>(null);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candlesRef = useRef(candles);

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);
  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    selectedRef.current = selectedTradeIndex;
  }, [selectedTradeIndex]);

  const applyOverlays = useCallback(
    (next: StrategyExecutionResult | null, vis: StrategyVisibility, selected: number | null) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      if (!next) {
        renderer.setStrategyMarkers([]);
        renderer.setPositionBackground(null);
        setMarkersByTime(new Map());
        return;
      }
      const { markers, byTime } = buildStrategyMarkers(next.trades, next.openPosition, vis, selected);
      renderer.setStrategyMarkers(markers);
      renderer.setPositionBackground(
        vis.positionBackground ? buildPositionBackground(next.positions.map((p) => p.direction)) : null,
      );
      setMarkersByTime(byTime);
    },
    [rendererRef],
  );

  const runNow = useCallback(
    async (compiled: CompiledScript, source: string, inputs: InputValues, reveal: boolean): Promise<void> => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      const seq = ++runSeqRef.current;
      setStatus('running');
      setError(null);

      const activeConfig = configRef.current;
      const key = cacheKey({
        source,
        symbol,
        timeframe,
        candles: candlesRef.current,
        config: activeConfig,
        inputs,
      });

      let outcome = cache.get(key);
      const cached = outcome !== undefined;
      if (!outcome) {
        outcome = await executeStrategy({
          compiled,
          candles: candlesRef.current,
          inputs,
          config: activeConfig,
          symbol,
          timeframe,
          source,
        });
        if (!outcome.error) cache.set(key, outcome);
      }
      if (seq !== runSeqRef.current) return;

      if (outcome.error || !outcome.result) {
        setStatus('error');
        setError(outcome.error ?? { heading: 'Strategy Error', message: 'The backtest produced no result.' });
        setResult(null);
        applyOverlays(null, visibilityRef.current, null);
        log('error', outcome.error?.heading ?? 'Strategy Error', outcome.error?.message ?? 'No result.');
        return;
      }

      // A single state commit per run — the engine loop never touches React (section 29).
      if (outcome.outputs) {
        renderer.render(outcome.outputs, outcome.drawings, outcome.candles, compiled.metadata.overlay, reveal);
      }
      setResult(outcome.result);
      setStatus('success');
      setSelectedTradeIndex(null);
      applyOverlays(outcome.result, visibilityRef.current, null);

      const summary = outcome.result.summary;
      log(
        'info',
        'Backtest',
        `${outcome.result.barCount} bars · ${summary.totalTrades} trades · net ${summary.netProfit.toFixed(2)} · ${
          cached ? 'cached' : `${outcome.result.elapsedMs.toFixed(1)}ms`
        }`,
      );
    },
    [applyOverlays, cache, log, rendererRef, symbol, timeframe],
  );

  const execute = useCallback(
    async (compiled: CompiledScript, source: string, inputs: InputValues, reveal: boolean): Promise<void> => {
      const header = configFromHeader(compiled);
      // Adopt the script's own header settings when they change (a different strategy, or the
      // user edited the declaration) — but never stomp settings the user has since typed in.
      if (JSON.stringify(header) !== JSON.stringify(headerConfigRef.current)) {
        headerConfigRef.current = header;
        configRef.current = header;
        setConfigState(header);
      }
      lastRunRef.current = { compiled, source, inputs };
      await runNow(compiled, source, inputs, reveal);
    },
    [runNow],
  );

  /** Settings edits re-run the existing compiled script; no recompile, debounced while typing. */
  const setConfig = useCallback(
    (patch: Partial<StrategyConfig>) => {
      setConfigState((prev) => {
        const next = { ...prev, ...patch };
        configRef.current = next;
        return next;
      });
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
      configDebounceRef.current = setTimeout(() => {
        const last = lastRunRef.current;
        if (last) void runNow(last.compiled, last.source, last.inputs, false);
      }, CONFIG_DEBOUNCE_MS);
    },
    [runNow],
  );

  const resetConfig = useCallback(() => {
    setConfig(headerConfigRef.current);
  }, [setConfig]);

  const toggleVisibility = useCallback(
    (key: keyof StrategyVisibility) => {
      setVisibility((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        visibilityRef.current = next;
        applyOverlays(resultRef.current, next, selectedRef.current);
        if (key === 'plots') rendererRef.current?.setPlotsVisible(next.plots);
        return next;
      });
    },
    [applyOverlays, rendererRef],
  );

  /** Selecting a trade highlights its markers and scrolls the chart onto it. */
  const selectTrade = useCallback(
    (index: number | null) => {
      setSelectedTradeIndex(index);
      selectedRef.current = index;
      const current = resultRef.current;
      applyOverlays(current, visibilityRef.current, index);
      if (index === null || !current) return;

      const trade = current.trades.find((t) => t.index === index);
      const timeScale = chartRef.current?.timeScale();
      if (!trade || !timeScale) return;
      timeScale.setVisibleLogicalRange({
        from: trade.entryBarIndex - FOCUS_PADDING_BARS,
        to: trade.exitBarIndex + FOCUS_PADDING_BARS,
      });
    },
    [applyOverlays, chartRef],
  );

  const clear = useCallback(() => {
    runSeqRef.current += 1;
    lastRunRef.current = null;
    setStatus('idle');
    setResult(null);
    setError(null);
    setSelectedTradeIndex(null);
    applyOverlays(null, visibilityRef.current, null);
  }, [applyOverlays]);

  useEffect(
    () => () => {
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
    },
    [],
  );

  // Stable identity: `usePineScript`'s callbacks close over this object, and a fresh one every
  // render would invalidate them (and every memoized panel) on each keystroke.
  return useMemo(
    () => ({
      status,
      result,
      error,
      config,
      setConfig,
      resetConfig,
      visibility,
      toggleVisibility,
      selectedTradeIndex,
      selectTrade,
      markersByTime,
      execute,
      clear,
    }),
    [
      status,
      result,
      error,
      config,
      setConfig,
      resetConfig,
      visibility,
      toggleVisibility,
      selectedTradeIndex,
      selectTrade,
      markersByTime,
      execute,
      clear,
    ],
  );
}
