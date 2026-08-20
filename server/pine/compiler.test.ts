import assert from 'node:assert/strict';
import test from 'node:test';
import { ArrayFeed, Engine } from '@heyphat/piner';
import type { PlotSeries } from '@heyphat/piner';
import { compileScript } from './compiler.ts';

/** Compiles a script and runs it over five synthetic bars. `run()` must be awaited: without it
 *  the collector is still empty, and an assertion over `?? []` passes vacuously. */
async function runPlot(source: string): Promise<PlotSeries> {
  const outcome = compileScript(source);
  assert.equal(outcome.error, null, outcome.error?.message);
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
  await engine.run({ symbol: 'T', timeframe: '1D' });
  const plot = engine.outputs.plots.get(0);
  assert.ok(plot, 'the script produced no plot 0');
  return plot;
}

/** Plot 0's per-bar colours. */
async function plotColors(source: string): Promise<(string | null)[]> {
  return [...(await runPlot(source)).colors] as (string | null)[];
}

/** Plot 0's options object — everything `plot()` was passed beyond series, title and colour. */
async function plotOptions(source: string): Promise<Record<string, unknown>> {
  return (await runPlot(source)).options as Record<string, unknown>;
}

const header = '//@version=5\nindicator("t", overlay=true)\n';

test('a user variable named `color` does not shadow the color namespace', async () => {
  const colors = await plotColors(`${header}color = #54b6d4\nplot(close, color = color.new(color, 60))\n`);
  // `transp = 60` means 60% transparent, i.e. alpha 40% = 0x66.
  assert.ok(
    colors.every((c) => c === '#54B6D466'),
    `expected every bar to be the declared colour, got ${JSON.stringify(colors.slice(0, 3))}`,
  );
});

test('the color namespace still works when nothing shadows it', async () => {
  const colors = await plotColors(`${header}plot(close, color = color.new(color.red, 0))\n`);
  assert.ok(colors.every((c) => c?.startsWith('#')), JSON.stringify(colors.slice(0, 3)));
});

test('a `color` named argument key survives the rewrite', async () => {
  // `color` is declared (so the rewrite is active) AND used as a named-argument key.
  const colors = await plotColors(`${header}color = #cf2b2b\nplot(close, title = "x", color = color)\n`);
  assert.ok(
    colors.every((c) => c === '#CF2B2BFF'),
    `named-argument key was rewritten, got ${JSON.stringify(colors.slice(0, 3))}`,
  );
});

test('a v4 `study()` declaration is honoured as `indicator()`', () => {
  // Unrewritten, the engine ignores the whole declaration: no title, overlay false, and the
  // drawing-object limits silently fall back to Pine's default of 50.
  const outcome = compileScript(
    '//@version=4\nstudy("Volume Profile [LUX]","VP",true,max_bars_back=1000,max_lines_count=500)\nplot(close)\n',
  );
  assert.equal(outcome.error, null);
  const meta = outcome.compiled!.metadata;
  assert.equal(meta.title, 'Volume Profile [LUX]');
  assert.equal(meta.overlay, true, 'positional overlay must survive the study -> indicator swap');
  assert.equal(meta.maxLinesCount, 500, 'max_lines_count must reach the engine, not default to 50');
});

test('a user identifier named `study` is left alone', () => {
  const outcome = compileScript(`${header}study = close\nplot(study)\n`);
  assert.equal(outcome.error, null);
  assert.equal(outcome.compiled!.metadata.title, 't');
});

test('rewriting keeps diagnostic columns stable', () => {
  const outcome = compileScript(`${header}color = #cf2b2b\nplot(close, color = color)\nfoo bar baz\n`);
  assert.equal(outcome.error?.line, 5);
});

test('positional plot() arguments past `color` reach the options object', async () => {
  // Unnamed, the engine discards everything from `linewidth` on and the histogram draws as a line.
  const options = await plotOptions(`${header}plot(close - open, 'H', color.red, 1, plot.style_columns)\n`);
  assert.equal(options.style, 'columns');
  assert.equal(options.linewidth, 1);
});

test('named plot() arguments are not renamed, and a `plot.` member is not a call', async () => {
  const options = await plotOptions(
    `${header}s = plot.style_histogram\nplot(close, 'H', color.red, style = s, histbase = 2)\n`,
  );
  assert.equal(options.style, 'histogram');
  assert.equal(options.histbase, 2);
});

test('a nested call inside a plot argument does not confuse the argument count', async () => {
  const options = await plotOptions(
    `${header}plot(math.max(close, open), 'H', color.new(color.red, 0), 3, plot.style_columns)\n`,
  );
  assert.equal(options.style, 'columns');
  assert.equal(options.linewidth, 3);
});

test('a `color` variable declared inside a block still routes `color.*` to the namespace', async () => {
  // ChartPrime/LuxAlgo dashboards build their gradient inside a `for` body, where the shadowing
  // variable is preceded by an Indent rather than a newline.
  const colors = await plotColors(`//@version=6
indicator("t")
c = color.aqua
if bar_index >= 0
    color = color.red
    c := color.new(color, 0)
plot(close, color = c)
`);
  assert.equal(colors[0], '#F23645FF');
});

test('the `color` rewrite leaves `input.color(...)` and named `color =` arguments alone', async () => {
  const colors = await plotColors(`//@version=6
indicator("t")
color picked = input.color(color.lime, "Line")
if bar_index >= 0
    color = color.red
plot(close,
   color = picked)
`);
  assert.equal(colors[0], '#00E676FF');
});
