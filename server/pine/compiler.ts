/**
 * Pine source -> compiled script.
 *
 * Moved from the browser unchanged (it used to be the first half of `src/lib/pineRunner.ts`),
 * so the diagnostics, the positional-`overlay` recovery and the v3/v4 builtin rewrite all
 * behave exactly as they did client-side.
 */

import {
  CompileError,
  LexError,
  ParseError,
  compile,
  parse,
  tokenize,
  type ast,
  type CompiledScript,
  type Diagnostic,
} from '@heyphat/piner';
import type { PineError } from '../../src/types/pine.ts';

export interface CompileOutcome {
  compiled: CompiledScript | null;
  diagnostics: Diagnostic[];
  error: PineError | null;
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
 * Pine v3/v4 bare builtins (`sqrt(x)`, `rma(x,14)`, `crossover(a,b)`, …) that this engine only
 * implements under a namespace (`math.`/`ta.`) — the same names v5 renamed. There is no bare
 * fallback: an unresolved call is not a compile error, it silently evaluates to `na` on every
 * bar (section 26 again). A v4 ADX/DI strategy built entirely on bare `rma`/`tr`/`highest`/
 * `change`/`crossover` compiles clean and every plot and every entry condition is dead.
 *
 * Verified empirically against the installed engine (not assumed from the Pine docs): every
 * name below returns `na` bare and a real value under its namespace, `ta.crossover` included —
 * this engine does not special-case even the classic always-bare cross/rising/falling helpers.
 */
const LEGACY_NAMESPACED_FNS: ReadonlyMap<string, string> = new Map([
  ...[
    'abs', 'acos', 'asin', 'atan', 'avg', 'ceil', 'cos', 'exp', 'floor',
    'log', 'log10', 'max', 'min', 'pow', 'round', 'sign', 'sin', 'sqrt', 'tan',
  ].map((name) => [name, 'math'] as const),
  ...[
    'accdist', 'alma', 'atr', 'barssince', 'bb', 'bbw', 'cci', 'change', 'cmo',
    'cog', 'correlation', 'cross', 'crossover', 'crossunder', 'cum', 'dev', 'dmi',
    'ema', 'falling', 'highest', 'highestbars', 'hma', 'iii', 'kc', 'kcw', 'linreg',
    'lowest', 'lowestbars', 'macd', 'median', 'mfi', 'mom', 'nvi', 'obv',
    'percentile_linear_interpolation', 'percentile_nearest_rank', 'percentrank',
    'pivot_point_levels', 'pivothigh', 'pivotlow', 'pvi', 'pvt', 'rci', 'rising',
    'rma', 'roc', 'rsi', 'sar', 'sma', 'stdev', 'stoch', 'supertrend', 'swma', 'tr',
    'tsi', 'valuewhen', 'variance', 'vwap', 'vwma', 'wad', 'wma', 'wpr', 'wvad',
  ].map((name) => [name, 'ta'] as const),
]);

/**
 * Rewrites bare legacy builtin calls to `<namespace>.<fn>(...)` in place, preserving every
 * other character (including column numbers up to the rewrite point) so diagnostics still
 * land on the right line. Only touches an identifier that is both NOT already namespaced
 * (preceding token isn't `.`) and IS actually called (next token is `(`) — a script's own
 * variable named `sign` or `range` is left alone.
 */
function rewriteLegacyBuiltins(source: string): string {
  let tokens;
  try {
    tokens = tokenize(source).tokens;
  } catch {
    return source;
  }

  const perLine = new Map<number, Array<{ col: number; len: number; ns: string }>>();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (String(t.kind) !== 'Ident') continue;
    const ns = LEGACY_NAMESPACED_FNS.get(t.value);
    if (!ns) continue;
    if (tokens[i - 1]?.value === '.') continue;
    if (tokens[i + 1]?.value !== '(') continue;
    const spots = perLine.get(t.line) ?? [];
    spots.push({ col: t.col, len: t.value.length, ns });
    perLine.set(t.line, spots);
  }
  if (perLine.size === 0) return source;

  const lines = source.split('\n');
  for (const [lineNo, spots] of perLine) {
    let line = lines[lineNo - 1];
    // Rightmost first so an earlier insertion doesn't shift a later spot's column.
    spots.sort((a, b) => b.col - a.col);
    for (const { col, len, ns } of spots) {
      const idx = col - 1;
      line = `${line.slice(0, idx)}${ns}.${line.slice(idx, idx + len)}${line.slice(idx + len)}`;
    }
    lines[lineNo - 1] = line;
  }
  return lines.join('\n');
}

/** Compiles Pine source. Never throws — all failures are normalized into `error`. */
export function compileScript(source: string): CompileOutcome {
  try {
    const patched = rewriteLegacyBuiltins(source);
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
