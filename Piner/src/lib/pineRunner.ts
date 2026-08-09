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
} from '@heyphat/piner';
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

export interface RunOutcome {
  outputs: OutputCollector | null;
  /** Live drawing objects (box/line/label/…) — the visual output of most published indicators. */
  drawings: readonly DrawObject[];
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

/** Compiles Pine source. Never throws — all failures are normalized into `error`. */
export function compileScript(source: string): CompileOutcome {
  try {
    const compiled = compile(source);
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
  opts: { symbol: string; timeframe: string },
): Promise<RunOutcome> {
  try {
    const engine = new Engine(compiled, new ArrayFeed(bars), {
      historySlotCount: compiled.metadata.historySlotCount,
      inputs,
    });
    await engine.run({ symbol: opts.symbol, timeframe: opts.timeframe });
    return { outputs: engine.outputs, drawings: engine.drawings, error: null };
  } catch (err) {
    return {
      outputs: null,
      drawings: [],
      error: {
        heading: 'Runtime Error',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
