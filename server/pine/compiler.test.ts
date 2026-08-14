import assert from 'node:assert/strict';
import test from 'node:test';
import { ArrayFeed, Engine } from '@heyphat/piner';
import { compileScript } from './compiler.ts';

/** Runs a script over synthetic bars and returns plot 0's per-bar colours. */
function plotColors(source: string): (string | null)[] {
  const outcome = compileScript(source);
  assert.equal(outcome.error, null);
  const compiled = outcome.compiled!;
  const bars = Array.from({ length: 5 }, (_, i) => ({
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
  engine.run({ symbol: 'T', timeframe: '1D' });
  return [...(engine.outputs.plots.get(0)?.colors ?? [])] as (string | null)[];
}

const header = '//@version=5\nindicator("t", overlay=true)\n';

test('a user variable named `color` does not shadow the color namespace', () => {
  const colors = plotColors(`${header}color = #54b6d4\nplot(close, color = color.new(color, 60))\n`);
  assert.ok(
    colors.every((c) => c === '#54B6D499'),
    `expected every bar to be the declared colour, got ${JSON.stringify(colors.slice(0, 3))}`,
  );
});

test('the color namespace still works when nothing shadows it', () => {
  const colors = plotColors(`${header}plot(close, color = color.new(color.red, 0))\n`);
  assert.ok(colors.every((c) => c?.startsWith('#')), JSON.stringify(colors.slice(0, 3)));
});

test('a `color` named argument key survives the rewrite', () => {
  // `color` is declared (so the rewrite is active) AND used as a named-argument key.
  const colors = plotColors(`${header}color = #cf2b2b\nplot(close, title = "x", color = color)\n`);
  assert.ok(
    colors.every((c) => c === '#CF2B2BFF'),
    `named-argument key was rewritten, got ${JSON.stringify(colors.slice(0, 3))}`,
  );
});

test('rewriting keeps diagnostic columns stable', () => {
  const outcome = compileScript(`${header}color = #cf2b2b\nplot(close, color = color)\nfoo bar baz\n`);
  assert.equal(outcome.error?.line, 5);
});
