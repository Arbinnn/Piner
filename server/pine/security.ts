/**
 * Unwraps `request.security()` calls on the script's OWN symbol that return an OBJECT — an array,
 * matrix, map or user-defined type.
 *
 * Measured against the installed engine: a scalar comes back correctly resampled
 * (`request.security(tickerid, "W", ta.atr(l))` steps once a week, as it should), but an object
 * comes back as the live reference, identical on every bar. A script that grows an array by one
 * element per bar and reads `.size()` through the wrapper reads the FINAL size on bar 0 and on
 * every bar after it. Nothing downstream of that can be right, at any timeframe, so there is no
 * resampling to preserve and nothing is lost by dropping the wrapper.
 *
 * On TradingView, `request.security(syminfo.tickerid, "", expr, …)` IS `expr` — same symbol, same
 * timeframe, no resampling — so for the empty-timeframe case this is the identity transform. When
 * the call asked for a HIGHER timeframe the values become the chart's instead. Warned about, not
 * done silently.
 *
 * LuxAlgo's Trending Market Toolkit routes its whole pivot array through two nested self-symbol
 * wrappers. Unwrapped it draws 125 lines and boxes; wrapped it draws one — an `na` placeholder.
 *
 * Deliberately narrow, so it never touches a call it cannot reason about:
 *
 *  - the symbol argument must name this symbol (`''`, `syminfo.tickerid`, `syminfo.ticker`);
 *  - the expression must be provably object-typed (see `returnsObject`), which leaves every
 *    numeric HTF request — the kind this engine handles correctly — exactly as written;
 *  - all arguments must be positional (a named `expression =` is left alone);
 *  - the whole call must sit on one line, so unwrapping cannot change any line number.
 */

import { parse, tokenize, type ast } from '@heyphat/piner';

interface Token {
  kind: unknown;
  value: string;
  line: number;
  col: number;
}

const isIdent = (t: Token | undefined): boolean => t !== undefined && String(t.kind) === 'Ident';

const OPENERS = new Set(['(', '[']);
const CLOSERS = new Set([')', ']']);

export interface SecurityUnwrap {
  source: string;
  /** How many wrappers were dropped. */
  unwrapped: number;
}

/** Namespaces whose constructors hand back a container. */
const CONTAINER_NS = new Set(['array', 'matrix', 'map']);
const CONTAINER_FNS = new Set(['new', 'from', 'copy']);
/** `array.new_float(…)` and friends. */
const isContainerCtor = (property: string): boolean => CONTAINER_FNS.has(property) || property.startsWith('new_');

type Expr = ast.Expr;
type Stmt = ast.Stmt;

/** Everything the script declares, so a name can be followed to what it was built from. */
interface Scope {
  types: Set<string>;
  funcs: Map<string, ast.FuncDef>;
  globals: Map<string, ast.VarDecl>;
}

function collectScope(body: readonly Stmt[]): Scope {
  const scope: Scope = { types: new Set(), funcs: new Map(), globals: new Map() };
  for (const stmt of body) {
    if (stmt.kind === 'TypeDef') scope.types.add(stmt.name);
    else if (stmt.kind === 'FuncDef') scope.funcs.set(stmt.name, stmt);
    else if (stmt.kind === 'VarDecl') scope.globals.set(stmt.name, stmt);
  }
  return scope;
}

/** Declarations anywhere inside a function body, at any nesting depth. */
function localDecls(body: readonly Stmt[], into = new Map<string, ast.VarDecl>()): Map<string, ast.VarDecl> {
  for (const stmt of body) {
    if (stmt.kind === 'VarDecl') into.set(stmt.name, stmt);
    for (const value of Object.values(stmt as unknown as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'kind' in value[0]) {
        localDecls(value as Stmt[], into);
      }
    }
  }
  return into;
}

/** A function's value is its last statement's value — Pine has no `return`. */
function resultOf(func: ast.FuncDef): Expr | null {
  const last = func.body[func.body.length - 1];
  if (!last) return null;
  if (last.kind === 'ExprStmt') return last.expr;
  if (last.kind === 'VarDecl') return last.init;
  if (last.kind === 'Reassign') return last.value;
  return null;
}

const OBJECT_TYPES = new Set(['array', 'matrix', 'map', 'udt']);

/**
 * Whether an expression yields an object rather than a scalar.
 *
 * Follows the value: through `[]` history, through a ternary, into a user function's result, and
 * from a name to what it was declared as — which is what makes a two-hop chain like
 * `request.security(…, getPivotsMTF(…))` -> `request.security(…, getPivots(…)[1])` ->
 * `var array<swingPoint> pivots` resolve. `visited` stops a recursive function from looping;
 * anything it cannot follow is reported as scalar, so an unknown shape is left as written.
 */
function returnsObject(expr: Expr | null | undefined, scope: Scope, locals: Map<string, ast.VarDecl>, visited: Set<string>): boolean {
  if (!expr || visited.size > 16) return false;

  switch (expr.kind) {
    case 'History':
      return returnsObject(expr.base, scope, locals, visited);
    case 'Ternary':
      return (
        returnsObject(expr.then, scope, locals, visited) || returnsObject(expr.else, scope, locals, visited)
      );
    case 'Ident': {
      const decl = locals.get(expr.name) ?? scope.globals.get(expr.name);
      if (!decl || visited.has(`v:${expr.name}`)) return false;
      if (decl.declType && OBJECT_TYPES.has(decl.declType.kind)) return true;
      return returnsObject(decl.init, scope, locals, new Set([...visited, `v:${expr.name}`]));
    }
    case 'Call': {
      const callee = expr.callee;
      if (callee.kind === 'Member' && callee.object.kind === 'Ident') {
        const ns = callee.object.name;
        if (CONTAINER_NS.has(ns) && isContainerCtor(callee.property)) return true;
        if (scope.types.has(ns) && callee.property === 'new') return true;
        // A wrapper around a wrapper: what comes out is whatever the inner expression is.
        if (ns === 'request' && callee.property.startsWith('security')) {
          return returnsObject(expr.args[2]?.value, scope, locals, visited);
        }
      }
      if (callee.kind === 'Ident') {
        const func = scope.funcs.get(callee.name);
        if (!func || visited.has(`f:${callee.name}`)) return false;
        return returnsObject(resultOf(func), scope, localDecls(func.body), new Set([...visited, `f:${callee.name}`]));
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * Source positions of the self-symbol `request.security` calls whose value is an object, keyed
 * `line:col` of the `request` identifier — which is what the token scanner sees, and is NOT
 * where `Call.loc` points (that lands on the argument list).
 */
function objectSecuritySites(source: string): Set<string> {
  const sites = new Set<string>();
  let program: ast.Program;
  try {
    program = parse(tokenize(source));
  } catch {
    return sites;
  }

  const scope = collectScope(program.body);
  const walk = (node: unknown, locals: Map<string, ast.VarDecl>): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, locals);
      return;
    }
    const typed = node as { kind?: string; loc?: ast.Loc; body?: Stmt[] };
    const inner = typed.kind === 'FuncDef' ? localDecls(typed.body ?? []) : locals;

    if (typed.kind === 'Call') {
      const call = node as ast.Call;
      const callee = call.callee;
      if (
        callee.kind === 'Member' &&
        callee.object.kind === 'Ident' &&
        callee.object.name === 'request' &&
        callee.property === 'security' &&
        callee.object.loc &&
        isSelfSymbol(call.args[0]?.value) &&
        returnsObject(call.args[2]?.value, scope, inner, new Set())
      ) {
        sites.add(`${callee.object.loc.line}:${callee.object.loc.col}`);
      }
    }
    for (const value of Object.values(node as Record<string, unknown>)) walk(value, inner);
  };
  walk(program.body, new Map());
  return sites;
}

/** `''`, `syminfo.tickerid` or `syminfo.ticker` — the chart's own symbol. */
function isSelfSymbol(expr: Expr | undefined): boolean {
  if (!expr) return false;
  if (expr.kind === 'String') return expr.value === '';
  return (
    expr.kind === 'Member' &&
    expr.object.kind === 'Ident' &&
    expr.object.name === 'syminfo' &&
    (expr.property === 'tickerid' || expr.property === 'ticker')
  );
}

/** Index of the token closing the bracket opened at `open`, or -1. */
function matchBracket(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    if (OPENERS.has(tokens[i].value)) depth += 1;
    else if (CLOSERS.has(tokens[i].value)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Token spans of the top-level arguments between `open` and `close`. */
function argSpans(tokens: readonly Token[], open: number, close: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const v = tokens[i].value;
    if (OPENERS.has(v)) depth += 1;
    else if (CLOSERS.has(v)) depth -= 1;
    else if (v === ',' && depth === 0) {
      spans.push([start, i - 1]);
      start = i + 1;
    }
  }
  spans.push([start, close - 1]);
  return spans;
}

/** Source text covered by a token span, which must lie on one line. */
function spanText(lines: readonly string[], tokens: readonly Token[], [from, to]: [number, number]): string {
  const first = tokens[from];
  const last = tokens[to];
  return lines[first.line - 1].slice(first.col - 1, last.col - 1 + last.value.length);
}

/** One pass. Returns the same source when nothing matched. */
function unwrapOnce(source: string): { source: string; unwrapped: number } {
  let tokens: readonly Token[];
  try {
    tokens = tokenize(source).tokens as unknown as readonly Token[];
  } catch {
    return { source, unwrapped: 0 };
  }

  const sites = objectSecuritySites(source);
  if (sites.size === 0) return { source, unwrapped: 0 };
  const lines = source.split('\n');
  // Rightmost first, so an earlier replacement never invalidates a later call's columns.
  const edits: Array<{ line: number; from: number; to: number; text: string }> = [];

  for (let i = 0; i < tokens.length - 3; i += 1) {
    if (!isIdent(tokens[i]) || tokens[i].value !== 'request') continue;
    if (tokens[i + 1].value !== '.' || tokens[i + 2].value !== 'security' || tokens[i + 3].value !== '(') continue;
    if (!sites.has(`${tokens[i].line}:${tokens[i].col}`)) continue;

    const open = i + 3;
    const close = matchBracket(tokens, open);
    // One line only: joining lines would move every diagnostic below it.
    if (close === -1 || tokens[close].line !== tokens[i].line) continue;

    const spans = argSpans(tokens, open, close);
    if (spans.length < 3) continue;
    // A named argument reorders things; not worth the guesswork.
    if (spans.some(([from, to]) => tokens.slice(from, to + 1).some((t) => t.value === '='))) continue;

    const exprSpan = spans[2];
    edits.push({
      line: tokens[i].line,
      from: tokens[i].col,
      to: tokens[close].col + 1,
      text: spanText(lines, tokens, exprSpan),
    });
  }
  if (edits.length === 0) return { source, unwrapped: 0 };

  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    const text = lines[edit.line - 1];
    lines[edit.line - 1] = `${text.slice(0, edit.from - 1)}${edit.text}${text.slice(edit.to - 1)}`;
  }
  return { source: lines.join('\n'), unwrapped: edits.length };
}

/**
 * Repeats until stable, so a wrapper nested inside another wrapper's expression is unwrapped too.
 * Bounded, because a rewrite that stopped converging would otherwise hang the compile.
 */
export function unwrapSelfSecurity(source: string): SecurityUnwrap {
  let current = source;
  let total = 0;
  for (let pass = 0; pass < 5; pass += 1) {
    const { source: next, unwrapped } = unwrapOnce(current);
    if (unwrapped === 0) break;
    current = next;
    total += unwrapped;
  }
  return { source: current, unwrapped: total };
}

/** Human-readable body for the console panel. */
export function describeSecurityUnwrap(count: number): string {
  return (
    `${count} request.security() call${count === 1 ? '' : 's'} on this symbol returned an array, map, ` +
    'matrix or user-defined type. This engine hands those back as one live reference — the same ' +
    'value on every bar, at any timeframe — so the script would run on a frozen input and draw ' +
    'almost nothing. The wrapper has been dropped and the expression is evaluated directly, which ' +
    'is what TradingView does when the timeframe argument is empty or equal to the chart\'s. If the ' +
    'call requested a HIGHER timeframe, the values are the chart\'s timeframe instead of resampled. ' +
    'Numeric request.security() calls are untouched: those resample correctly.'
  );
}
