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

/** Variables holding an instance of one of those types, by either declaration form. */
function udtVariables(tokens: readonly Token[], types: ReadonlySet<string>): Set<string> {
  const vars = new Set<string>();
  for (let i = 0; i < tokens.length - 2; i += 1) {
    const [a, b, c] = [tokens[i], tokens[i + 1], tokens[i + 2]];

    // `bar b = ...` / `var ZZ z = ...` — the type name introduces the declaration.
    if (isIdent(a) && types.has(a.value) && isIdent(b) && c.value === '=') vars.add(b.value);

    // `b = bar.new(...)` — inferred from the constructor instead.
    if (isIdent(a) && b.value === '=' && isIdent(c) && types.has(c.value) && tokens[i + 3]?.value === '.') {
      vars.add(a.value);
    }
  }
  return vars;
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
