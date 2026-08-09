import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bar, CompiledScript } from '@heyphat/piner';
import { compileScript, runScript } from '../lib/pineRunner';
import { resetToDefaults, toIndicatorInputs, toInputValues } from '../lib/inputSchema';
import type { PlotRenderer } from '../lib/plotRenderer';
import type { Candle, ConsoleEntry, ConsoleLevel } from '../types/candle';
import type { IndicatorInput, InputValue } from '../types/inputs';

const SYMBOL = 'ADBL';
const TIMEFRAME = 'D';
const INPUT_DEBOUNCE_MS = 120;
const MAX_CONSOLE_ENTRIES = 200;

interface UsePineScriptArgs {
  candles: Candle[];
  bars: Bar[];
  ready: boolean;
  rendererRef: React.RefObject<PlotRenderer | null>;
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
}

const DEFAULT_SCRIPT = `//@version=5
indicator("Moving Averages", overlay=true)

sma20 = ta.sma(close,20)
ema50 = ta.ema(close,50)

plot(sma20, color=color.red)
plot(ema50, color=color.green)
`;

/** Builds the console summary line for a completed run. */
function summarize(bars: number, plots: number, drawings: number, elapsedMs: string): string {
  const parts = [`${bars} bars`, `${plots} plots`];
  if (drawings > 0) parts.push(`${drawings} drawings`);
  parts.push(`${elapsedMs}ms`);
  return parts.join(' · ');
}

/** Compile/run state machine. Recompiles only on Run; input changes re-run without recompiling. */
export function usePineScript({ candles, bars, ready, rendererRef }: UsePineScriptArgs): UsePineScriptResult {
  const [source, setSource] = useState(DEFAULT_SCRIPT);
  const [isRunning, setIsRunning] = useState(false);
  const [inputs, setInputs] = useState<IndicatorInput[]>([]);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [title, setTitle] = useState('');
  const [overlay, setOverlay] = useState(true);

  const compiledRef = useRef<CompiledScript | null>(null);
  const inputsRef = useRef<IndicatorInput[]>([]);
  const hasAutoRunRef = useRef(false);
  const runSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);

  const log = useCallback((level: ConsoleLevel, heading: string, message: string, line?: number, col?: number) => {
    setEntries((prev) => {
      const next = [...prev, { id: prev.length > 0 ? prev[prev.length - 1].id + 1 : 0, level, heading, message, line, col }];
      return next.length > MAX_CONSOLE_ENTRIES ? next.slice(next.length - MAX_CONSOLE_ENTRIES) : next;
    });
  }, []);

  /** Full pipeline: compile -> build input schema -> run -> render. Triggered by Run. */
  const run = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || bars.length === 0) return;

    const seq = ++runSeqRef.current;
    setIsRunning(true);

    const outcome = compileScript(source);
    if (outcome.error) {
      log('error', outcome.error.heading, outcome.error.message, outcome.error.line, outcome.error.col);
      setIsRunning(false);
      return;
    }
    for (const diag of outcome.diagnostics) {
      if (diag.severity === 'warning') log('warning', 'Compilation Warning', diag.message, diag.line, diag.col);
    }

    const compiled = outcome.compiled!;
    compiledRef.current = compiled;
    setTitle(compiled.metadata.title);
    setOverlay(compiled.metadata.overlay);

    const nextInputs = toIndicatorInputs(compiled.metadata.inputs, inputsRef.current);
    setInputs(nextInputs);

    const startedAt = performance.now();
    runScript(compiled, bars, toInputValues(nextInputs), { symbol: SYMBOL, timeframe: TIMEFRAME })
      .then((result) => {
        if (seq !== runSeqRef.current) return;
        setIsRunning(false);
        if (result.error) {
          log('error', result.error.heading, result.error.message);
          return;
        }
        const outputs = result.outputs!;
        renderer.clear();
        renderer.render(outputs, result.drawings, candles, compiled.metadata.overlay, true);
        const elapsed = (performance.now() - startedAt).toFixed(1);
        log('info', 'Run', summarize(bars.length, outputs.plots.size, result.drawings.length, elapsed));

        // A script whose every plot is `display.none` and which draws nothing renders an
        // empty chart even though it ran correctly — say so rather than leave it a mystery.
        const visiblePlots = [...outputs.plots.values()].filter((p) => p.options.display !== 'none').length;
        const hasFills = [...outputs.fills.values()].some((f) => f.color || f.colors.some(Boolean));
        const hasBackground = [...outputs.bgColors.values()].some((layer) => layer.some(Boolean));
        if (
          visiblePlots === 0 &&
          !hasFills &&
          !hasBackground &&
          result.drawings.length === 0 &&
          outputs.hlines.size === 0 &&
          outputs.markers.size === 0 &&
          outputs.candles.size === 0
        ) {
          log('warning', 'Nothing drawn', 'The script produced no visible output (all plots are display.none).');
        }
      })
      .catch((err: unknown) => {
        if (seq !== runSeqRef.current) return;
        setIsRunning(false);
        log('error', 'Runtime Error', err instanceof Error ? err.message : String(err));
      });
  }, [bars, candles, log, rendererRef, source]);

  /** Re-runs the already-compiled script with new input values, reconciling series in place. */
  const runWithCurrentInputs = useCallback(() => {
    const renderer = rendererRef.current;
    const compiled = compiledRef.current;
    if (!renderer || !compiled || bars.length === 0) return;

    const seq = ++runSeqRef.current;
    runScript(compiled, bars, toInputValues(inputsRef.current), { symbol: SYMBOL, timeframe: TIMEFRAME })
      .then((result) => {
        if (seq !== runSeqRef.current) return;
        if (result.error) {
          log('error', result.error.heading, result.error.message);
          return;
        }
        renderer.render(result.outputs!, result.drawings, candles, compiled.metadata.overlay);
      })
      .catch((err: unknown) => {
        if (seq !== runSeqRef.current) return;
        log('error', 'Runtime Error', err instanceof Error ? err.message : String(err));
      });
  }, [bars, candles, log, rendererRef]);

  const scheduleRerun = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(runWithCurrentInputs, INPUT_DEBOUNCE_MS);
  }, [runWithCurrentInputs]);

  const setInputValue = useCallback(
    (id: string, value: InputValue) => {
      setInputs((prev) => prev.map((input) => (input.id === id ? { ...input, value } : input)));
      scheduleRerun();
    },
    [scheduleRerun],
  );

  const resetInputs = useCallback(() => {
    setInputs((prev) => resetToDefaults(prev));
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

  return { source, setSource, run, isRunning, inputs, setInputValue, resetInputs, entries, title, overlay };
}
