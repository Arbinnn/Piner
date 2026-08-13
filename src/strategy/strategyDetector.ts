import type { PineScriptType } from './types';

const DECLARATIONS: Record<string, PineScriptType> = {
  indicator: 'indicator',
  study: 'indicator',
  strategy: 'strategy',
};

/**
 * Which mode a source is in, from the editor text alone.
 *
 * This is a GUESS, used only to decide whether to offer the Strategy Tester tab before the
 * first Run; `ExecuteResponse.meta.isStrategy` from the backend is the authority afterwards.
 *
 * It used to parse the source with piner to answer exactly, but Pine no longer runs in the
 * browser at all — so the check is the line-anchored form the parser path already fell back to
 * while the user was mid-keystroke. A bare substring search would not do: `strategy` appears as
 * `strategy.entry(...)`, in comments and inside strings in plenty of indicators, and any of
 * those would flip the UI into the wrong mode. Requiring a line to START with the declaration
 * call excludes all three.
 */
export function detectPineScriptType(source: string): PineScriptType {
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('//')) continue;
    const match = /^(indicator|strategy|study)\s*\(/.exec(line);
    if (match) return DECLARATIONS[match[1]];
  }
  return 'unknown';
}
