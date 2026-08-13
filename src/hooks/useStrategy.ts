import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi } from 'lightweight-charts';
import type { PlotRenderer } from '../lib/plotRenderer';
import type { ExecuteResponse } from '../types/pine';
import { buildPositionBackground, buildStrategyMarkers, type MarkerInfo } from '../strategy/markers';
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
  rendererRef: React.RefObject<PlotRenderer | null>;
  chartRef: React.RefObject<IChartApi | null>;
  /** Re-executes the current script on the backend with these setting overrides. */
  rerun: (overrides: Partial<StrategyConfig>) => void;
}

export interface UseStrategyResult {
  status: StrategyStatus;
  result: StrategyExecutionResult | null;
  error: StrategyError | null;
  /** The settings the last backtest actually ran with (script header + user overrides). */
  config: StrategyConfig;
  setConfig: (patch: Partial<StrategyConfig>) => void;
  resetConfig: () => void;
  visibility: StrategyVisibility;
  toggleVisibility: (key: keyof StrategyVisibility) => void;
  selectedTradeIndex: number | null;
  selectTrade: (index: number | null) => void;
  /** Bar time (seconds) -> chart marker payloads, for the hover tooltip. */
  markersByTime: Map<number, MarkerInfo[]>;
  /** Only the settings the user has edited — what the next execute request sends. */
  overrides: Partial<StrategyConfig>;
  /** Applies a backend response that carried a backtest. */
  apply: (response: ExecuteResponse) => void;
  /** Marks the run as failed, leaving the panel with the message. */
  fail: (error: StrategyError) => void;
  markRunning: () => void;
  /** Leaves strategy mode: drops the result and the chart overlays. */
  clear: () => void;
}

/**
 * Owns everything strategy-specific that survived the move to the backend: the settings the
 * user edits, the last result, and the chart overlays derived from it.
 *
 * Settings are held as a PATCH, not a whole config. The backend layers `defaults -> strategy()
 * header -> these overrides`, so editing the script's declaration takes effect on the next run
 * with no client-side bookkeeping, while a value the user typed is never silently reverted.
 */
export function useStrategy({ rendererRef, chartRef, rerun }: UseStrategyArgs): UseStrategyResult {
  const [status, setStatus] = useState<StrategyStatus>('idle');
  const [result, setResult] = useState<StrategyExecutionResult | null>(null);
  const [error, setError] = useState<StrategyError | null>(null);
  const [config, setConfigState] = useState<StrategyConfig>(DEFAULT_STRATEGY_CONFIG);
  const [overrides, setOverrides] = useState<Partial<StrategyConfig>>({});
  const [visibility, setVisibility] = useState<StrategyVisibility>(DEFAULT_VISIBILITY);
  const [selectedTradeIndex, setSelectedTradeIndex] = useState<number | null>(null);
  const [markersByTime, setMarkersByTime] = useState<Map<number, MarkerInfo[]>>(new Map());

  const visibilityRef = useRef(visibility);
  const resultRef = useRef(result);
  const selectedRef = useRef(selectedTradeIndex);
  const overridesRef = useRef(overrides);
  const configDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    selectedRef.current = selectedTradeIndex;
  }, [selectedTradeIndex]);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

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

  const markRunning = useCallback(() => {
    setStatus('running');
    setError(null);
  }, []);

  /** A single state commit per run — nothing here touches the chart series themselves. */
  const apply = useCallback(
    (response: ExecuteResponse) => {
      if (!response.strategy) return;
      if (response.strategyConfig) setConfigState(response.strategyConfig);
      setResult(response.strategy);
      setStatus('success');
      setError(null);
      setSelectedTradeIndex(null);
      applyOverlays(response.strategy, visibilityRef.current, null);
    },
    [applyOverlays],
  );

  const fail = useCallback(
    (next: StrategyError) => {
      setStatus('error');
      setError(next);
      setResult(null);
      applyOverlays(null, visibilityRef.current, null);
    },
    [applyOverlays],
  );

  /** Settings edits re-run the script on the backend; debounced while the user is typing. */
  const scheduleRerun = useCallback(
    (next: Partial<StrategyConfig>) => {
      if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
      configDebounceRef.current = setTimeout(() => rerun(next), CONFIG_DEBOUNCE_MS);
    },
    [rerun],
  );

  const setConfig = useCallback(
    (patch: Partial<StrategyConfig>) => {
      // Shown immediately so the control does not lag the keystroke; the backend's resolved
      // config replaces it when the run comes back.
      setConfigState((prev) => ({ ...prev, ...patch }));
      const next = { ...overridesRef.current, ...patch };
      overridesRef.current = next;
      setOverrides(next);
      scheduleRerun(next);
    },
    [scheduleRerun],
  );

  /** Drops every user edit, so the script's own `strategy(...)` header takes over again. */
  const resetConfig = useCallback(() => {
    overridesRef.current = {};
    setOverrides({});
    scheduleRerun({});
  }, [scheduleRerun]);

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
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current);
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
      overrides,
      apply,
      fail,
      markRunning,
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
      overrides,
      apply,
      fail,
      markRunning,
      clear,
    ],
  );
}
