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
import { unwrapSelfSecurity } from './security.ts';
import { rewriteConditionalUdtHistory } from './udtHistory.ts';

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

/**
 * Rewrites the Pine v3/v4 `study(...)` declaration to `indicator(...)`.
 *
 * The engine only recognizes `indicator`/`strategy`, and an unrecognized declaration is not an
 * error — the call simply does nothing. Every header field is then lost at once: the title is
 * `""`, `overlay` defaults to false (so an overlay script lands on a separate pane), and
 * `max_lines_count` / `max_labels_count` / `max_boxes_count` fall back to Pine's default of 50.
 * LuxAlgo's Volume Profile declares `max_lines_count=500` and draws 201 lines; unrewritten it
 * produced 50, on the wrong pane, with no title.
 *
 * The two declarations share their first three positional parameters (title, shorttitle,
 * overlay), so the swap is safe. `indicator` is four characters longer, so diagnostics on the
 * declaration line report columns shifted by four — the only place in this file where a rewrite
 * does not preserve them, and worth it for a header that would otherwise be discarded entirely.
 */
function rewriteStudyToIndicator(source: string): string {
  let tokens;
  try {
    tokens = tokenize(source).tokens;
  } catch {
    return source;
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (String(t.kind) !== 'Ident' || t.value !== 'study') continue;
    // A member access (`foo.study`) or a bare reference is not the declaration.
    if (tokens[i - 1]?.value === '.' || tokens[i + 1]?.value !== '(') continue;

    const lines = source.split('\n');
    const idx = t.col - 1;
    const line = lines[t.line - 1];
    lines[t.line - 1] = `${line.slice(0, idx)}indicator${line.slice(idx + 'study'.length)}`;
    return lines.join('\n');
  }
  return source;
}

/**
 * Renames a user variable named `color`, which this engine cannot tell apart from the `color.*`
 * namespace: its symbol resolver checks locals before NAMESPACES, so one `color = trend ? a : b`
 * makes every later `color.new(...)` resolve against the variable and evaluate to `na` — the
 * script compiles clean and renders with no colours at all. TradingView allows the shadowing
 * (`color` is a type keyword, not a reserved word) and still routes `color.` to the namespace,
 * so published scripts use it freely. The replacement is the same length as `color`, leaving
 * every diagnostic column untouched.
 */
function rewriteShadowedColor(source: string): string {
  let tokens;
  try {
    tokens = tokenize(source).tokens;
  } catch {
    return source;
  }

  /** True when the token begins a statement, i.e. is an assignment target rather than an argument name. */
  const isStatementStart = (i: number): boolean => {
    const prev = tokens[i - 1];
    return !prev || String(prev.kind) === 'Newline' || prev.value === 'var' || prev.value === 'varip';
  };

  const declaresColor = tokens.some(
    (t, i) =>
      t.value === 'color' &&
      isStatementStart(i) &&
      (tokens[i + 1]?.value === '=' || tokens[i + 1]?.value === ':='),
  );
  if (!declaresColor) return source;

  const taken = new Set(tokens.filter((t) => String(t.kind) === 'Ident').map((t) => t.value));
  let name = '_clr_';
  for (let n = 1; taken.has(name); n += 1) name = `_clr${n}`;

  const perLine = new Map<number, number[]>();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.value !== 'color') continue;
    const next = tokens[i + 1];
    // `color.new(...)` — the namespace, which must keep resolving as one.
    if (next?.value === '.') continue;
    // `color c = na` — a type annotation, not a reference to the variable.
    if (String(next?.kind) === 'Ident') continue;
    // `plot(x, color = ...)` — a named argument's key, which the callee matches by name.
    if (next?.value === '=' && !isStatementStart(i)) continue;
    perLine.set(t.line, [...(perLine.get(t.line) ?? []), t.col]);
  }
  if (perLine.size === 0) return source;

  const lines = source.split('\n');
  for (const [lineNo, cols] of perLine) {
    let line = lines[lineNo - 1];
    for (const col of cols) {
      const idx = col - 1;
      line = `${line.slice(0, idx)}${name}${line.slice(idx + 'color'.length)}`;
    }
    lines[lineNo - 1] = line;
  }
  return lines.join('\n');
}

/** Compiles Pine source. Never throws — all failures are normalized into `error`. */
export function compileScript(source: string): CompileOutcome {
  try {
    const patched = rewriteConditionalUdtHistory(
      unwrapSelfSecurity(rewriteShadowedColor(rewriteLegacyBuiltins(rewriteStudyToIndicator(source)))).source,
    ).source;
    const compiled = compile(patched);
    // Read from the patched source: a `study(...)` declaration is only a recognizable
    // declaration after the rewrite above.
    const overlay = positionalOverlay(patched);
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
