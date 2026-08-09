import {
  ArrayFeed,
  CompileError,
  Engine,
  LexError,
  ParseError,
  compile,
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

/** Compiles Pine source. Never throws — all failures are normalized into `error`. */
export function compileScript(source: string): CompileOutcome {
  try {
    const compiled = compile(source);
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
