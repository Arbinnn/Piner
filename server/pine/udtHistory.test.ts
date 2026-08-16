import assert from 'node:assert/strict';
import test from 'node:test';
import { findConditionalUdtHistory } from './udtHistory.ts';

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

test('both declaration forms are recognised as UDT receivers', () => {
  // `bar b = bar.new()` (typed) and `z = bar.new()` (inferred from the constructor).
  assert.deepEqual(names(`${TYPE}z = bar.new()\nif cond\n    out := z.h[1]\nplot(out)\n`), ['z.h']);
});
