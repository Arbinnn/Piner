import assert from 'node:assert/strict';
import test from 'node:test';
import { compileScript } from './compiler.ts';
import { bucketStart } from './htfTime.ts';
import { runScript } from './runtime.ts';

const utc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

test('bucketStart floors to the opening instant of the period', () => {
  // 2025-12-25 is a Thursday, in Q4, in a month that opened on a Monday.
  const t = utc('2025-12-25');
  assert.equal(bucketStart(t, 'D'), t);
  assert.equal(bucketStart(t, 'W'), utc('2025-12-22'), 'weeks open on Monday');
  assert.equal(bucketStart(t, 'M'), utc('2025-12-01'));
  assert.equal(bucketStart(t, '3M'), utc('2025-10-01'));
  assert.equal(bucketStart(t, '12M'), utc('2025-01-01'));
  assert.equal(bucketStart(t, '240'), t, 'midnight is already a 4h boundary');
  assert.equal(bucketStart(t + 5 * 3_600_000, '240'), t + 4 * 3_600_000);
});

/** Daily bars across a month boundary: 2025-12-30, 12-31, 2026-01-01, 01-02. */
const BARS = [utc('2025-12-30'), utc('2025-12-31'), utc('2026-01-01'), utc('2026-01-02')].map(
  (time, i) => ({ time, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i, volume: 100 }),
);

async function plotValues(source: string): Promise<number[]> {
  const outcome = compileScript(source);
  assert.equal(outcome.error, null, `compile failed: ${outcome.error?.message}`);
  const run = await runScript(outcome.compiled!, BARS, {}, { symbol: 'T', timeframe: '1D' });
  assert.equal(run.error, null, `run failed: ${run.error?.message}`);
  return [...(run.outputs?.plots.get(0)?.data ?? [])] as number[];
}

test('ta.change(time(tf)) steps once per period, not once per bar', async () => {
  // Unpatched this is non-zero on every bar, which collapses every anchored profile to one bar.
  const values = await plotValues(
    '//@version=5\nindicator("t")\nplot(nz(ta.change(time("M"))) != 0 ? 1 : 0)\n',
  );
  assert.deepEqual(values, [0, 0, 1, 0]);
});

test('time() with no timeframe still returns the chart bar time', async () => {
  const values = await plotValues('//@version=5\nindicator("t")\nplot(time - time())\n');
  assert.deepEqual(values, [0, 0, 0, 0]);
});
