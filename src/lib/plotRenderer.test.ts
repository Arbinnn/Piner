import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlotSeries } from '@heyphat/piner';
import { plotRuns } from './plotRenderer';
import type { Candle } from '../types/candle';

const candles: Candle[] = Array.from({ length: 6 }, (_, i) => ({
  time: (1000 + i) as Candle['time'],
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 0,
}));

function plot(data: number[], colors: (string | null)[] = [], options: Record<string, unknown> = {}): PlotSeries {
  return { title: 't', data, colors, options } as unknown as PlotSeries;
}

const times = (runs: { time: unknown }[][]): unknown[][] => runs.map((run) => run.map((p) => p.time));

test('a plot with no per-bar colours stays one run', () => {
  const runs = plotRuns(plot([1, 2, 3, 4, 5, 6]), candles, false);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].length, 6);
});

test('an `na` colour breaks the line, a missing colour does not', () => {
  // Bar 2 is `color = na`: Pine paints nothing there, so the run must be cut.
  const broken = plotRuns(plot([1, 2, 3, 4], ['#FFFFFFFF', '#FFFFFFFF', null, '#FFFFFFFF']), candles, false);
  assert.deepEqual(times(broken), [[1000, 1001], [1003]]);

  // An empty `colors` array means "no colour argument", NOT `na` — it must never break.
  const whole = plotRuns(plot([1, 2, 3, 4]), candles, false);
  assert.equal(whole.length, 1);
});

test('a non-finite value joins by default and breaks only for `*br` styles', () => {
  const joined = plotRuns(plot([1, NaN, 3]), candles, false);
  assert.deepEqual(times(joined), [[1000, 1002]]);

  const cut = plotRuns(plot([1, NaN, 3]), candles, true);
  assert.deepEqual(times(cut), [[1000], [1002]]);
});

test('`offset` shifts each point along the time axis and drops what falls off', () => {
  // offset = -2: bar i is drawn at bar i-2, so bars 0 and 1 have nowhere to go.
  const runs = plotRuns(plot([1, 2, 3, 4, 5, 6], [], { offset: -2 }), candles, false);
  assert.deepEqual(times(runs), [[1000, 1001, 1002, 1003]]);

  // A positive offset pushes right and drops the tail instead.
  const right = plotRuns(plot([1, 2, 3, 4, 5, 6], [], { offset: 2 }), candles, false);
  assert.deepEqual(times(right), [[1002, 1003, 1004, 1005]]);
});
