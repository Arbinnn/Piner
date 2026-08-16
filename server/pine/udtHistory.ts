/**
 * Finds history reads on a UDT field that sit inside a conditional block.
 *
 * `b.h[1]` where `b` is a user-defined type reads `na` when the line only runs on some bars.
 * The series column behind the field is written where the expression EXECUTES, so a branch that
 * fires on a handful of bars leaves the column empty and `[1]` finds nothing. At global scope —
 * or in a `for` body or a function body, both of which run every bar — the same expression is
 * correct.
 *
 * This is not an error and produces no runtime failure: the read yields `na`, `nz()` turns it
 * into 0, and the script carries on computing with zeros. LuxAlgo's Buyside & Sellside
 * Liquidity does `y2 := nz(b.h[1])` inside `if ph`, stores 0 as every pivot price, and its
 * clustering test then compares 0 against real prices forever — no boxes, no lines, a blank
 * chart and no diagnostic.
 *
 * piner already warns about exactly this for plain local variables ("its column is only written
 * on bars where its block executes"); it just does not extend the check to UDT fields. Until it
 * does, this scan reproduces it — deliberately narrow, so it stays quiet on correct code:
 *
 *  - the receiver must be a variable of a type the script itself declared with `type`;
 *  - the access must be a direct field read followed by `[` (`b.h[1]`), not a method call;
 *  - at least one enclosing block must be a CONDITIONAL. A `for`/`while` body or a function
 *    body is left alone, because those execute on every bar and the column stays continuous.
 */

import { tokenize } from '@heyphat/piner';

export interface UdtHistoryRead {
  /** The read as written, e.g. `b.h`. */
  name: string;
  line: number;
  col: number;
}

/** One `<recv>.<field>[<index>]` occurrence, located in the source. */
interface Occurrence {
  recv: string;
  field: string;
  /** Source text between the brackets, e.g. `1` or `srLN`. */
  index: string;
  line: number;
  /** 1-based column of `<recv>` and one past the closing `]`. */
  startCol: number;
  endCol: number;
  conditional: boolean;
  /** Whether the index can be evaluated at global scope (see `rewriteConditionalUdtHistory`). */
  hoistable: boolean;
}

/** Block openers whose body runs only on some bars. `for`/`while` bodies run every bar. */
const CONDITIONAL_OPENERS = new Set(['if', 'else', 'switch']);

interface Token {
  kind: unknown;
  value: string;
  line: number;
  col: number;
}

const isIdent = (t: Token | undefined): boolean => t !== undefined && String(t.kind) === 'Ident';

/**
 * Zero-width layout tokens. The tokenizer emits `Newline`/`Indent`/`Dedent` at column 1 of every
 * line, so measuring indentation without skipping them makes every line look top-level.
 */
const STRUCTURAL = new Set(['Newline', 'Indent', 'Dedent', 'EOF']);

const isCode = (t: Token): boolean => !STRUCTURAL.has(String(t.kind)) && t.value !== '';

/**
 * Types the script declares itself (`type bar` / `type ZZ`). Only these count as receivers, so
 * a namespace (`syminfo.mintick[1]`) or an ordinary series can never trigger the scan.
 */
function declaredTypes(tokens: readonly Token[]): Set<string> {
  const types = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i].value === 'type' && isIdent(tokens[i + 1]) && tokens[i].col === 1) {
      types.add(tokens[i + 1].value);
    }
  }
  return types;
}

/**
 * Variables holding an instance of one of those types, by either declaration form, mapped to
 * the line they were declared on — the rewrite appends its hoists to that line.
 */
function udtVariables(tokens: readonly Token[], types: ReadonlySet<string>): Map<string, number> {
  const vars = new Map<string, number>();
  for (let i = 0; i < tokens.length - 2; i += 1) {
    const [a, b, c] = [tokens[i], tokens[i + 1], tokens[i + 2]];

    // `bar b = ...` / `var ZZ z = ...` — the type name introduces the declaration.
    if (isIdent(a) && types.has(a.value) && isIdent(b) && c.value === '=' && !vars.has(b.value)) {
      vars.set(b.value, a.line);
    }

    // `b = bar.new(...)` — inferred from the constructor instead.
    if (
      isIdent(a) &&
      b.value === '=' &&
      isIdent(c) &&
      types.has(c.value) &&
      tokens[i + 3]?.value === '.' &&
      !vars.has(a.value)
    ) {
      vars.set(a.value, a.line);
    }
  }
  return vars;
}

/**
 * Identifiers assigned at global scope, mapped to the line of their assignment. Used to decide
 * whether an index expression like `[srLN]` can legally be evaluated where the hoist is placed.
 */
function globalAssignments(tokens: readonly Token[], indents: ReadonlyMap<number, number>): Map<string, number> {
  const globals = new Map<string, number>();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const t = tokens[i];
    if (!isIdent(t) || t.col !== indents.get(t.line)) continue;
    if (t.col !== 1) continue;
    const next = tokens[i + 1];
    if (next?.value === '=' && !globals.has(t.value)) globals.set(t.value, t.line);
  }
  return globals;
}

/** Indentation of each line, as the column of its first token. Pine blocks are indentation-based. */
function lineIndents(tokens: readonly Token[]): Map<number, number> {
  const indents = new Map<number, number>();
  for (const t of tokens) {
    if (!isCode(t)) continue;
    const seen = indents.get(t.line);
    if (seen === undefined || t.col < seen) indents.set(t.line, t.col);
  }
  return indents;
}

/** The first token on each line, for identifying what opened a block. */
function lineHeads(tokens: readonly Token[]): Map<number, string> {
  const heads = new Map<number, string>();
  const indents = lineIndents(tokens);
  for (const t of tokens) {
    if (isCode(t) && t.col === indents.get(t.line)) heads.set(t.line, t.value);
  }
  return heads;
}

/**
 * Whether any block enclosing `line` is a conditional.
 *
 * Walks outwards to successively smaller indents — a `for` nested inside an `if` still only runs
 * on some bars, so every ancestor is checked, not just the innermost one.
 */
function insideConditional(line: number, indents: ReadonlyMap<number, number>, heads: ReadonlyMap<number, string>): boolean {
  let indent = indents.get(line);
  if (indent === undefined || indent === 1) return false;

  for (let probe = line - 1; probe >= 1; probe -= 1) {
    const probeIndent = indents.get(probe);
    if (probeIndent === undefined || probeIndent >= indent) continue;
    if (CONDITIONAL_OPENERS.has(heads.get(probe) ?? '')) return true;
    indent = probeIndent;
    if (indent === 1) break;
  }
  return false;
}

/**
 * Every `<udtVar>.<field>[…]` in the source, with the bracket contents and whether the read is
 * inside a conditional. Index text is sliced straight from the line, so it survives verbatim.
 */
function occurrences(source: string, tokens: readonly Token[]): Occurrence[] {
  const types = declaredTypes(tokens);
  if (types.size === 0) return [];
  const vars = udtVariables(tokens, types);
  if (vars.size === 0) return [];

  const indents = lineIndents(tokens);
  const heads = lineHeads(tokens);
  const globals = globalAssignments(tokens, indents);
  const lines = source.split('\n');
  const found: Occurrence[] = [];

  for (let i = 0; i < tokens.length - 3; i += 1) {
    const [recv, dot, field, open] = [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]];
    if (!isIdent(recv) || !vars.has(recv.value)) continue;
    if (dot.value !== '.' || !isIdent(field) || open.value !== '[') continue;

    // Walk to the matching `]`, so a nested index (`b.i[n[0]]`) still slices correctly.
    let depth = 0;
    let close = -1;
    for (let j = i + 3; j < tokens.length; j += 1) {
      if (tokens[j].value === '[') depth += 1;
      else if (tokens[j].value === ']') {
        depth -= 1;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    if (close === -1 || tokens[close].line !== recv.line) continue;

    const indexTokens = tokens.slice(i + 4, close);
    const index = lines[recv.line - 1].slice(open.col, tokens[close].col - 1);

    // Hoistable only when the index means the same thing at global scope: a plain integer, or
    // an identifier assigned globally BEFORE the line the hoist will sit on. A loop counter or
    // any block-local name would be undefined out there, so those are left for the warning.
    const declLine = vars.get(recv.value)!;
    const single = indexTokens.length === 1 ? indexTokens[0] : undefined;
    const hoistable =
      single !== undefined &&
      (String(single.kind) === 'Int' ||
        (isIdent(single) && (globals.get(single.value) ?? Infinity) < declLine));

    found.push({
      recv: recv.value,
      field: field.value,
      index,
      line: recv.line,
      startCol: recv.col,
      endCol: tokens[close].col + 1,
      conditional: insideConditional(recv.line, indents, heads),
      hoistable,
    });
  }
  return found;
}

export interface UdtHistoryRewrite {
  source: string;
  /** How many distinct reads were lifted to global scope. */
  hoisted: number;
  /** Conditional reads that could not be lifted — still broken, still worth warning about. */
  remaining: UdtHistoryRead[];
}

/**
 * Lifts conditional UDT-field history reads to global scope, so scripts that hit the defect
 * run correctly without being edited.
 *
 * The transformation is the one a user would apply by hand: read the field once per bar at
 * global scope, then use that value inside the block. On TradingView it is a no-op — the
 * expression never depended on the branch — and here it is the difference between a chart and
 * a blank screen. LuxAlgo's Support & Resistance MTF assigns `pp.x := b.i[srLN]` inside a
 * conditional; `pp.x` feeds the x coordinate of nearly every box, line and label it draws, so
 * unrewritten the whole script places at an `na` bar index and renders nothing.
 *
 * Hoists are appended to the receiver's own declaration line as comma-chained assignments
 * (`bar b = bar.new(), _h_b_i_1 = b.i[1]`), which Pine accepts. That keeps every line number in
 * the file unchanged, so diagnostics still point where the user is looking. Columns after a
 * rewritten read on the same line do shift, since the replacement name is not the same width as
 * the text it replaces.
 */
export function rewriteConditionalUdtHistory(source: string): UdtHistoryRewrite {
  let tokens: readonly Token[];
  try {
    tokens = tokenize(source).tokens as unknown as readonly Token[];
  } catch {
    return { source, hoisted: 0, remaining: [] };
  }

  const all = occurrences(source, tokens);
  const targets = all.filter((o) => o.conditional && o.hoistable);
  const remaining = all
    .filter((o) => o.conditional && !o.hoistable)
    .map((o) => ({ name: `${o.recv}.${o.field}`, line: o.line, col: o.startCol }));

  if (targets.length === 0) return { source, hoisted: 0, remaining: dedupe(remaining) };

  const taken = new Set(tokens.filter((t) => isIdent(t)).map((t) => t.value));
  const names = new Map<string, string>();
  const hoistsByLine = new Map<number, string[]>();
  const declLines = udtVariables(tokens, declaredTypes(tokens));

  for (const o of targets) {
    const key = `${o.recv}.${o.field}[${o.index}]`;
    if (names.has(key)) continue;

    let name = `_h_${o.recv}_${o.field}_${o.index.replace(/[^0-9A-Za-z_]/g, '')}`;
    for (let n = 1; taken.has(name); n += 1) name = `_h${n}_${o.recv}_${o.field}`;
    taken.add(name);
    names.set(key, name);

    const declLine = declLines.get(o.recv)!;
    hoistsByLine.set(declLine, [...(hoistsByLine.get(declLine) ?? []), `${name} = ${key}`]);
  }

  const lines = source.split('\n');

  // Rightmost first, so an earlier replacement never invalidates a later occurrence's columns.
  const byLine = new Map<number, Occurrence[]>();
  for (const o of targets) byLine.set(o.line, [...(byLine.get(o.line) ?? []), o]);
  for (const [line, occs] of byLine) {
    let text = lines[line - 1];
    for (const o of [...occs].sort((a, b) => b.startCol - a.startCol)) {
      const name = names.get(`${o.recv}.${o.field}[${o.index}]`)!;
      text = `${text.slice(0, o.startCol - 1)}${name}${text.slice(o.endCol - 1)}`;
    }
    lines[line - 1] = text;
  }

  for (const [line, hoists] of hoistsByLine) {
    // Append INSIDE the line, before any CR: on a CRLF file a naive append puts the comma
    // after the carriage return, where the tokenizer reads it as the start of the next line.
    const text = lines[line - 1];
    const cr = text.endsWith('\r') ? '\r' : '';
    lines[line - 1] = `${cr ? text.slice(0, -1) : text}, ${hoists.join(', ')}${cr}`;
  }

  return { source: lines.join('\n'), hoisted: names.size, remaining: dedupe(remaining) };
}

/** One mention per field per line: `b.h[1] > b.h[2]` is a single thing to go and fix. */
function dedupe(reads: readonly UdtHistoryRead[]): UdtHistoryRead[] {
  const seen = new Set<string>();
  const out: UdtHistoryRead[] = [];
  for (const r of reads) {
    const key = `${r.name}@${r.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function findConditionalUdtHistory(source: string): UdtHistoryRead[] {
  let tokens: readonly Token[];
  try {
    tokens = tokenize(source).tokens as unknown as readonly Token[];
  } catch {
    // Unparseable source is the compiler's error to report, not ours.
    return [];
  }

  const types = declaredTypes(tokens);
  if (types.size === 0) return [];
  const vars = udtVariables(tokens, types);
  if (vars.size === 0) return [];

  const indents = lineIndents(tokens);
  const heads = lineHeads(tokens);
  const found: UdtHistoryRead[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tokens.length - 3; i += 1) {
    const [recv, dot, field, open] = [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]];
    if (!isIdent(recv) || !vars.has(recv.value)) continue;
    if (dot.value !== '.' || !isIdent(field) || open.value !== '[') continue;
    if (!insideConditional(recv.line, indents, heads)) continue;

    // One mention per field per line: `b.h[1] > b.h[2]` is a single thing to go and fix.
    const name = `${recv.value}.${field.value}`;
    const key = `${name}@${recv.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ name, line: recv.line, col: recv.col });
  }
  return found;
}

/** Human-readable body for the console panel. */
export function describeUdtHistory(reads: readonly UdtHistoryRead[]): string {
  const list = reads.map((r) => `  ${r.name}[…]  (line ${r.line})`).join('\n');
  return (
    `History of a user-defined type's field is read inside a conditional block:\n${list}\n\n` +
    'The series behind a UDT field is only written on bars where the line executes, so inside ' +
    'an if/else the history is empty and the read returns na — which nz() then turns into 0, ' +
    'silently. Assign it at global scope and use that variable inside the block instead.'
  );
}
