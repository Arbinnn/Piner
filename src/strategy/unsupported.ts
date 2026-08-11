import { ExecutionContext, tokenize } from '@heyphat/piner';

export interface UnsupportedFeature {
  /** e.g. `strategy.someFeature`. */
  name: string;
  line: number;
  col: number;
}

let supportedMembers: Set<string> | null = null;

/**
 * The `strategy.*` members the INSTALLED piner actually implements, read off the runtime
 * namespace itself rather than kept as a hand-written list — so upgrading piner widens what
 * the app accepts automatically, and nothing here can drift out of date.
 */
function membersOfStrategyNamespace(): Set<string> {
  if (!supportedMembers) {
    supportedMembers = new Set(Object.keys(new ExecutionContext().strategy));
  }
  return supportedMembers;
}

/**
 * `strategy.*` members this engine does not implement.
 *
 * This matters because an unknown member is NOT a compile error in piner — it evaluates to
 * `undefined` and the call silently does nothing, which would show the user a clean backtest
 * that quietly ignored half their orders. Reporting it up front is the difference between an
 * honest "unsupported" message and a fake result (section 26).
 *
 * Scanning tokens rather than source text keeps comments and string literals out of it.
 * Nested access (`strategy.closedtrades.profit`) is judged on its first level, which is what
 * the compiler dispatches on.
 */
export function findUnsupportedStrategyCalls(source: string): UnsupportedFeature[] {
  let tokens;
  try {
    tokens = tokenize(source).tokens;
  } catch {
    // Unparseable source is the compiler's error to report, not ours.
    return [];
  }

  const supported = membersOfStrategyNamespace();
  const found: UnsupportedFeature[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tokens.length - 2; i += 1) {
    const [head, dot, member] = [tokens[i], tokens[i + 1], tokens[i + 2]];
    if (String(head.kind) !== 'Ident' || head.value !== 'strategy') continue;
    if (dot.value !== '.' || String(member.kind) !== 'Ident') continue;
    if (supported.has(member.value)) continue;

    const name = `strategy.${member.value}`;
    if (seen.has(name)) continue;
    seen.add(name);
    found.push({ name, line: member.line, col: member.col });
  }
  return found;
}

/** Human-readable body for the error panel. */
export function describeUnsupported(features: readonly UnsupportedFeature[]): string {
  const list = features.map((f) => `  ${f.name}  (line ${f.line})`).join('\n');
  return `This strategy uses:\n${list}\n\nThose features are not supported by the execution engine, and calls to them would be silently ignored — the backtest was not run.`;
}
