import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { PineApiError, executePine } from '../lib/api';
import { resetToDefaults, toIndicatorInputs, toInputValues } from '../lib/inputSchema';
import type { PlotRenderer } from '../lib/plotRenderer';
import { detectPineScriptType } from '../strategy/strategyDetector';
import type { PineScriptType, StrategyConfig } from '../strategy/types';
import { useStrategy, type UseStrategyResult } from './useStrategy';
import type { Candle, ConsoleEntry, ConsoleLevel } from '../types/candle';
import type { IndicatorInput, InputValue, InputValues } from '../types/inputs';
import { deserializeOutputs, type ExecuteResponse } from '../types/pine';

const INPUT_DEBOUNCE_MS = 120;
const MAX_CONSOLE_ENTRIES = 200;

interface UsePineScriptArgs {
  candles: Candle[];
  symbol: string;
  timeframe: string;
  ready: boolean;
  rendererRef: React.RefObject<PlotRenderer | null>;
  chartRef: React.RefObject<IChartApi | null>;
}

interface UsePineScriptResult {
  source: string;
  setSource: (source: string) => void;
  run: () => void;
  isRunning: boolean;
  inputs: IndicatorInput[];
  setInputValue: (id: string, value: InputValue) => void;
  resetInputs: () => void;
  entries: ConsoleEntry[];
  title: string;
  overlay: boolean;
  /** Live guess from the editor text; becomes authoritative after a successful run. */
  scriptType: PineScriptType;
  strategy: UseStrategyResult;
}

const DEFAULT_SCRIPT = `//@version=5
indicator("Moving Averages", overlay=true)

sma20 = ta.sma(close,20)
ema50 = ta.ema(close,50)

plot(sma20, color=color.red)
plot(ema50, color=color.green)
`;

/** Builds the console summary line for a completed indicator run. */
function summarize(bars: number, plots: number, drawings: number, elapsedMs: string): string {
  const parts = [`${bars} bars`, `${plots} plots`];
  if (drawings > 0) parts.push(`${drawings} drawings`);
  parts.push(`${elapsedMs}ms`);
  return parts.join(' · ');
}

/**
 * Whether every override the request carried survived into the new input schema.
 *
 * Only keys present on BOTH sides count. A key the schema added (a default the request left
 * implicit) changes nothing, and a key the schema dropped is an override for an input the
 * script no longer has — neither can make the chart disagree with the panel.
 */
function inputsHonored(sent: InputValues, effective: InputValues): boolean {
  return Object.keys(sent).every((key) => !(key in effective) || Object.is(sent[key], effective[key]));
}

/**
 * The frontend's whole Pine pipeline: send the script, draw what comes back.
 *
 * No compiling, no engine, no indicator maths happens here — `POST /api/pine/execute` returns
 * finished plot/drawing/backtest data and this hook does nothing but hand it to the renderer
 * and keep the panels in sync.
 */
export function usePineScript({
  candles,
  symbol,
  timeframe,
  ready,
  rendererRef,
  chartRef,
}: UsePineScriptArgs): UsePineScriptResult {
  const [source, setSource] = useState(DEFAULT_SCRIPT);
  const [isRunning, setIsRunning] = useState(false);
  const [inputs, setInputs] = useState<IndicatorInput[]>([]);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [title, setTitle] = useState('');
  const [overlay, setOverlay] = useState(true);
  /** The backend's verdict, tagged with the source it describes. */
  const [executedType, setExecutedType] = useState<{ source: string; type: PineScriptType } | null>(null);

  const inputsRef = useRef<IndicatorInput[]>([]);
  const sourceRef = useRef(source);
  const candlesRef = useRef(candles);
  const hasAutoRunRef = useRef(false);
  const runSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Late-bound so `useStrategy` can trigger a run that is defined further down. */
  const rerunRef = useRef<(overrides: Partial<StrategyConfig>) => void>(() => {});
  /** The same indirection for `execute`'s one self-call (the input-schema correction). */
  const executeRef = useRef<(fresh: boolean, overrides: Partial<StrategyConfig>, inputs: InputValues) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);
  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  /**
   * Editor-text guess, so the UI can offer Strategy Tester before the first Run. The backend's
   * verdict wins, but only for the exact source it came from — once the user types, the live
   * detection takes over rather than advertising a stale mode.
   */
  const detectedType = useMemo(() => detectPineScriptType(source), [source]);
  const scriptType = executedType?.source === source ? executedType.type : detectedType;
  const scriptTypeRef = useRef(scriptType);
  useEffect(() => {
    scriptTypeRef.current = scriptType;
  }, [scriptType]);

  const log = useCallback((level: ConsoleLevel, heading: string, message: string, line?: number, col?: number) => {
    setEntries((prev) => {
      const next = [...prev, { id: prev.length > 0 ? prev[prev.length - 1].id + 1 : 0, level, heading, message, line, col }];
      return next.length > MAX_CONSOLE_ENTRIES ? next.slice(next.length - MAX_CONSOLE_ENTRIES) : next;
    });
  }, []);

  const strategy = useStrategy({
    rendererRef,
    chartRef,
    rerun: useCallback((next: Partial<StrategyConfig>) => rerunRef.current(next), []),
  });

  /** The bars a response was computed over — the renderer indexes plot data against these. */
  const executedCandles = useCallback(
    (range: ExecuteResponse['range']): Candle[] => candlesRef.current.slice(range.start, range.end + 1),
    [],
  );

  /**
   * A script whose every plot is `display.none` and which draws nothing renders an empty chart
   * even though it ran correctly — say so rather than leave it a mystery.
   */
  const warnIfBlank = useCallback(
    (response: ExecuteResponse, outputs: ReturnType<typeof deserializeOutputs>) => {
      const visiblePlots = [...outputs.plots.values()].filter((p) => p.options.display !== 'none').length;
      const hasFills = [...outputs.fills.values()].some(
        (f) => f.color || f.colors.some(Boolean) || f.gradient?.topColor.some(Boolean) || f.gradient?.bottomColor.some(Boolean),
      );
      const hasBackground = [...outputs.bgColors.values()].some((layer) => layer.some(Boolean));
      if (
        visiblePlots === 0 &&
        !hasFills &&
        !hasBackground &&
        response.drawings.length === 0 &&
        outputs.hlines.size === 0 &&
        outputs.markers.size === 0 &&
        outputs.candles.size === 0
      ) {
        log('warning', 'Nothing drawn', 'The script produced no visible output (all plots are display.none).');
      }
    },
    [log],
  );

  /**
   * One request, one repaint.
   *
   * `fresh` marks a Run (as opposed to an input/settings-driven re-run): it tears the chart
   * down first and lets the renderer scroll to off-screen drawings, where a re-run must leave
   * the user's zoom exactly where it was.
   */
  const execute = useCallback(
    async (fresh: boolean, overrides: Partial<StrategyConfig>, sentInputs: InputValues): Promise<void> => {
      const renderer = rendererRef.current;
      if (!renderer || candlesRef.current.length === 0) return;

      const seq = ++runSeqRef.current;
      setIsRunning(true);
      const requestSource = sourceRef.current;
      // Strategy mode is known from the editor text before the response lands, so the tester
      // panel can show "running" for the whole round trip rather than only the tail of it.
      const strategyMode = scriptTypeRef.current === 'strategy';
      if (strategyMode) strategy.markRunning();

      let response: ExecuteResponse;
      try {
        response = await executePine({
          script: requestSource,
          symbol,
          timeframe,
          inputs: sentInputs,
          bars: candlesRef.current.length,
          strategy: overrides,
        });
      } catch (err) {
        if (seq !== runSeqRef.current) return;
        setIsRunning(false);
        const pine =
          err instanceof PineApiError ? err.pine : { heading: 'Runtime Error', message: err instanceof Error ? err.message : String(err) };
        log('error', pine.heading, pine.message, pine.line, pine.col);
        if (strategyMode) strategy.fail(pine);
        return;
      }
      if (seq !== runSeqRef.current) return;
      setIsRunning(false);

      for (const diag of response.diagnostics) {
        // A diagnostic with no source position (line 0) is about the run as a whole, not a
        // token — printing "0:0" in front of it just looks like a bug.
        if (diag.severity === 'warning') {
          const positioned = diag.line > 0;
          log('warning', 'Compilation Warning', diag.message, positioned ? diag.line : undefined, positioned ? diag.col : undefined);
        }
      }

      const { meta } = response;
      setTitle(meta.title);
      setOverlay(meta.overlay);
      setExecutedType({ source: requestSource, type: meta.isStrategy ? 'strategy' : 'indicator' });

      const nextInputs = toIndicatorInputs(meta.inputs, inputsRef.current);
      inputsRef.current = nextInputs;
      setInputs(nextInputs);

      const outputs = deserializeOutputs(response.outputs);
      if (fresh) renderer.clear();
      renderer.render(outputs, response.drawings, executedCandles(response.range), meta.overlay, fresh);

      if (response.strategy) {
        strategy.apply(response);
        const summary = response.strategy.summary;
        log(
          'info',
          'Backtest',
          `${response.strategy.barCount} bars · ${summary.totalTrades} trades · net ${summary.netProfit.toFixed(2)} · ${
            response.cached ? 'cached' : `${response.elapsedMs.toFixed(1)}ms`
          }`,
        );
      } else {
        strategy.clear();
        log(
          'info',
          'Run',
          summarize(response.barCount, outputs.plots.size, response.drawings.length, response.elapsedMs.toFixed(1)),
        );
        warnIfBlank(response, outputs);
      }

      // The request had to be sent before the input schema was known, so a value carried over
      // from the previous script may not have survived it (a key whose kind changed falls back
      // to its default). Re-run only when that actually happened, so the chart can never
      // disagree with the panel — and so the common case stays a single round trip.
      const effective = toInputValues(nextInputs);
      if (!inputsHonored(sentInputs, effective)) {
        void executeRef.current(false, overrides, effective);
      }
    },
    [executedCandles, log, rendererRef, strategy, symbol, timeframe, warnIfBlank],
  );

  useEffect(() => {
    executeRef.current = execute;
  }, [execute]);

  /** Full pipeline, triggered by Run. */
  const run = useCallback(() => {
    void execute(true, strategy.overrides, toInputValues(inputsRef.current));
  }, [execute, strategy.overrides]);

  /** Re-runs the current script with new input values, reconciling series in place. */
  const runWithCurrentInputs = useCallback(() => {
    void execute(false, strategy.overrides, toInputValues(inputsRef.current));
  }, [execute, strategy.overrides]);

  // Backtest settings changed: same script, same inputs, new broker settings.
  useEffect(() => {
    rerunRef.current = (next: Partial<StrategyConfig>) => {
      strategy.markRunning();
      void execute(false, next, toInputValues(inputsRef.current));
    };
  }, [execute, strategy]);

  const scheduleRerun = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(runWithCurrentInputs, INPUT_DEBOUNCE_MS);
  }, [runWithCurrentInputs]);

  const setInputValue = useCallback(
    (id: string, value: InputValue) => {
      setInputs((prev) => {
        const next = prev.map((input) => (input.id === id ? { ...input, value } : input));
        inputsRef.current = next;
        return next;
      });
      scheduleRerun();
    },
    [scheduleRerun],
  );

  const resetInputs = useCallback(() => {
    setInputs((prev) => {
      const next = resetToDefaults(prev);
      inputsRef.current = next;
      return next;
    });
    scheduleRerun();
  }, [scheduleRerun]);

  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (ready && !hasAutoRunRef.current) {
      hasAutoRunRef.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return {
    source,
    setSource,
    run,
    isRunning,
    inputs,
    setInputValue,
    resetInputs,
    entries,
    title,
    overlay,
    scriptType,
    strategy,
  };
}
