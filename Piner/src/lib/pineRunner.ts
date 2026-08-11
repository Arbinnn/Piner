import {
  ArrayFeed,
  CompileError,
  Engine,
  LexError,
  ParseError,
  compile,
  parse,
  tokenize,
  type ast,
  type Bar,
  type CompiledScript,
  type Diagnostic,
  type DrawObject,
  type OutputCollector,
  type StrategyMetrics,
  type StrategyReport,
  type StrategySettings,
} from '@heyphat/piner';
import type { OpenLotSnapshot } from '../strategy/strategyAdapter';
import type { InputValues } from '../types/inputs';

export interface PineError {
  heading: 'Compilation Error' | 'Runtime Error';
  message: string;
  line?: number;
  col?: number;
}

export interface CompileOutcome {
  compiled: CompiledScript | null;
  diagnostics: Diagnostic[];
  error: PineError | null;
}

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

/** `indicator(title, shorttitle, overlay, …)` and `strategy(…)` — overlay is the 3rd positional. */
const OVERLAY_ARG_INDEX = 2;
const DECLARATION_FNS = new Set(['indicator', 'strategy']);

/**
 * Recovers `overlay` when it is passed positionally.
 *
 * `compile()` reads only the NAMED `overlay=` argument, so `indicator("T", "S", true)` —
 * how a lot of published scripts declare it — compiles with `overlay: false`. The renderer
 * then puts the script on a separate pane, whose host is a whitespace-only series that never
 * joins a price scale, and every plot and drawing silently fails to place. A script that
 * draws hundreds of boxes and labels renders a blank chart with no error.
 *
 * Returns `null` when the source says nothing positionally, leaving the compiler's value
 * (which is correct for the named form) alone.
 */
function positionalOverlay(source: string): boolean | null {
  let program: ast.Program;
  try {
    program = parse(tokenize(source));
  } catch {
    return null;
  }

  for (const stmt of program.body) {
    if (stmt.kind !== 'ExprStmt') continue;
    const call = stmt.expr;
    if (call.kind !== 'Call' || call.callee.kind !== 'Ident') continue;
    if (!DECLARATION_FNS.has(call.callee.name)) continue;

    const positional = call.args.filter((arg) => arg.name === undefined);
    const overlay = positional[OVERLAY_ARG_INDEX]?.value;
    return overlay?.kind === 'Bool' ? overlay.value : null;
  }
  return null;
}

/**
 * Pine v3/v4 bare math builtins (`sqrt(x)`, `abs(x)`, …) that only exist under the `math.`
 * namespace in this engine — the same set v5 renamed. Piner has no fallback for the bare
 * form: an unresolved call is not a compile error, it silently evaluates to `na` (section 26
 * again, just for math instead of `strategy.*`). A v4 script computing a standard deviation
 * with `sqrt()` compiles clean and quietly plots nothing.
 */
const LEGACY_MATH_FNS = new Set([
  'abs', 'acos', 'asin', 'atan', 'avg', 'ceil', 'cos', 'exp', 'floor',
  'log', 'log10', 'max', 'min', 'pow', 'round', 'sign', 'sin', 'sqrt', 'tan',
]);

/**
 * Rewrites bare legacy math calls to `math.<fn>(...)` in place, preserving every other
 * character (including column numbers up to the rewrite point) so diagnostics still land on
 * the right line. Only touches an identifier that is both NOT already namespaced (preceding
 * token isn't `.`) and IS actually called (next token is `(`) — a script's own variable named
 * `sign` or `round` is left alone.
 */
function rewriteLegacyMathFns(source: string): string {
  let tokens;
  try {
    tokens = tokenize(source).tokens;
  } catch {
    return source;
  }

  const perLine = new Map<number, Array<{ col: number; len: number }>>();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (String(t.kind) !== 'Ident' || !LEGACY_MATH_FNS.has(t.value)) continue;
    if (tokens[i - 1]?.value === '.') continue;
    if (tokens[i + 1]?.value !== '(') continue;
    const spots = perLine.get(t.line) ?? [];
    spots.push({ col: t.col, len: t.value.length });
    perLine.set(t.line, spots);
  }
  if (perLine.size === 0) return source;

  const lines = source.split('\n');
  for (const [lineNo, spots] of perLine) {
    let line = lines[lineNo - 1];
    // Rightmost first so an earlier insertion doesn't shift a later spot's column.
    spots.sort((a, b) => b.col - a.col);
    for (const { col, len } of spots) {
      const idx = col - 1;
      line = `${line.slice(0, idx)}math.${line.slice(idx, idx + len)}${line.slice(idx + len)}`;
    }
    lines[lineNo - 1] = line;
  }
  return lines.join('\n');
}

/** Compiles Pine source. Never throws — all failures are normalized into `error`. */
export function compileScript(source: string): CompileOutcome {
  try {
    const patched = rewriteLegacyMathFns(source);
    const compiled = compile(patched);
    const overlay = positionalOverlay(source);
    if (overlay !== null) compiled.metadata.overlay = overlay;
    const hasError = compiled.diagnostics.some((d) => d.severity === 'error');
    if (hasError) {
      const first = compiled.diagnostics.find((d) => d.severity === 'error')!;
      return {
        compiled: null,
        diagnostics: compiled.diagnostics,
        error: {
          heading: 'Compilation Error',
          message: first.message,
          line: first.line,
          col: first.col,
        },
      };
    }
    return { compiled, diagnostics: compiled.diagnostics, error: null };
  } catch (err) {
    return { compiled: null, diagnostics: [], error: toCompileError(err) };
  }
}

function toCompileError(err: unknown): PineError {
  if (err instanceof CompileError) {
    const first = err.diagnostics[0];
    return {
      heading: 'Compilation Error',
      message: err.message,
      line: first?.line,
      col: first?.col,
    };
  }
  if (err instanceof LexError || err instanceof ParseError) {
    return {
      heading: 'Compilation Error',
      message: err.message,
      line: err.line,
      col: err.col,
    };
  }
  return {
    heading: 'Compilation Error',
    message: err instanceof Error ? err.message : String(err),
  };
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
