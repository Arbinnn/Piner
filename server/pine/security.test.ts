import assert from 'node:assert/strict';
import test from 'node:test';
import { ArrayFeed, Engine } from '@heyphat/piner';
import { compileScript } from './compiler.ts';
import { unwrapSelfSecurity } from './security.ts';

/** A function whose value is an array that grows by one element per bar. */
const GROWS = `//@version=5
indicator("t")
grow() =>
    var a = array.new<float>()
    a.push(close)
    a
`;

test('a self-symbol request.security returning an array is unwrapped', () => {
  const src = `${GROWS}arr = request.security(syminfo.tickerid, "", grow())\nplot(arr.size())\n`;
  const { source, unwrapped } = unwrapSelfSecurity(src);
  assert.equal(unwrapped, 1);
  assert.match(source, /arr = grow\(\)/);
  assert.equal(source.split('\n').length, src.split('\n').length);
});

test('a numeric request.security is left exactly as written — those resample correctly', () => {
  // Verified against the engine: `ta.atr(l)` at "W" steps once a week even wrapped, so unwrapping
  // it would DROP working higher-timeframe support.
  const src = `//@version=5
indicator("t")
l = 14
f(x) => ta.sma(x, 5)
a = request.security(syminfo.tickerid, "W", ta.atr(l))
b = request.security(syminfo.tickerid, "W", f(close))
plot(a + b)
`;
  const { source, unwrapped } = unwrapSelfSecurity(src);
  assert.equal(unwrapped, 0);
  assert.equal(source, src);
});

test('another symbol is never unwrapped — the wrapper is the whole point of the call', () => {
  const src = `${GROWS}arr = request.security("AAPL", "", grow())\nplot(arr.size())\n`;
  assert.equal(unwrapSelfSecurity(src).unwrapped, 0);
});

test('a wrapper nested inside another wrapper is unwrapped too', () => {
  const src = `${GROWS}inner() => request.security('', '', grow()[1], barmerge.gaps_off, barmerge.lookahead_on)
outer(string tf) => request.security(syminfo.tickerid, tf, inner(), barmerge.gaps_off, barmerge.lookahead_on)
arr = outer('')
plot(arr.size())
`;
  const { source, unwrapped } = unwrapSelfSecurity(src);
  assert.equal(unwrapped, 2);
  assert.doesNotMatch(source, /request\.security/);
  assert.equal(compileScript(source).error, null);
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
  await engine.run({ symbol: 'T', timeframe: '1D' });
  return [...(engine.outputs.plots.get(0)?.data ?? [])] as number[];
}

test('the unwrap turns a frozen array into a per-bar one', async () => {
  // Wrapped, every bar reports the array's FINAL size; unwrapped it counts up with the bars.
  const values = await plotValues(`${GROWS}arr = request.security(syminfo.tickerid, "", grow())\nplot(arr.size())\n`);
  assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8]);
});
