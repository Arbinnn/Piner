import { parse, tokenize, type ast, type CompiledScript } from '@heyphat/piner';
import type { PineScriptType } from './types';

const DECLARATIONS: Record<string, PineScriptType> = {
  indicator: 'indicator',
  study: 'indicator',
  strategy: 'strategy',
};

/**
 * Which mode a source is in, WITHOUT compiling it.
 *
 * Parses first — `strategy` appears as `strategy.entry(...)`, inside comments and inside
 * strings in plenty of indicators, so a substring search flips the UI into Strategy Tester
 * mode on scripts that are not strategies. Only a top-level `strategy(...)`/`indicator(...)`
 * CALL counts. A source that does not parse yet (the user is mid-keystroke) falls back to a
 * line-anchored regex so the mode does not flicker on every incomplete edit.
 *
 * `compiledScriptType()` is the authority once a compile succeeds.
 */
export function detectPineScriptType(source: string): PineScriptType {
  let program: ast.Program;
  try {
    program = parse(tokenize(source));
  } catch {
    return looseScriptType(source);
  }

  for (const stmt of program.body) {
    if (stmt.kind !== 'ExprStmt') continue;
    const call = stmt.expr;
    if (call.kind !== 'Call' || call.callee.kind !== 'Ident') continue;
    const type = DECLARATIONS[call.callee.name];
    if (type) return type;
  }
  return 'unknown';
}

/** Line-anchored fallback for source that does not parse (comments/strings still excluded). */
function looseScriptType(source: string): PineScriptType {
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('//')) continue;
    const match = /^(indicator|strategy|study)\s*\(/.exec(line);
    if (match) return DECLARATIONS[match[1]];
  }
  return 'unknown';
}

/** The authoritative answer for a successfully compiled script. */
export function compiledScriptType(compiled: CompiledScript): PineScriptType {
  return compiled.metadata.isStrategy ? 'strategy' : 'indicator';
}
