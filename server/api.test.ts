/**
 * Backend API tests: the trust boundary, the wire format and the settings layering.
 *
 * The backtest maths itself is covered by `strategy/strategy.test.ts`; what is checked here is
 * everything the move to the backend introduced — request validation, `Map` <-> JSON, the
 * `defaults -> header -> overrides` merge, and the bar range a client slices its candles by.
 */

import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { compileScript } from './pine/compiler.ts';
import { PineFailure, executePine, resolveStrategyConfig } from './pine/executor.ts';
import { clearCaches } from './pine/cache.ts';
import { validateExecuteRequest, ValidationError } from './validate.ts';
import { deserializeOutputs } from '../src/types/pine.ts';
import { DEFAULT_STRATEGY_CONFIG } from '../src/strategy/types.ts';

const SYMBOL = 'ADBL';

/** Bars 0-2 are `na`, so the round trip has real gaps to preserve. */
const GAPPED_INDICATOR = `//@version=5
indicator("Gaps", overlay=true)
plot(bar_index < 3 ? na : close)
`;

const HEADER_STRATEGY = `//@version=5
strategy("Header", overlay=true, initial_capital=250000, pyramiding=3)
if bar_index == 10
    strategy.entry("L", strategy.long)
if bar_index == 20
    strategy.close("L")
`;

function requireValid(body: unknown): ReturnType<typeof validateExecuteRequest> {
  return validateExecuteRequest(body);
}

test('validation accepts a minimal request and rejects malformed ones', () => {
  const req = requireValid({ script: 'plot(close)', symbol: 'ADBL', timeframe: 'D' });
  strictEqual(req.script, 'plot(close)');
  strictEqual(req.inputs, undefined);
  strictEqual(req.bars, undefined);

  throws(() => requireValid('not an object'), ValidationError);
  throws(() => requireValid({ symbol: 'ADBL', timeframe: 'D' }), ValidationError);
  throws(() => requireValid({ script: '   ', symbol: 'ADBL', timeframe: 'D' }), ValidationError);
  throws(() => requireValid({ script: 'plot(close)', symbol: 'ADBL', timeframe: 'D', bars: 2.5 }), ValidationError);
  throws(() => requireValid({ script: 'plot(close)', symbol: 'ADBL', timeframe: 'D', inputs: { a: [1] } }), ValidationError);
});

test('the script is never trimmed, so diagnostics keep the editor line numbers', () => {
  const script = '\n\nplot(close)\n';
  strictEqual(requireValid({ script, symbol: 'ADBL', timeframe: 'D' }).script, script);
});

test('strategy settings are an allowlist: bad values rejected, unknown keys dropped', () => {
  const req = requireValid({
    script: 'plot(close)',
    symbol: 'ADBL',
    timeframe: 'D',
    strategy: { initialCapital: 5000, qtyType: 'cash', from: 100, to: 200, somethingElse: 'x' },
  });
  deepStrictEqual(req.strategy, { initialCapital: 5000, qtyType: 'cash', from: 100, to: 200 });

  const bad = (strategy: unknown): void =>
    throws(() => requireValid({ script: 'plot(close)', symbol: 'ADBL', timeframe: 'D', strategy }), ValidationError);
  bad({ pyramiding: -1 });
  bad({ pyramiding: 1.5 });
  bad({ qtyType: 'moon' });
  bad({ commissionType: 'free' });
  bad({ processOrdersOnClose: 'yes' });
  bad({ initialCapital: Number.POSITIVE_INFINITY });
  bad({ from: 500, to: 100 });
});

test('config layers defaults, then the strategy() header, then the user overrides', () => {
  const outcome = compileScript(HEADER_STRATEGY);
  ok(outcome.compiled, `compile failed: ${outcome.error?.message}`);

  const fromHeader = resolveStrategyConfig(outcome.compiled, undefined);
  strictEqual(fromHeader.initialCapital, 250_000);
  strictEqual(fromHeader.pyramiding, 3);
  strictEqual(fromHeader.qtyValue, DEFAULT_STRATEGY_CONFIG.qtyValue);

  const overridden = resolveStrategyConfig(outcome.compiled, { initialCapital: 1_000 });
  strictEqual(overridden.initialCapital, 1_000);
  strictEqual(overridden.pyramiding, 3, 'an untouched field still follows the header');
});

test('outputs survive the JSON round trip, na gaps included', async () => {
  clearCaches();
  const response = await executePine({ script: GAPPED_INDICATOR, symbol: SYMBOL, timeframe: 'D', bars: 40 });

  // What the browser actually receives: the payload after JSON, not the in-process object.
  const wire = JSON.parse(JSON.stringify(response)) as typeof response;
  const outputs = deserializeOutputs(wire.outputs);

  strictEqual(outputs.plots.size, 1);
  const plot = outputs.plots.get(0);
  ok(plot, 'plot 0 is present');
  strictEqual(plot.data.length, 40);
  ok(!Number.isFinite(plot.data[0]), 'bar 0 stays a gap');
  ok(!Number.isFinite(plot.data[2]), 'bar 2 stays a gap');
  ok(Number.isFinite(plot.data[3]), 'bar 3 carries a real value');
  strictEqual(plot.data[10], response.outputs.plots[0][1].data[10]);
  strictEqual(wire.range.start, 0);
  strictEqual(wire.range.end, 39);
  strictEqual(wire.barCount, 40);
  strictEqual(wire.strategy, null);
});

test('a date range narrows the run and reports the bar range the client should slice', async () => {
  clearCaches();
  const all = await executePine({ script: HEADER_STRATEGY, symbol: SYMBOL, timeframe: 'D', bars: 100 });
  ok(all.strategy, 'the strategy ran');
  strictEqual(all.range.start, 0);
  strictEqual(all.range.end, 99);

  const from = all.strategy.firstBarTime;
  const sliced = await executePine({
    script: HEADER_STRATEGY,
    symbol: SYMBOL,
    timeframe: 'D',
    bars: 100,
    strategy: { from: from + 86_400 * 10 },
  });
  ok(sliced.range.start > 0, 'the window starts after the first bar');
  strictEqual(sliced.range.end, 99);
  strictEqual(sliced.barCount, sliced.range.end - sliced.range.start + 1);
  strictEqual(sliced.strategyConfig?.initialCapital, 250_000, 'the header still applies under an override');
});

test('an identical request is served from the result cache', async () => {
  clearCaches();
  const req = { script: GAPPED_INDICATOR, symbol: SYMBOL, timeframe: 'D', bars: 25 };
  const first = await executePine(req);
  strictEqual(first.cached, false);
  const second = await executePine(req);
  strictEqual(second.cached, true);
  deepStrictEqual(second.outputs, first.outputs);
});

test('a bad script fails as a PineFailure the client can render', async () => {
  clearCaches();
  await executePine({ script: GAPPED_INDICATOR, symbol: SYMBOL, timeframe: 'D', bars: 10 }).catch(() => {
    throw new Error('the valid script should not have failed');
  });

  let failure: unknown;
  try {
    await executePine({ script: '//@version=5\nindicator("x")\nplot(', symbol: SYMBOL, timeframe: 'D', bars: 10 });
  } catch (err) {
    failure = err;
  }
  ok(failure instanceof PineFailure, 'compile errors arrive as PineFailure');
  strictEqual(failure.status, 422);
  strictEqual(failure.pine.heading, 'Compilation Error');
  strictEqual(failure.pine.line, 4);
});
