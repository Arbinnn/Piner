import assert from 'node:assert/strict';
import test from 'node:test';
import { ArrayFeed, Engine } from '@heyphat/piner';
import { compileScript } from './compiler.ts';
import { findConditionalUdtHistory, rewriteConditionalUdtHistory } from './udtHistory.ts';

const TYPE = `//@version=5
indicator("t")
type bar
    float h = high
    int   i = bar_index
bar b = bar.new()
var float out = na
cond = bar_index % 7 == 0
`;

const names = (source: string): string[] => findConditionalUdtHistory(source).map((r) => r.name);

test('a UDT field history read inside `if` is reported', () => {
  assert.deepEqual(names(`${TYPE}if cond\n    out := b.h[1]\nplot(out)\n`), ['b.h']);
});

test('the same read at global scope is not reported', () => {
  // Verified against the engine: at global scope the column advances every bar and the read is correct.
  assert.deepEqual(names(`${TYPE}out := b.h[1]\nplot(out)\n`), []);
});

test('a `for` or function body is not reported — both run on every bar', () => {
  assert.deepEqual(names(`${TYPE}for i = 0 to 0\n    out := b.h[1]\nplot(out)\n`), []);
  assert.deepEqual(names(`${TYPE}f() =>\n    b.h[1]\nout := f()\nplot(out)\n`), []);
});

test('a loop nested inside a conditional IS reported', () => {
  // The loop body runs every iteration, but only on the bars the `if` fires.
  assert.deepEqual(names(`${TYPE}if cond\n    for i = 0 to 0\n        out := b.h[1]\nplot(out)\n`), ['b.h']);
});

test('a method call on a UDT field is not a history read', () => {
  const src = `//@version=5
indicator("t")
type box_holder
    box bx
var box_holder x = box_holder.new(box(na))
if bar_index > 0
    v = x.bx.get_left()
plot(close)
`;
  assert.deepEqual(names(src), []);
});

test('a namespace or plain series is never a receiver', () => {
  // `syminfo.mintick[1]` and `close[1]` must stay quiet: neither receiver is a declared type.
  assert.deepEqual(names(`${TYPE}if cond\n    out := close[1] + syminfo.mintick[1]\nplot(out)\n`), []);
});

test('a script with no `type` declaration is skipped entirely', () => {
  assert.deepEqual(names('//@version=5\nindicator("t")\nif bar_index > 0\n    x = close[1]\nplot(close)\n'), []);
});

/** Runs a script over synthetic bars and returns plot 0's values. */
async function plotValues(source: string): Promise<number[]> {
  const outcome = compileScript(source);
  assert.equal(outcome.error, null, `compile failed: ${outcome.error?.message}`);
  const compiled = outcome.compiled!;
  const bars = Array.from({ length: 8 }, (_, i) => ({
    time: (i + 1) * 86_400_000,
    open: 10 + i,
    high: 12 + i,
    low: 9 + i,
    close: 11 + i,
    volume: 100,
  }));
  const engine = new Engine(compiled, new ArrayFeed(bars), {
    historySlotCount: compiled.metadata.historySlotCount,
    inputs: {},
  });
  // Must be awaited: reading outputs before the run settles reports every bar as na, which
  // looks exactly like the bug this test exists to catch.
  await engine.run({ symbol: 'T', timeframe: '1D' });
  return [...(engine.outputs.plots.get(0)?.data ?? [])] as number[];
}

test('the rewrite makes a conditional UDT history read return real values', async () => {
  const src = `${TYPE}if cond\n    out := b.h[1]\nplot(out)\n`;
  const values = (await plotValues(src)).filter(Number.isFinite);
  assert.ok(values.length > 0, 'every bar was na — the hoist did not take effect');
  // Bars are high = 12 + i, so a [1] read must be one of those, never 0 or na.
  assert.ok(
    values.every((v) => v >= 12 && v <= 19),
    `expected real highs, got ${JSON.stringify(values.slice(0, 4))}`,
  );
});

test('the rewrite preserves the line count so diagnostics stay put', () => {
  const src = `${TYPE}var float out = na\nif cond\n    out := b.h[1]\nplot(out)\n`;
  const { source, hoisted } = rewriteConditionalUdtHistory(src);
  assert.equal(hoisted, 1);
  assert.equal(source.split('\n').length, src.split('\n').length);
});

test('the rewrite handles CRLF sources', () => {
  // A naive append lands the comma after the CR, where it reads as the next line.
  const src = `${TYPE}var float out = na\nif cond\n    out := b.h[1]\nplot(out)\n`.replace(/\n/g, '\r\n');
  const { source } = rewriteConditionalUdtHistory(src);
  assert.equal(compileScript(source).error, null);
});

test('a loop-counter index is mirrored, index text and all', () => {
  // The mirror is the FIELD, never the indexed read, so `i` stays where it was written.
  const src = `${TYPE}var float out = na\nif cond\n    for i = 0 to 2\n        out := b.h[i]\nplot(out)\n`;
  const { hoisted, remaining, source } = rewriteConditionalUdtHistory(src);
  assert.equal(hoisted, 1);
  assert.deepEqual(remaining, []);
  assert.match(source, /_h_b_h\[i\]/);
  assert.equal(compileScript(source).error, null);
});

test('a variable index is mirrored even at global scope — a literal offset is the only reliable one', async () => {
  const src = `${TYPE}n = 1\nout := b.h[n]\nplot(out)\n`;
  assert.equal(rewriteConditionalUdtHistory(src).hoisted, 1);
  const values = (await plotValues(src)).filter(Number.isFinite);
  assert.ok(values.length > 0, 'every bar was na — the mirror did not take effect');
  assert.ok(values.every((v) => v >= 12 && v <= 19), `expected real highs, got ${JSON.stringify(values.slice(0, 4))}`);
});

test('a var-declared receiver is left alone and warned about', () => {
  // `var b = ..., _h = b.h` would make the mirror var too: frozen at bar 0 on every later bar.
  const src = `//@version=5
indicator("t")
type bar
    float h = high
var bar b = bar.new()
var float out = na
if bar_index % 3 == 0
    out := b.h[1]
plot(out)
`;
  const { hoisted, remaining, source } = rewriteConditionalUdtHistory(src);
  assert.equal(hoisted, 0);
  assert.equal(source, src);
  assert.deepEqual(remaining.map((r) => r.name), ['b.h']);
});

test('a global identifier index is hoisted, and the source still compiles', () => {
  const src = `//@version=5
indicator("t")
len = 2
type bar
    float h = high
bar b = bar.new()
var float out = na
cond = bar_index % 3 == 0
if cond
    out := b.h[len]
plot(out)
`;
  const { hoisted, source } = rewriteConditionalUdtHistory(src);
  assert.equal(hoisted, 1);
  assert.equal(compileScript(source).error, null);
});

test('a read already at global scope is not rewritten', () => {
  const src = `${TYPE}out = b.h[1]\nplot(out)\n`;
  const { hoisted, source } = rewriteConditionalUdtHistory(src);
  assert.equal(hoisted, 0);
  assert.equal(source, src);
});

test('both declaration forms are recognised as UDT receivers', () => {
  // `bar b = bar.new()` (typed) and `z = bar.new()` (inferred from the constructor).
  assert.deepEqual(names(`${TYPE}z = bar.new()\nif cond\n    out := z.h[1]\nplot(out)\n`), ['z.h']);
});
